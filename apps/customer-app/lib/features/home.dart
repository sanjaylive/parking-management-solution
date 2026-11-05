import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:p2a_design/p2a_design.dart';
import '../app/data.dart';
import '../app/state.dart';
import 'common.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final app = ref.watch(appStateProvider);
    final active = ref.watch(activeSessionsProvider);
    final upcoming = ref.watch(reservationsProvider('upcoming'));
    final nearby = ref.watch(facilitiesProvider);
    final loc = ref.watch(locationProvider).valueOrNull;
    final first = '${app.me?['name'] ?? ''}'.split(' ').first;

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(activeSessionsProvider);
        ref.invalidate(reservationsProvider('upcoming'));
        ref.invalidate(facilitiesProvider);
      },
      child: ListView(padding: const EdgeInsets.all(P2ASpace.lg), children: [
        GradientHeader(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(first.isEmpty ? 'Hello' : 'Hi $first', style: TextStyle(color: Colors.white.withValues(alpha: .75), fontSize: 15)),
            const SizedBox(height: 4),
            const Text('Where are you parking?', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
            const SizedBox(height: P2ASpace.lg),
            Material(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              child: InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () => context.go('/?tab=1'),
                child: const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  child: Row(children: [Icon(Icons.search, color: Color(0xFF5B6785)), SizedBox(width: 10), Text('Search malls, stations, offices…', style: TextStyle(color: Color(0xFF5B6785)))]),
                ),
              ),
            ),
            if (loc?.approximate == true) ...[
              const SizedBox(height: P2ASpace.sm),
              Text('Location off — showing Bengaluru', style: TextStyle(color: Colors.white.withValues(alpha: .65), fontSize: 12)),
            ],
          ]),
        ),
        ...active.when(
          loading: () => const <Widget>[],
          error: (_, _) => const <Widget>[],
          data: (list) => [for (final s in list) Padding(padding: const EdgeInsets.only(top: P2ASpace.lg), child: ActiveSessionCard(s))],
        ),
        ...upcoming.when(
          loading: () => const <Widget>[],
          error: (_, _) => const <Widget>[],
          data: (list) => list.isEmpty
              ? const <Widget>[]
              : [
                  const SizedBox(height: P2ASpace.xl),
                  Text('Upcoming', style: context.text.titleLarge),
                  const SizedBox(height: P2ASpace.sm),
                  for (final r in list.take(2)) Padding(padding: const EdgeInsets.only(bottom: P2ASpace.sm), child: ReservationCard(r)),
                ],
        ),
        const SizedBox(height: P2ASpace.xl),
        Text('Nearby parking', style: context.text.titleLarge),
        const SizedBox(height: P2ASpace.sm),
        nearby.when(
          loading: () => const Loading(),
          error: (e, _) => ErrorView(e, onRetry: () => ref.invalidate(facilitiesProvider)),
          data: (list) => list.isEmpty
              ? const EmptyState(icon: Icons.local_parking, title: 'No parking nearby', body: 'Try Explore to widen the search.')
              : Column(children: [for (final f in list.take(5)) Padding(padding: const EdgeInsets.only(bottom: P2ASpace.sm), child: FacilityCard(f))]),
        ),
      ]),
    );
  }
}

/// Live session: ticking timer locally, charge from the server (refreshed every 60s).
class ActiveSessionCard extends ConsumerStatefulWidget {
  const ActiveSessionCard(this.s, {super.key});
  final Json s;
  @override
  ConsumerState<ActiveSessionCard> createState() => _ActiveSessionCardState();
}

class _ActiveSessionCardState extends ConsumerState<ActiveSessionCard> {
  Timer? _tick;
  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (t) {
      if (mounted) setState(() {});
      if (t.tick % 60 == 0) ref.invalidate(estimateProvider(widget.s['id']));
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.s;
    final elapsed = DateTime.now().difference(DateTime.parse(s['entryAt']));
    final est = ref.watch(estimateProvider(s['id'])).valueOrNull;
    final slot = (s['assignments'] as List).firstOrNull?['slot']?['code'];
    String two(int n) => n.toString().padLeft(2, '0');
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/session/${s['id']}'),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: P2ASpace.lg, vertical: P2ASpace.sm),
            decoration: const BoxDecoration(gradient: P2AColors.cyanGradient),
            child: const Row(children: [
              Icon(Icons.radio_button_checked, color: Colors.white, size: 16),
              SizedBox(width: 6),
              Text('Parked now', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.all(P2ASpace.lg),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(s['facility']['name'], style: context.text.titleMedium),
                  const SizedBox(height: 4),
                  Row(children: [VehicleNumberPlate(s['plateNormalized']), if (slot != null) ...[const SizedBox(width: 8), StatusChip('Slot $slot', tone: StatusTone.brand)]]),
                ]),
              ),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text('${elapsed.inHours}:${two(elapsed.inMinutes % 60)}:${two(elapsed.inSeconds % 60)}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, fontFeatures: [FontFeature.tabularFigures()])),
                Text(est == null ? 'calculating…' : '${rupees(est['outstandingMinor'])} due', style: TextStyle(color: context.colors.onSurfaceVariant)),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}
