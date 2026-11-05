import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';
import 'storage.dart';

/// Stable machine-readable error from the API (`{code, message, details}`).
class ApiException implements Exception {
  ApiException(this.status, this.code, this.message, [this.details]);
  final int? status;
  final String code;
  final String message;
  final dynamic details;

  /// True when the request never reached the server (or the server is down) — candidate for offline queueing.
  bool get isNetwork => status == null || status == 502 || status == 503 || status == 504;
  @override
  String toString() => '$code: $message';
}

class Session {
  Session({required this.accessToken, required this.refreshToken, this.tenantId, this.facilityId});
  final String accessToken, refreshToken;
  final String? tenantId, facilityId;

  Session copyWith({String? accessToken, String? refreshToken, String? tenantId, String? facilityId}) => Session(
        accessToken: accessToken ?? this.accessToken,
        refreshToken: refreshToken ?? this.refreshToken,
        tenantId: tenantId ?? this.tenantId,
        facilityId: facilityId ?? this.facilityId,
      );
  Map<String, dynamic> toJson() => {'a': accessToken, 'r': refreshToken, 't': tenantId, 'f': facilityId};
  static Session fromJson(Map<String, dynamic> j) => Session(accessToken: j['a'], refreshToken: j['r'], tenantId: j['t'], facilityId: j['f']);
}

class SessionStore {
  SessionStore(this._kv);
  final KeyValueStore _kv;
  static const _key = 'p2a.session';
  Session? _cached;
  final _changes = StreamController<Session?>.broadcast();
  Stream<Session?> get changes => _changes.stream;

  Future<Session?> load() async {
    final raw = await _kv.read(_key);
    _cached = raw == null ? null : Session.fromJson(jsonDecode(raw));
    return _cached;
  }

  Session? get current => _cached;

  Future<void> save(Session? s) async {
    _cached = s;
    s == null ? await _kv.delete(_key) : await _kv.write(_key, jsonEncode(s.toJson()));
    _changes.add(s);
  }
}

/// Thin typed wrapper over Dio. Business rules live on the server; this only handles transport concerns.
class ApiClient {
  ApiClient({required String baseUrl, required this.sessions, Dio? dio, this.timeout = const Duration(seconds: 8)})
      : dio = dio ?? Dio(BaseOptions(baseUrl: baseUrl, connectTimeout: timeout, receiveTimeout: timeout, sendTimeout: timeout)) {
    this.dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      final s = sessions.current;
      if (s != null) {
        o.headers['authorization'] = 'Bearer ${s.accessToken}';
        if (s.tenantId != null) o.headers['x-tenant-id'] = s.tenantId;
      }
      h.next(o);
    }));
  }

  final Dio dio;
  final SessionStore sessions;
  final Duration timeout;
  Future<bool>? _refreshing;
  static const _uuid = Uuid();

  static String newIdempotencyKey() => _uuid.v4();

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) => _send(() => dio.get(path, queryParameters: query));

  Future<dynamic> post(String path, [Object? body, String? idempotencyKey]) =>
      _send(() => dio.post(path, data: body, options: Options(headers: {'idempotency-key': ?idempotencyKey})));

  Future<dynamic> patch(String path, [Object? body]) => _send(() => dio.patch(path, data: body));

  Future<dynamic> delete(String path) => _send(() => dio.delete(path));

  Future<dynamic> _send(Future<Response> Function() call, {bool retried = false}) async {
    try {
      final r = await call();
      return r.data is String && (r.data as String).isEmpty ? null : r.data;
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 && !retried && sessions.current != null && await _refresh()) return _send(call, retried: true);
      final body = e.response?.data;
      if (body is Map) throw ApiException(status, '${body['code'] ?? 'ERROR'}', '${body['message'] ?? 'Request failed'}', body['details']);
      throw ApiException(status, status == null ? 'NETWORK' : 'HTTP_$status', status == null ? 'Cannot reach server' : 'Server error ($status)');
    }
  }

  Future<bool> _refresh() => _refreshing ??= () async {
        try {
          final s = sessions.current!;
          final r = await Dio(BaseOptions(baseUrl: dio.options.baseUrl, connectTimeout: timeout)).post('/v1/auth/refresh', data: {'refreshToken': s.refreshToken});
          await sessions.save(s.copyWith(accessToken: r.data['accessToken'], refreshToken: r.data['refreshToken']));
          return true;
        } on DioException catch (e) {
          if (e.response?.statusCode == 401) await sessions.save(null);
          return false;
        } finally {
          scheduleMicrotask(() => _refreshing = null);
        }
      }();

  // ── Auth ──
  Future<Map<String, dynamic>> login(String identifier, String password) async {
    final r = await post('/v1/auth/login', {'identifier': identifier, 'password': password}) as Map<String, dynamic>;
    await sessions.save(Session(accessToken: r['accessToken'], refreshToken: r['refreshToken']));
    final me = await get('/v1/auth/me') as Map<String, dynamic>;
    final memberships = (me['memberships'] as List).cast<Map<String, dynamic>>();
    if (memberships.isEmpty) {
      await sessions.save(null);
      throw ApiException(403, 'NO_TENANT', 'This account is not part of any parking operator.');
    }
    final m = memberships.first;
    final facilityIds = (m['facilityIds'] as List).cast<String>();
    await sessions.save(sessions.current!.copyWith(tenantId: m['tenantId'], facilityId: facilityIds.isEmpty ? null : facilityIds.first));
    return me;
  }

  // ── Customer OTP auth (no operator/tenant context) ──

  /// Returns `{sentTo, expiresIn, devCode?}`. `devCode` only exists against a non-production API.
  Future<Map<String, dynamic>> requestOtp(String phone) async => (await post('/v1/auth/otp/request', {'phone': phone}) as Map).cast<String, dynamic>();

  /// Verifies the OTP, stores the session, returns `{user, isNewUser}`.
  Future<Map<String, dynamic>> verifyOtp(String phone, String code) async {
    final r = (await post('/v1/auth/otp/verify', {'phone': phone, 'code': code}) as Map).cast<String, dynamic>();
    await sessions.save(Session(accessToken: r['accessToken'], refreshToken: r['refreshToken']));
    return r;
  }

  Future<void> logout() async {
    try {
      await post('/v1/auth/logout');
    } catch (_) {/* best effort */}
    await sessions.save(null);
  }
}
