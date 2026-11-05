import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'state.dart';

typedef Json = Map<String, dynamic>;
Json _m(dynamic v) => (v as Map).cast<String, dynamic>();
List<Json> _l(dynamic v) => (v as List).map(_m).toList();

class UserLocation {
  const UserLocation(this.lat, this.lng, {this.approximate = false});
  final double lat, lng;
  /// True when we fell back to a default city because location is unavailable/denied.
  final bool approximate;
}

/// Device location with a graceful fallback (Bengaluru centre) — the app must work without location permission.
final locationProvider = FutureProvider<UserLocation>((ref) async {
  const fallback = UserLocation(12.9716, 77.5946, approximate: true);
  // The whole step is time-boxed: a permission prompt the user ignores must never block the app.
  return _locate(fallback).timeout(const Duration(seconds: 6), onTimeout: () => fallback);
});

Future<UserLocation> _locate(UserLocation fallback) async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) return fallback;
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    if (p == LocationPermission.denied || p == LocationPermission.deniedForever) return fallback;
    final pos = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium, timeLimit: Duration(seconds: 8)));
    return UserLocation(pos.latitude, pos.longitude);
  } catch (_) {
    return fallback;
  }
}

class SearchFilters {
  const SearchFilters({this.q = '', this.ev = false, this.covered = false, this.valet = false, this.open24h = false, this.reservable = false, this.vehicleClass, this.sort = 'distance', this.radiusKm = 10});
  final String q;
  final bool ev, covered, valet, open24h, reservable;
  final String? vehicleClass;
  final String sort;
  final double radiusKm;

  SearchFilters copyWith({String? q, bool? ev, bool? covered, bool? valet, bool? open24h, bool? reservable, String? vehicleClass, bool clearVehicle = false, String? sort, double? radiusKm}) => SearchFilters(
        q: q ?? this.q, ev: ev ?? this.ev, covered: covered ?? this.covered, valet: valet ?? this.valet, open24h: open24h ?? this.open24h,
        reservable: reservable ?? this.reservable, vehicleClass: clearVehicle ? null : vehicleClass ?? this.vehicleClass, sort: sort ?? this.sort, radiusKm: radiusKm ?? this.radiusKm,
      );

  Map<String, dynamic> toQuery() => {
        if (q.isNotEmpty) 'q': q, if (ev) 'ev': 'true', if (covered) 'covered': 'true', if (valet) 'valet': 'true', if (open24h) 'open24h': 'true',
        if (reservable) 'reservable': 'true', 'vehicleClass': ?vehicleClass, 'sort': sort, 'radiusKm': '$radiusKm',
      };

  @override
  bool operator ==(Object other) => other is SearchFilters && other.toQuery().toString() == toQuery().toString();
  @override
  int get hashCode => toQuery().toString().hashCode;
}

final filtersProvider = StateProvider<SearchFilters>((_) => const SearchFilters());

final facilitiesProvider = FutureProvider.autoDispose<List<Json>>((ref) async {
  final loc = await ref.watch(locationProvider.future);
  final f = ref.watch(filtersProvider);
  final api = ref.read(appStateProvider).api;
  return _l(await api.get('/v1/public/facilities', query: {'lat': '${loc.lat}', 'lng': '${loc.lng}', ...f.toQuery()}));
});

final facilityProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) async => _m(await ref.read(appStateProvider).api.get('/v1/public/facilities/$id')));

final reservationsProvider = FutureProvider.autoDispose.family<List<Json>, String>((ref, scope) async => _l(await ref.read(appStateProvider).api.get('/v1/me/reservations', query: {'scope': scope})));

final reservationProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) async => _m(await ref.read(appStateProvider).api.get('/v1/me/reservations/$id')));

final activeSessionsProvider = FutureProvider.autoDispose<List<Json>>((ref) async => _l(await ref.read(appStateProvider).api.get('/v1/me/sessions', query: {'active': 'true'})));

final historyProvider = FutureProvider.autoDispose<List<Json>>((ref) async => _l(await ref.read(appStateProvider).api.get('/v1/me/sessions')));

final estimateProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) async => _m(await ref.read(appStateProvider).api.get('/v1/me/sessions/$id/estimate')));

final passesProvider = FutureProvider.autoDispose<List<Json>>((ref) async => _l(await ref.read(appStateProvider).api.get('/v1/me/passes')));
