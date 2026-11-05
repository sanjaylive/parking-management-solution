import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:p2a_core/p2a_core.dart';
import 'package:p2a_design/p2a_design.dart';
import '../app/data.dart';
import '../app/state.dart';
import 'auth.dart' show vehicleClasses, friendlyError;
import 'common.dart';
import 'payment.dart';

const amenityIcons = {'CCTV': Icons.videocam_outlined, 'SECURITY_GUARD': Icons.shield_outlined, 'EV_CHARGING': Icons.ev_station, 'VALET': Icons.person_pin_outlined, 'COVERED': Icons.roofing, 'WASHROOM': Icons.wc, 'ACCESSIBLE': Icons.accessible};

String describeRate(Json? def) {
  if (def == null) return 'Rates on request';
  final base = def['base'] as Map;
  final unit = base['unitMinutes'] == 60 ? 'hr' : '${base['unitMinutes']} min';
  final parts = <String>[
    if (base['firstUnitAmount'] != null) '₹${base['firstUnitAmount']} first $unit, then ₹${base['amount']}/$unit' else '₹${base['amount']}/$unit',
    for (final w in (def['windows'] as List? ?? const []))
      if (w['multiplier'] != null) '${w['name']} ${w['from']}–${w['to']} ×${w['multiplier']}' else if (w['unitAmount'] != null) '${w['name']} ₹${w['unitAmount']}/$unit',
    if (def['overnight'] != null) 'overnight ${def['overnight']['from']}–${def['overnight']['to']} flat ₹${def['overnight']['flat']}',
    if (def['dailyCap'] != null) 'max ₹${def['dailyCap']}/day',
    if ((def['graceMinutes'] ?? 0) > 0) 'first ${def['graceMinutes']} min free',
  ];
  return parts.join(' · ');
}

class FacilityScreen extends ConsumerWidget {
  const FacilityScreen(this.id, {super.key});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final f = ref.watch(facilityProvider(id));
    return Scaffold(
      body: f.when(
        loading: () => const Loading(),
        error: (e, _) => SafeArea(child: ErrorView(e, onRetry: () => ref.invalidate(facilityProvider(id)))),
        data: (d) => CustomScrollView(slivers: [
          SliverAppBar(
            expandedHeight: 200,
            pinned: true,
            foregroundColor: Colors.white,
            backgroundColor: P2AColors.navy,
            flexibleSpace: FlexibleSpaceBar(
              titlePadding: const EdgeInsetsDirectional.only(start: 56, bottom: 14, end: 16),
              title: Text(d['name'], style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800), maxLines: 1, overflow: TextOverflow.ellipsis),
              background: (d['photos'] as List).isNotEmpty
                  ? Image.network((d['photos'] as List).first, fit: BoxFit.cover, errorBuilder: (_, _, _) => const _HeroArt())
                  : const _HeroArt(),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.all(P2ASpace.lg),
            sliver: SliverList.list(children: [
              Row(children: [
                Icon(Icons.place_outlined, size: 18, color: context.colors.onSurfaceVariant),
                const SizedBox(width: 6),
                Expanded(child: Text(d['addressLine'], style: TextStyle(color: context.colors.onSurfaceVariant))),
              ]),
              const SizedBox(height: 6),
              Row(children: [
                Icon(Icons.business_outlined, size: 18, color: context.colors.onSurfaceVariant),
                const SizedBox(width: 6),
                Text('Operated by ${d['operator']}', style: TextStyle(color: context.colors.onSurfaceVariant)),
                const Spacer(),
                if (d['rating']['count'] > 0) ...[const Icon(Icons.star_rounded, color: Colors.amber, size: 20), Text(' ${(d['rating']['average'] as num).toStringAsFixed(1)} (${d['rating']['count']})')],
              ]),
              const SizedBox(height: P2ASpace.lg),
              Wrap(spacing: 8, runSpacing: 8, children: [
                StatusChip(d['open24h'] == true ? 'Open 24×7' : 'See hours', icon: Icons.schedule, tone: StatusTone.brand),
                if (d['heightLimitCm'] != null) StatusChip('Max height ${(d['heightLimitCm'] / 100).toStringAsFixed(1)} m', icon: Icons.height),
                for (final a in d['amenities'] as List) StatusChip(a['label'], icon: amenityIcons[a['key']]),
              ]),
              const SizedBox(height: P2ASpace.xl),
              Text('Availability now', style: context.text.titleLarge),
              const SizedBox(height: P2ASpace.sm),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(P2ASpace.lg),
                  child: Column(children: [
                    for (final p in d['pools'] as List)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Row(children: [
                          SizedBox(width: 110, child: Text(vehicleClasses[p['vehicleClass']] ?? p['vehicleClass'], style: const TextStyle(fontWeight: FontWeight.w700))),
                          Expanded(
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(99),
                              child: LinearProgressIndicator(
                                minHeight: 10,
                                value: p['total'] == 0 ? 0.0 : (1 - p['available'] / p['total']).toDouble(),
                                color: availabilityColor(context, p['available'], p['total']),
                                backgroundColor: context.colors.surfaceContainerHighest,
                              ),
                            ),
                          ),
                          SizedBox(width: 72, child: Text('${p['available']} free', textAlign: TextAlign.end)),
                        ]),
                      ),
                  ]),
                ),
              ),
              const SizedBox(height: P2ASpace.xl),
              Text('Rates', style: context.text.titleLarge),
              const SizedBox(height: P2ASpace.sm),
              Card(
                child: Column(children: [
                  for (final r in d['rates'] as List)
                    ListTile(title: Text(vehicleClasses[r['vehicleClass']] ?? r['vehicleClass']), subtitle: Text(describeRate(r['definition'] as Json?))),
                ]),
              ),
              if (d['rules'] != null) ...[
                const SizedBox(height: P2ASpace.xl),
                Text('Good to know', style: context.text.titleLarge),
                const SizedBox(height: P2ASpace.sm),
                Text(d['rules']),
              ],
              if (d['cancellationPolicy'] != null) ...[
                const SizedBox(height: P2ASpace.md),
                Text('Free cancellation until ${d['cancellationPolicy']['freeUntilMinutesBefore']} min before start; after that ${d['cancellationPolicy']['feePercent']}% fee.', style: TextStyle(color: context.colors.onSurfaceVariant)),
              ],
              const SizedBox(height: 96),
            ]),
          ),
        ]),
      ),
      bottomNavigationBar: f.valueOrNull == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(P2ASpace.lg),
                child: f.value!['reservable'] == true
                    ? FilledButton.icon(onPressed: () => context.push('/facility/$id/reserve'), icon: const Icon(Icons.event_available), label: const Text('Reserve a spot'))
                    : const Text('Walk-in only — just drive up. Your number plate is recognised at the gate.', textAlign: TextAlign.center),
              ),
            ),
    );
  }
}

class _HeroArt extends StatelessWidget {
  const _HeroArt();
  @override
  Widget build(BuildContext context) => Container(
        decoration: const BoxDecoration(gradient: P2AColors.brandGradient),
        child: Align(alignment: const Alignment(.8, -.1), child: Icon(Icons.local_parking_rounded, size: 120, color: Colors.white.withValues(alpha: .18))),
      );
}

// ───────────────────────── Reserve ─────────────────────────

class ReserveScreen extends ConsumerStatefulWidget {
  const ReserveScreen(this.facilityId, {super.key});
  final String facilityId;
  @override
  ConsumerState<ReserveScreen> createState() => _ReserveScreenState();
}

class _ReserveScreenState extends ConsumerState<ReserveScreen> {
  String? _vehicleId;
  late DateTime _start = _roundUp(DateTime.now().add(const Duration(minutes: 15)));
  int _hours = 2;
  Json? _quote;
  String? _quoteError;
  bool _busy = false;
  Timer? _debounce;

  static DateTime _roundUp(DateTime d) => DateTime(d.year, d.month, d.day, d.hour, (d.minute ~/ 15 + 1) * 15);
  DateTime get _end => _start.add(Duration(hours: _hours));

  @override
  void initState() {
    super.initState();
    final vs = ref.read(appStateProvider).vehicles;
    _vehicleId = (vs.where((v) => v['isDefault'] == true).firstOrNull ?? vs.firstOrNull)?['vehicleId'];
    _requote();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  String? get _vehicleClass => ref.read(appStateProvider).vehicles.where((v) => v['vehicleId'] == _vehicleId).firstOrNull?['vehicle']?['vehicleClass'];

  /// Prices always come from the server; the app never computes a charge.
  void _requote() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250), () async {
      if (_vehicleClass == null) return;
      setState(() {
        _quote = null;
        _quoteError = null;
      });
      try {
        final q = await ref.read(appStateProvider).api.post('/v1/public/facilities/${widget.facilityId}/quote', {
          'vehicleClass': _vehicleClass,
          'startsAt': _start.toUtc().toIso8601String(),
          'endsAt': _end.toUtc().toIso8601String(),
        });
        if (mounted) setState(() => _quote = (q as Map).cast<String, dynamic>());
      } catch (e) {
        if (mounted) setState(() => _quoteError = friendlyError(e));
      }
    });
  }

  Future<void> _pickStart() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, initialDate: _start, firstDate: now, lastDate: now.add(const Duration(days: 90)));
    if (d == null || !mounted) return;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_start));
    if (t == null) return;
    final picked = DateTime(d.year, d.month, d.day, t.hour, t.minute);
    if (picked.isBefore(now)) return;
    setState(() => _start = picked);
    _requote();
  }

  Future<void> _book() async {
    final api = ref.read(appStateProvider).api;
    setState(() => _busy = true);
    try {
      final r = (await api.post('/v1/me/reservations', {
        'facilityId': widget.facilityId,
        'vehicleId': _vehicleId,
        'startsAt': _start.toUtc().toIso8601String(),
        'endsAt': _end.toUtc().toIso8601String(),
      }) as Map).cast<String, dynamic>();
      if (r['status'] == 'HELD') {
        final order = (await api.post('/v1/payments/orders', {'purpose': 'RESERVATION', 'reservationId': r['id']}) as Map).cast<String, dynamic>();
        if (!mounted) return;
        final paid = await showCheckout(context, order: order, title: 'Pay for your booking');
        if (!paid) {
          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Spot held until ${DateFormat('h:mm a').format(DateTime.parse(r['holdExpiresAt']).toLocal())}. Pay from Bookings to confirm.')));
        }
      }
      ref.invalidate(reservationsProvider('upcoming'));
      if (mounted) context.pushReplacement('/booking/${r['id']}');
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final vehicles = ref.watch(appStateProvider).vehicles;
    final fmt = DateFormat('EEE d MMM · h:mm a');
    final available = _quote?['available'] as int?;
    return Scaffold(
      appBar: AppBar(title: const Text('Reserve parking')),
      body: ListView(padding: const EdgeInsets.all(P2ASpace.lg), children: [
        Text('Vehicle', style: context.text.titleMedium),
        const SizedBox(height: P2ASpace.sm),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final v in vehicles)
            ChoiceChip(
              label: Text('${v['vehicle']['plateDisplay']} · ${vehicleClasses[v['vehicle']['vehicleClass']] ?? ''}'),
              selected: _vehicleId == v['vehicleId'],
              onSelected: (_) {
                setState(() => _vehicleId = v['vehicleId']);
                _requote();
              },
            ),
        ]),
        const SizedBox(height: P2ASpace.xl),
        Text('Arrival', style: context.text.titleMedium),
        const SizedBox(height: P2ASpace.sm),
        OutlinedButton.icon(onPressed: _pickStart, icon: const Icon(Icons.calendar_month), label: Text(fmt.format(_start)), style: OutlinedButton.styleFrom(alignment: Alignment.centerLeft)),
        const SizedBox(height: P2ASpace.xl),
        Text('Duration', style: context.text.titleMedium),
        const SizedBox(height: P2ASpace.sm),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final h in const [1, 2, 3, 4, 6, 8, 12, 24])
            ChoiceChip(
              label: Text(h == 24 ? '1 day' : '$h hr'),
              selected: _hours == h,
              onSelected: (_) {
                setState(() => _hours = h);
                _requote();
              },
            ),
        ]),
        const SizedBox(height: P2ASpace.sm),
        Text('Until ${fmt.format(_end)}', style: TextStyle(color: context.colors.onSurfaceVariant)),
        const SizedBox(height: P2ASpace.xl),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(P2ASpace.lg),
            child: _quoteError != null
                ? Text(_quoteError!, style: TextStyle(color: context.status.danger))
                : _quote == null
                    ? const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator()))
                    : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        for (final l in (_quote!['lines'] as List))
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 3),
                            child: Row(children: [Expanded(child: Text(l['label'], style: TextStyle(color: context.colors.onSurfaceVariant))), Text(rupees(l['amountMinor']))]),
                          ),
                        const Divider(height: 24),
                        Row(children: [
                          Text('Total', style: context.text.titleMedium),
                          const Spacer(),
                          Text(rupees(_quote!['netMinor']), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                        ]),
                        const SizedBox(height: 6),
                        Text(
                          available == 0 ? 'Fully booked for this time — try another slot.' : '${available ?? '—'} bookable spaces left for this time',
                          style: TextStyle(color: available == 0 ? context.status.danger : context.status.success, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 4),
                        Text('Overstay beyond your booking is charged at the standard rate on exit.', style: context.text.bodySmall),
                      ]),
          ),
        ),
      ]),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(P2ASpace.lg),
          child: FilledButton(
            onPressed: _busy || _quote == null || available == 0 || _vehicleId == null ? null : _book,
            child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5)) : Text(_quote == null ? 'Checking price…' : 'Book for ${rupees(_quote!['netMinor'])}'),
          ),
        ),
      ),
    );
  }
}
