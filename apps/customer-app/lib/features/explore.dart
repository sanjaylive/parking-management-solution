import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:p2a_design/p2a_design.dart';
import '../app/data.dart';
import 'auth.dart' show vehicleClasses;
import 'common.dart';

class ExploreScreen extends ConsumerStatefulWidget {
  const ExploreScreen({super.key});
  @override
  ConsumerState<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends ConsumerState<ExploreScreen> {
  bool _map = false;
  final _q = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final f = ref.watch(filtersProvider);
    final set = ref.read(filtersProvider.notifier);
    final list = ref.watch(facilitiesProvider);
    Widget chip(String label, bool on, SearchFilters Function(bool) next, {IconData? icon}) => FilterChip(
          avatar: icon == null ? null : Icon(icon, size: 16),
          label: Text(label),
          selected: on,
          onSelected: (v) => set.state = next(v),
        );

    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(P2ASpace.lg, P2ASpace.lg, P2ASpace.lg, 0),
        child: Row(children: [
          Expanded(
            child: TextField(
              controller: _q,
              textInputAction: TextInputAction.search,
              onSubmitted: (v) => set.state = f.copyWith(q: v.trim()),
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: 'Search parking',
                suffixIcon: f.q.isEmpty ? null : IconButton(tooltip: 'Clear', icon: const Icon(Icons.close), onPressed: () {
                  _q.clear();
                  set.state = f.copyWith(q: '');
                }),
              ),
            ),
          ),
          const SizedBox(width: P2ASpace.sm),
          IconButton.filledTonal(
            tooltip: _map ? 'List view' : 'Map view',
            onPressed: () => setState(() => _map = !_map),
            icon: Icon(_map ? Icons.view_list_rounded : Icons.map_outlined),
            style: IconButton.styleFrom(minimumSize: const Size(56, 56)),
          ),
        ]),
      ),
      SizedBox(
        height: 56,
        child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: P2ASpace.lg, vertical: 8), children: [
          PopupMenuButton<String>(
            tooltip: 'Sort',
            onSelected: (v) => set.state = f.copyWith(sort: v),
            itemBuilder: (_) => const [PopupMenuItem(value: 'distance', child: Text('Nearest')), PopupMenuItem(value: 'price', child: Text('Cheapest')), PopupMenuItem(value: 'availability', child: Text('Most available'))],
            child: Chip(avatar: const Icon(Icons.sort, size: 16), label: Text({'distance': 'Nearest', 'price': 'Cheapest', 'availability': 'Most free'}[f.sort]!)),
          ),
          const SizedBox(width: 8),
          PopupMenuButton<String?>(
            tooltip: 'Vehicle type',
            onSelected: (v) => set.state = v == 'ANY' ? f.copyWith(clearVehicle: true) : f.copyWith(vehicleClass: v),
            itemBuilder: (_) => [const PopupMenuItem(value: 'ANY', child: Text('Any vehicle')), for (final e in vehicleClasses.entries) PopupMenuItem(value: e.key, child: Text(e.value))],
            child: Chip(avatar: const Icon(Icons.directions_car, size: 16), label: Text(f.vehicleClass == null ? 'Any vehicle' : vehicleClasses[f.vehicleClass]!)),
          ),
          const SizedBox(width: 8),
          chip('EV', f.ev, (v) => f.copyWith(ev: v), icon: Icons.ev_station),
          const SizedBox(width: 8),
          chip('Covered', f.covered, (v) => f.copyWith(covered: v)),
          const SizedBox(width: 8),
          chip('Valet', f.valet, (v) => f.copyWith(valet: v)),
          const SizedBox(width: 8),
          chip('24 hours', f.open24h, (v) => f.copyWith(open24h: v)),
          const SizedBox(width: 8),
          chip('Bookable', f.reservable, (v) => f.copyWith(reservable: v)),
        ]),
      ),
      Expanded(
        child: list.when(
          loading: () => const Loading(),
          error: (e, _) => ErrorView(e, onRetry: () => ref.invalidate(facilitiesProvider)),
          data: (items) => _map
              ? _MapView(items)
              : items.isEmpty
                  ? const EmptyState(icon: Icons.search_off, title: 'No parking matches', body: 'Try removing a filter.')
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(P2ASpace.lg, 0, P2ASpace.lg, P2ASpace.lg),
                      itemCount: items.length,
                      separatorBuilder: (_, _) => const SizedBox(height: P2ASpace.sm),
                      itemBuilder: (_, i) => FacilityCard(items[i]),
                    ),
        ),
      ),
    ]);
  }
}

/// OpenStreetMap tiles (no key) for development. Production needs a commercial tile/maps provider.
class _MapView extends ConsumerStatefulWidget {
  const _MapView(this.items);
  final List<Json> items;
  @override
  ConsumerState<_MapView> createState() => _MapViewState();
}

class _MapViewState extends ConsumerState<_MapView> {
  Json? _selected;

  @override
  Widget build(BuildContext context) {
    final loc = ref.watch(locationProvider).valueOrNull ?? const UserLocation(12.9716, 77.5946);
    return Stack(children: [
      FlutterMap(
        options: MapOptions(initialCenter: LatLng(loc.lat, loc.lng), initialZoom: 13.5, onTap: (_, _) => setState(() => _selected = null)),
        children: [
          TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'com.park2all.customer_app'),
          MarkerLayer(markers: [
            if (!loc.approximate) Marker(point: LatLng(loc.lat, loc.lng), width: 22, height: 22, child: Container(decoration: BoxDecoration(color: P2AColors.electricBlue, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3)))),
            for (final f in widget.items)
              Marker(
                point: LatLng((f['latitude'] as num).toDouble(), (f['longitude'] as num).toDouble()),
                width: 74,
                height: 40,
                child: GestureDetector(
                  onTap: () => setState(() => _selected = f),
                  child: Container(
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: _selected?['id'] == f['id'] ? P2AColors.navy : availabilityColor(context, f['available'], f['total']),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: Colors.white, width: 2),
                      boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 6, offset: Offset(0, 2))],
                    ),
                    child: Text(f['available'] == 0 ? 'FULL' : 'P ${f['available']}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13)),
                  ),
                ),
              ),
          ]),
          const RichAttributionWidget(attributions: [TextSourceAttribution('OpenStreetMap contributors')]),
        ],
      ),
      if (_selected != null) Positioned(left: P2ASpace.lg, right: P2ASpace.lg, bottom: P2ASpace.lg, child: FacilityCard(_selected!, compact: true)),
      if (_selected == null && widget.items.isNotEmpty)
        Positioned(
          left: P2ASpace.lg,
          bottom: P2ASpace.lg,
          child: FilledButton.tonalIcon(onPressed: () => context.push('/facility/${widget.items.first['id']}'), icon: const Icon(Icons.near_me), label: Text('Nearest: ${widget.items.first['name']}')),
        ),
    ]);
  }
}
