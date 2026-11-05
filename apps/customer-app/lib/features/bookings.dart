import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:p2a_core/p2a_core.dart';
import 'package:p2a_design/p2a_design.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../app/data.dart';
import '../app/state.dart';
import 'common.dart';
import 'payment.dart';

class BookingsScreen extends ConsumerWidget {
  const BookingsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => DefaultTabController(
        length: 3,
        child: Column(children: [
          const TabBar(tabs: [Tab(text: 'Upcoming'), Tab(text: 'Past'), Tab(text: 'Parking history')]),
          Expanded(
            child: TabBarView(children: [
              _ReservationList('upcoming', empty: const EmptyState(icon: Icons.event_available, title: 'No upcoming bookings', body: 'Reserve a spot from Explore and it will show here with your QR pass.')),
              _ReservationList('past', empty: const EmptyState(icon: Icons.history, title: 'No past bookings')),
              const _History(),
            ]),
          ),
        ]),
      );
}

class _ReservationList extends ConsumerWidget {
  const _ReservationList(this.scope, {required this.empty});
  final String scope;
  final Widget empty;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(reservationsProvider(scope));
    return RefreshIndicator(
      onRefresh: () => ref.refresh(reservationsProvider(scope).future),
      child: list.when(
        loading: () => const Loading(),
        error: (e, _) => ListView(children: [ErrorView(e, onRetry: () => ref.invalidate(reservationsProvider(scope)))]),
        data: (rs) => rs.isEmpty
            ? ListView(children: [empty])
            : ListView.separated(
                padding: const EdgeInsets.all(P2ASpace.lg),
                itemCount: rs.length,
                separatorBuilder: (_, _) => const SizedBox(height: P2ASpace.sm),
                itemBuilder: (_, i) => ReservationCard(rs[i]),
              ),
      ),
    );
  }
}

class _History extends ConsumerWidget {
  const _History();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final h = ref.watch(historyProvider);
    return h.when(
      loading: () => const Loading(),
      error: (e, _) => ErrorView(e, onRetry: () => ref.invalidate(historyProvider)),
      data: (list) => list.isEmpty
          ? const EmptyState(icon: Icons.local_parking, title: 'No parking yet', body: 'Your stays at Park2All facilities appear here, including walk-ins recognised by your number plate.')
          : ListView.separated(
              padding: const EdgeInsets.all(P2ASpace.lg),
              itemCount: list.length,
              separatorBuilder: (_, _) => const SizedBox(height: P2ASpace.sm),
              itemBuilder: (_, i) {
                final s = list[i];
                final done = s['exitAt'] != null;
                return Card(
                  child: ListTile(
                    onTap: done ? null : () => context.push('/session/${s['id']}'),
                    title: Text(s['facility']['name']),
                    subtitle: Text('${fmtDateTime(s['entryAt'])} · ${formatDuration(s['elapsedMinutes'])}'),
                    trailing: done ? Text(rupees(s['amountPaidMinor']), style: context.text.titleMedium) : const StatusChip('parked', tone: StatusTone.brand),
                  ),
                );
              },
            ),
    );
  }
}

/// Booking detail with the QR entry pass.
class BookingScreen extends ConsumerWidget {
  const BookingScreen(this.id, {super.key});
  final String id;

  Future<void> _pay(BuildContext context, WidgetRef ref) async {
    final api = ref.read(appStateProvider).api;
    try {
      final order = (await api.post('/v1/payments/orders', {'purpose': 'RESERVATION', 'reservationId': id}) as Map).cast<String, dynamic>();
      if (!context.mounted) return;
      await showCheckout(context, order: order, title: 'Pay for your booking');
    } on ApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
    ref.invalidate(reservationProvider(id));
    ref.invalidate(reservationsProvider('upcoming'));
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Cancel booking?'),
        content: const Text('Free cancellation applies until the cut-off shown on the facility page. After that a cancellation fee may apply.'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep booking')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Cancel booking'))],
      ),
    );
    if (ok != true) return;
    try {
      final r = (await ref.read(appStateProvider).api.post('/v1/me/reservations/$id/cancel') as Map);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(r['refundDueMinor'] > 0 ? 'Cancelled. Refund of ${rupees(r['refundDueMinor'])} will be processed.' : 'Booking cancelled.'),
        ));
      }
    } on ApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
    ref.invalidate(reservationProvider(id));
    ref.invalidate(reservationsProvider('upcoming'));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final r = ref.watch(reservationProvider(id));
    return Scaffold(
      appBar: AppBar(title: const Text('Booking')),
      body: r.when(
        loading: () => const Loading(),
        error: (e, _) => ErrorView(e, onRetry: () => ref.invalidate(reservationProvider(id))),
        data: (b) {
          final status = b['status'] as String;
          final unpaid = status == 'HELD' || status == 'PENDING_PAYMENT';
          final cancellable = unpaid || status == 'CONFIRMED';
          return ListView(padding: const EdgeInsets.all(P2ASpace.lg), children: [
            QRPassCard(booking: b),
            const SizedBox(height: P2ASpace.lg),
            if (unpaid) ...[
              FilledButton.icon(onPressed: () => _pay(context, ref), icon: const Icon(Icons.lock_outline), label: Text('Pay ${rupees(b['amountMinor'] - b['paidMinor'])} to confirm')),
              if (b['holdExpiresAt'] != null)
                Padding(padding: const EdgeInsets.only(top: 8), child: Text('Spot held until ${fmtTime(b['holdExpiresAt'])}', textAlign: TextAlign.center, style: TextStyle(color: context.status.warning))),
              const SizedBox(height: P2ASpace.lg),
            ],
            Card(
              child: Column(children: [
                ListTile(leading: const Icon(Icons.place_outlined), title: Text(b['facility']['name']), subtitle: Text(b['facility']['addressLine'])),
                ListTile(leading: const Icon(Icons.schedule), title: Text(fmtDateTime(b['startsAt'])), subtitle: Text('until ${fmtDateTime(b['endsAt'])}')),
                ListTile(leading: const Icon(Icons.receipt_long_outlined), title: Text(rupees(b['amountMinor'])), subtitle: Text(b['paidMinor'] > 0 ? 'Paid ${rupees(b['paidMinor'])}' : 'Not paid')),
              ]),
            ),
            if (cancellable) ...[
              const SizedBox(height: P2ASpace.lg),
              OutlinedButton(onPressed: () => _cancel(context, ref), child: const Text('Cancel booking')),
            ],
          ]);
        },
      ),
    );
  }
}

class QRPassCard extends StatelessWidget {
  const QRPassCard({super.key, required this.booking});
  final Json booking;

  @override
  Widget build(BuildContext context) {
    final qr = booking['qrToken'] as String?;
    final status = booking['status'] as String;
    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: Container(
        decoration: const BoxDecoration(gradient: P2AColors.brandGradient),
        padding: const EdgeInsets.all(P2ASpace.xl),
        child: Column(children: [
          Row(children: [
            Expanded(child: Text(booking['facility']?['name'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800))),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: Colors.white.withValues(alpha: .18), borderRadius: BorderRadius.circular(99)),
              child: Text(statusLabel(status), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12)),
            ),
          ]),
          const SizedBox(height: P2ASpace.xl),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
            child: qr == null
                ? SizedBox.square(
                    dimension: 200,
                    child: Center(
                      child: Text(
                        status == 'HELD' || status == 'PENDING_PAYMENT' ? 'Your QR pass appears\nonce payment is confirmed' : 'Pass no longer valid',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Color(0xFF5B6785), fontWeight: FontWeight.w600),
                      ),
                    ),
                  )
                : Semantics(label: 'Entry QR code', child: QrImageView(data: qr, size: 200, gapless: true, errorCorrectionLevel: QrErrorCorrectLevel.M)),
          ),
          const SizedBox(height: P2ASpace.lg),
          Text(booking['code'] ?? '', style: const TextStyle(color: Colors.white, fontFamily: 'monospace', fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: 2)),
          const SizedBox(height: 4),
          Text(qr != null ? 'Show this at the entry gate. Your number plate also works.' : '', textAlign: TextAlign.center, style: TextStyle(color: Colors.white.withValues(alpha: .8))),
          if (booking['vehicle'] != null) ...[const SizedBox(height: P2ASpace.md), VehicleNumberPlate('${booking['vehicle']['plateNormalized'] ?? booking['vehicle']['plateDisplay']}'.replaceAll(' ', ''))],
        ]),
      ),
    );
  }
}
