import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:p2a_core/p2a_core.dart';

const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:4100');

final kvProvider = Provider<KeyValueStore>((_) => SecureKeyValueStore());
final appStateProvider = ChangeNotifierProvider<AppState>((ref) => AppState(ref.watch(kvProvider))..init());

enum Stage { loading, signedOut, needsProfile, needsVehicle, ready }

/// Session + onboarding state. Everything else is fetched on demand through providers.
class AppState extends ChangeNotifier {
  AppState(KeyValueStore kv) : sessions = SessionStore(kv);
  final SessionStore sessions;
  late final ApiClient api = ApiClient(baseUrl: apiUrl, sessions: sessions);

  Stage stage = Stage.loading;
  Map<String, dynamic>? me;
  List<Map<String, dynamic>> vehicles = [];
  String? error;

  Future<void> init() async {
    await sessions.load();
    sessions.changes.listen((s) {
      if (s == null && stage != Stage.signedOut) {
        stage = Stage.signedOut;
        notifyListeners();
      }
    });
    await refresh();
  }

  Future<void> refresh() async {
    if (sessions.current == null) {
      stage = Stage.signedOut;
      notifyListeners();
      return;
    }
    try {
      me = (await api.get('/v1/auth/me') as Map).cast<String, dynamic>();
      vehicles = (await api.get('/v1/me/vehicles') as List).map((e) => (e as Map).cast<String, dynamic>()).toList();
      stage = me!['profileComplete'] != true ? Stage.needsProfile : vehicles.isEmpty ? Stage.needsVehicle : Stage.ready;
      error = null;
    } on ApiException catch (e) {
      // Network trouble: keep the user signed in and let screens show their own retry states.
      if (e.isNetwork) {
        error = 'You are offline';
        stage = me == null ? Stage.signedOut : stage;
      } else if (e.status == 401) {
        stage = Stage.signedOut;
      } else {
        error = e.message;
      }
    }
    notifyListeners();
  }

  Future<Map<String, dynamic>> requestOtp(String phone) => api.requestOtp(phone);

  Future<void> verifyOtp(String phone, String code) async {
    await api.verifyOtp(phone, code);
    await refresh();
  }

  Future<void> saveProfile(String name, String? email) async {
    await api.patch('/v1/me/profile', {'name': name, if (email != null && email.isNotEmpty) 'email': email});
    await refresh();
  }

  Future<void> addVehicle(Map<String, dynamic> body) async {
    await api.post('/v1/me/vehicles', body);
    await refresh();
  }

  Future<void> removeVehicle(String vehicleId) async {
    await api.delete('/v1/me/vehicles/$vehicleId');
    await refresh();
  }

  Future<void> logout() async {
    await api.logout();
    me = null;
    vehicles = [];
    stage = Stage.signedOut;
    notifyListeners();
  }

  Future<void> deleteAccount() async {
    await api.post('/v1/me/delete-account');
    await sessions.save(null);
    me = null;
    stage = Stage.signedOut;
    notifyListeners();
  }
}
