import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:p2a_core/p2a_core.dart';
import 'package:p2a_design/p2a_design.dart';
import '../app/state.dart';

final insideProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, q) async {
  final app = ref.read(appStateProvider);
  final facilityId = app.config!.facilityId;
  final results = await Future.wait([
    app.api.get('/v1/sessions', query: {'facilityId': facilityId, 'active': 'true', 'pageSize': '50', if (q.isNotEmpty) 'q': q}),
    app.api.get('/v1/facilities/$facilityId/occupancy'),
  ]);
  return {'sessions': results[0], 'occupancy': results[1]};
});

/// Vehicles currently inside + occupancy rings.
class InsideScreen extends ConsumerStatefulWidget {
  const InsideScreen({super.key});
  @override
  ConsumerState<InsideScreen> createState() => _InsideScreenState();
}

class _InsideScreenState extends ConsumerState<InsideScreen> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final data = ref.watch(insideProvider(_q));
    return RefreshIndicator(
      onRefresh: () => ref.refresh(insideProvider(_q).future),
      child: ListView(padding: const EdgeInsets.all(P2ASpace.lg), children: [
        data.when(
          loading: () => const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator())),
          error: (e, _) => EmptyState(
            icon: (e is ApiException && e.isNetwork) ? Icons.cloud_off : Icons.error_outline,
            title: (e is ApiException && e.isNetwork) ? 'Offline' : 'Could not load',
            body: (e is ApiException && e.isNetwork) ? 'The list of vehicles inside needs a connection. Gate entries are still being recorded.' : '$e',
            action: OutlinedButton(onPressed: () => ref.invalidate(insideProvider(_q)), child: const Text('Retry')),
          ),
          data: (d) {
            final pools = ((d['occupancy'] as Map)['pools'] as List).cast<Map<String, dynamic>>();
            final sessions = ((d['sessions'] as Map)['items'] as List).cast<Map<String, dynamic>>();
            final total = pools.fold<int>(0, (s, p) => s + (p['total'] as int));
            final occ = pools.fold<int>(0, (s, p) => s + (p['occupied'] as int));
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              GradientHeader(
                child: Row(children: [
                  OccupancyRing(occupied: occ, total: total, size: 112),
                  const SizedBox(width: P2ASpace.xl),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('$occ inside', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
                      const SizedBox(height: 6),
                      for (final p in pools) Text('${p['vehicleClass']}: ${p['available']} free', style: TextStyle(color: Colors.white.withValues(alpha: .75))),
                    ]),
                  ),
                ]),
              ),
              const SizedBox(height: P2ASpace.lg),
              TextField(
                decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search plate'),
                textCapitalization: TextCapitalization.characters,
                onSubmitted: (v) => setState(() => _q = v.trim()),
              ),
              const SizedBox(height: P2ASpace.md),
              if (sessions.isEmpty) const EmptyState(icon: Icons.local_parking, title: 'No vehicles inside'),
              for (final s in sessions) _SessionTile(s),
            ]);
          },
        ),
      ]),
    );
  }
}

class _SessionTile extends StatelessWidget {
  const _SessionTile(this.s);
  final Map<String, dynamic> s;
  @override
  Widget build(BuildContext context) {
    final mins = DateTime.now().difference(DateTime.parse(s['entryAt'])).inMinutes;
    final slot = (s['assignments'] as List).firstOrNull?['slot']?['code'];
    final status = '${s['status']}';
    return Padding(
      padding: const EdgeInsets.only(bottom: P2ASpace.sm),
      child: Card(
        child: ListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: P2ASpace.lg, vertical: P2ASpace.sm),
          title: Align(alignment: Alignment.centerLeft, child: VehicleNumberPlate(s['plateNormalized'])),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text('${formatDuration(mins)} · ${'${s['source']}'.toLowerCase().replaceAll('_', '-')}${slot != null ? ' · slot $slot' : ''}${s['isProvisional'] == true ? ' · provisional' : ''}'),
          ),
          trailing: StatusChip(status.toLowerCase().replaceAll('_', ' '), tone: status == 'PAYMENT_PENDING' ? StatusTone.warning : status == 'EXIT_READY' ? StatusTone.success : StatusTone.brand),
        ),
      ),
    );
  }
}
