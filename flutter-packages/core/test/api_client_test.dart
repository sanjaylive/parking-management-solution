import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:p2a_core/p2a_core.dart';

class _Adapter implements HttpClientAdapter {
  _Adapter(this.h);
  final ResponseBody Function(RequestOptions) h;
  final calls = <RequestOptions>[];
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? b, Future<void>? c) async {
    calls.add(o);
    return h(o);
  }
  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Object body, [int status = 200]) => ResponseBody.fromString(jsonEncode(body), status, headers: {'content-type': ['application/json']});

void main() {
  test('OTP verify stores a tenant-less customer session', () async {
    final sessions = SessionStore(MemoryKeyValueStore());
    final dio = Dio(BaseOptions(baseUrl: 'http://x'));
    dio.httpClientAdapter = _Adapter((o) => _json({'accessToken': 'a1', 'refreshToken': 'r1', 'isNewUser': true, 'user': {'id': 'u1'}}));
    final api = ApiClient(baseUrl: 'http://x', sessions: sessions, dio: dio);
    final r = await api.verifyOtp('+919900000001', '123456');
    expect(r['isNewUser'], true);
    expect(sessions.current!.accessToken, 'a1');
    expect(sessions.current!.tenantId, isNull);
  });

  test('API errors surface the stable code', () async {
    final dio = Dio(BaseOptions(baseUrl: 'http://x'));
    dio.httpClientAdapter = _Adapter((o) => _json({'code': 'OTP_INVALID', 'message': 'Incorrect OTP'}, 400));
    final api = ApiClient(baseUrl: 'http://x', sessions: SessionStore(MemoryKeyValueStore()), dio: dio);
    await expectLater(api.verifyOtp('+919900000001', '000000'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'OTP_INVALID').having((e) => e.isNetwork, 'isNetwork', false)));
  });

  test('when token refresh fails, the request fails once without retry loops', () async {
    final sessions = SessionStore(MemoryKeyValueStore());
    await sessions.save(Session(accessToken: 'old', refreshToken: 'r-old'));
    final dio = Dio(BaseOptions(baseUrl: 'http://x'));
    final a = _Adapter((o) => o.headers['authorization'] == 'Bearer old' ? _json({'code': 'UNAUTHORIZED', 'message': 'expired'}, 401) : _json({'ok': true}));
    dio.httpClientAdapter = a;
    final api = ApiClient(baseUrl: 'http://x', sessions: sessions, dio: dio);
    await expectLater(api.get('/v1/me/vehicles'), throwsA(isA<ApiException>()));
    expect(a.calls.where((c) => c.path == '/v1/me/vehicles').length, 1, reason: 'no retry storm when refresh fails');
  });
}
