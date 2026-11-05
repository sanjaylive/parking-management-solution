import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:p2a_core/p2a_core.dart';

const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:4100');

final kvProvider = Provider<KeyValueStore>((_) => SecureKeyValueStore());
final appStateProvider = ChangeNotifierProvider<AppState>((ref) => AppState(ref.watch(kvProvider))..init());

/// Facility + gate configuration for this device. Cached so the app works when the API is unreachable.
class GateConfig {
  GateConfig(this.raw);
  final Map<String, dynamic> raw;
  String get facilityId => raw['id'];
  String get facilityName => raw['name'];
  int get offlineMaxProvisionalEntries => raw['offlineMaxProvisionalEntries'] ?? 0;
  List<Map<String, dynamic>> get gates => (raw['gates'] as List).cast<Map<String, dynamic>>();
  Set<String> get permissions => (raw['permissions'] as List).cast<String>().toSet();
  bool can(String p) => permissions.contains(p);
}

class AppState extends ChangeNotifier {
  AppState(this._kv)
      : sessions = SessionStore(_kv),
        queue = OfflineQueue(_kv);

  final KeyValueStore _kv;
  final SessionStore sessions;
  final OfflineQueue queue;
  late final ApiClient api = ApiClient(baseUrl: apiUrl, sessions: sessions);

  bool ready = false;
  bool online = true;
  bool syncing = false;
  GateConfig? config;
  Map<String, dynamic>? me;
  String? gateId;
  String? lastSyncMessage;
  Timer? _timer;

  bool get signedIn => sessions.current?.tenantId != null;
  int get pendingCount => queue.pending.length;
  int get attentionCount => queue.attention.length;

  Future<void> init() async {
    await sessions.load();
    try {
      await queue.load();
    } catch (_) {
      // Undecryptable queue (e.g. key wiped on reinstall). Never silently drop: surface it.
      lastSyncMessage = 'Offline queue could not be read on this device. Inform your supervisor.';
    }
    if (signedIn) await _loadConfig();
    ready = true;
    notifyListeners();
    sessions.changes.listen((s) {
      if (s == null) {
        config = null;
        notifyListeners();
      }
    });
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => syncNow());
  }

  Future<void> _loadConfig() async {
    final s = sessions.current!;
    final cacheKey = 'p2a.gateConfig.${s.tenantId}';
    try {
      final me = await api.get('/v1/auth/me') as Map<String, dynamic>;
      this.me = me;
      var facilityId = s.facilityId;
      if (facilityId == null) {
        final list = await api.get('/v1/facilities') as List;
        if (list.isEmpty) throw ApiException(404, 'NO_FACILITY', 'No facility assigned to you');
        facilityId = list.first['id'];
        await sessions.save(s.copyWith(facilityId: facilityId));
      }
      final c = await api.get('/v1/gate/config', query: {'facilityId': facilityId}) as Map<String, dynamic>;
      config = GateConfig(c);
      await _kv.write(cacheKey, jsonEncode({'config': c, 'me': me}));
      online = true;
    } on ApiException catch (e) {
      if (!e.isNetwork) rethrow;
      online = false;
      final cached = await _kv.read(cacheKey);
      if (cached != null) {
        final j = jsonDecode(cached);
        config = GateConfig((j['config'] as Map).cast<String, dynamic>());
        me = (j['me'] as Map).cast<String, dynamic>();
      }
    }
    gateId ??= config?.gates.isNotEmpty == true ? config!.gates.first['id'] : null;
  }

  Future<void> reloadConfig() async {
    try {
      await _loadConfig();
    } on ApiException catch (e) {
      lastSyncMessage = e.message;
    }
    notifyListeners();
  }

  Future<void> login(String id, String password) async {
    await api.login(id, password);
    await _loadConfig();
    notifyListeners();
  }

  Future<void> logout() async {
    await api.logout();
    me = null;
    config = null;
    notifyListeners();
  }

  void selectGate(String id) {
    gateId = id;
    notifyListeners();
  }

  void markOffline() {
    if (online) {
      online = false;
      notifyListeners();
    }
  }

  void markOnline() {
    if (!online) {
      online = true;
      notifyListeners();
      syncNow();
    }
  }

  Future<void> syncNow() async {
    if (!signedIn || syncing) return;
    syncing = true;
    notifyListeners();
    try {
      await api.get('/health');
      online = true;
      if (queue.pending.isNotEmpty) {
        final r = await queue.sync(api);
        lastSyncMessage = 'Synced ${r.accepted + r.duplicates} offline events${r.needsAttention > 0 ? ' · ${r.needsAttention} need attention' : ''}';
      }
    } on ApiException catch (e) {
      if (e.isNetwork) online = false;
    } finally {
      syncing = false;
      notifyListeners();
    }
  }

  Future<void> dismissAttention(String localId) async {
    await queue.dismissAttention(localId);
    notifyListeners();
  }

  /// Called after queueing an offline event so badges update.
  void queued() => notifyListeners();

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
