import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:p2a_core/p2a_core.dart';
import 'package:p2a_design/p2a_design.dart';

import '../app/data.dart' show Json;
export '../app/data.dart' show Json;

final _dt = DateFormat('EEE d MMM, h:mm a');
final _t = DateFormat('h:mm a');
String fmtDateTime(String iso) => _dt.format(DateTime.parse(iso).toLocal());
String fmtTime(String iso) => _t.format(DateTime.parse(iso).toLocal());

class ErrorView extends StatelessWidget {
  const ErrorView(this.error, {super.key, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final net = error is ApiException && (error as ApiException).isNetwork;
    return EmptyState(
      icon: net ? Icons.wifi_off_rounded : Icons.error_outline,
      title: net ? 'You\'re offline' : 'Something went wrong',
      body: net ? 'Check your connection and try again.' : (error is ApiException ? (error as ApiException).message : '$error'),
      action: OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
    );
  }
}

class Loading extends StatelessWidget {
  const Loading({super.key});
  @override
  Widget build(BuildContext context) => const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()));
}

/// Availability colour: green plenty, amber filling, red nearly full.
Color availabilityColor(BuildContext c, int available, int total) {
  if (total == 0 || available == 0) return c.status.danger;
  final r = available / total;
  return r > .3 ? c.status.success : r > .1 ? c.status.warning : c.status.danger;
}

class FacilityCard extends StatelessWidget {
  const FacilityCard(this.f, {super.key, this.compact = false});
  final Json f;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final avail = f['available'] as int, total = f['total'] as int;
    final color = availabilityColor(context, avail, total);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/facility/${f['id']}'),
        child: Padding(
          padding: const EdgeInsets.all(P2ASpace.lg),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(gradient: P2AColors.brandGradient, borderRadius: BorderRadius.circular(16)),
              child: const Icon(Icons.local_parking_rounded, color: Colors.white, size: 30),
            ),
            const SizedBox(width: P2ASpace.lg),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(f['name'], style: context.text.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text(
                  [if (f['distanceKm'] != null) '${f['distanceKm']} km', f['addressLine']].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: context.colors.onSurfaceVariant),
                ),
                const SizedBox(height: P2ASpace.sm),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  StatusChip(avail == 0 ? 'Full' : '$avail free', tone: color == context.status.success ? StatusTone.success : color == context.status.warning ? StatusTone.warning : StatusTone.danger),
                  if (!compact && f['covered'] == true) const StatusChip('Covered', icon: Icons.roofing),
                  if (!compact && f['hasEv'] == true) const StatusChip('EV', icon: Icons.ev_station, tone: StatusTone.brand),
                  if (!compact && f['hasValet'] == true) const StatusChip('Valet', icon: Icons.person_pin),
                  if (!compact && f['open24h'] == true) const StatusChip('24×7'),
                ]),
              ]),
            ),
            const SizedBox(width: P2ASpace.sm),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(f['hourlyMinor'] == null ? '—' : rupees(f['hourlyMinor']), style: context.text.titleMedium),
              Text('next hour', style: context.text.bodySmall?.copyWith(color: context.colors.onSurfaceVariant)),
            ]),
          ]),
        ),
      ),
    );
  }
}

const reservationTone = {
  'CONFIRMED': StatusTone.success, 'CHECKED_IN': StatusTone.brand, 'HELD': StatusTone.warning, 'PENDING_PAYMENT': StatusTone.warning,
  'COMPLETED': StatusTone.neutral, 'CANCELLED': StatusTone.neutral, 'EXPIRED': StatusTone.danger, 'NO_SHOW': StatusTone.danger,
};
String statusLabel(String s) => s == 'HELD' || s == 'PENDING_PAYMENT' ? 'awaiting payment' : s.toLowerCase().replaceAll('_', ' ');

class ReservationCard extends StatelessWidget {
  const ReservationCard(this.r, {super.key});
  final Json r;
  @override
  Widget build(BuildContext context) => Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(P2ASpace.radius),
          onTap: () => context.push('/booking/${r['id']}'),
          child: Padding(
            padding: const EdgeInsets.all(P2ASpace.lg),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(r['facilityName'] ?? r['facility']?['name'] ?? '', style: context.text.titleMedium, overflow: TextOverflow.ellipsis)),
                StatusChip(statusLabel(r['status']), tone: reservationTone[r['status']] ?? StatusTone.neutral),
              ]),
              const SizedBox(height: P2ASpace.sm),
              Row(children: [
                Icon(Icons.schedule, size: 16, color: context.colors.onSurfaceVariant),
                const SizedBox(width: 6),
                Expanded(child: Text('${fmtDateTime(r['startsAt'])} – ${fmtTime(r['endsAt'])}', style: TextStyle(color: context.colors.onSurfaceVariant))),
              ]),
              const SizedBox(height: P2ASpace.sm),
              Row(children: [
                if (r['vehicle'] != null) VehicleNumberPlate('${r['vehicle']['plateDisplay']}'.replaceAll(' ', '')),
                const Spacer(),
                Text(rupees(r['amountMinor']), style: context.text.titleMedium),
                if (r['qrToken'] != null) ...[const SizedBox(width: 8), Icon(Icons.qr_code_2, color: context.colors.primary)],
              ]),
            ]),
          ),
        ),
      );
}
