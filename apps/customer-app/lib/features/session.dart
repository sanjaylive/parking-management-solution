import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:p2a_core/p2a_core.dart';
import 'package:p2a_design/p2a_design.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../app/data.dart';
import '../app/state.dart';
import 'common.dart';
import 'payment.dart';

/// Live parking session. Elapsed time ticks locally; the charge is always the server's figure.
class SessionScreen extends ConsumerStatefulWidget {
  const SessionScreen(this.id, {super.key});
  final String id;
  @override
  ConsumerState<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends ConsumerState<SessionScreen> {
  Timer? _tick;
  bool _busy = false;
  int? _paidExitWithin;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (t) {
      if (mounted) setState(() {});
      if (t.tick % 60 == 0) ref.invalidate(estimateProvider(widget.id));
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _payNow() async {
    setState(() => _busy = true);
    try {
      final r = (await ref.read(appStateProvider).api.post('/v1/me/sessions/${widget.id}/checkout') as Map).cast<String, dynamic>();
      var ok = r['status'] == 'EXIT_READY';
      if (!ok && mounted) ok = await showCheckout(context, order: (r['order'] as Map).cast<String, dynamic>(), title: 'Pay & exit');
      if (ok) setState(() => _paidExitWithin = r['exitWithinMinutes']);
      ref.invalidate(estimateProvider(widget.id));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sessions = ref.watch(activeSessionsProvider);
    final est = ref.watch(estimateProvider(widget.id));
    final s = sessions.valueOrNull?.where((x) => x['id'] == widget.id).firstOrNull;
    return Scaffold(
      appBar: AppBar(title: const Text('Your parking')),
      body: s == null
          ? (sessions.isLoading ? const Loading() : const EmptyState(icon: Icons.check_circle_outline, title: 'Session ended', body: 'This stay is complete. Find the receipt in Bookings → Parking history.'))
          : ListView(padding: const EdgeInsets.all(P2ASpace.lg), children: [
              GradientHeader(
                child: Column(children: [
                  Text(s['facility']['name'], style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  const SizedBox(height: P2ASpace.lg),
                  Builder(builder: (_) {
                    final d = DateTime.now().difference(DateTime.parse(s['entryAt']));
                    String two(int n) => n.toString().padLeft(2, '0');
                    return Text('${d.inHours}:${two(d.inMinutes % 60)}:${two(d.inSeconds % 60)}', style: const TextStyle(fontSize: 52, fontWeight: FontWeight.w800, fontFeatures: [FontFeature.tabularFigures()]));
                  }),
                  Text('since ${fmtTime(s['entryAt'])}', style: TextStyle(color: Colors.white.withValues(alpha: .7))),
                  const SizedBox(height: P2ASpace.lg),
                  Wrap(spacing: 8, alignment: WrapAlignment.center, children: [
                    VehicleNumberPlate(s['plateNormalized']),
                    if ((s['assignments'] as List).isNotEmpty) StatusChip('Slot ${s['assignments'][0]['slot']['code']}', tone: StatusTone.success, icon: Icons.local_parking),
                  ]),
                ]),
              ),
              const SizedBox(height: P2ASpace.lg),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(P2ASpace.lg),
                  child: est.when(
                    loading: () => const Center(child: CircularProgressIndicator()),
                    error: (e, _) => Text(e is ApiException && e.isNetwork ? 'Offline — charge will update when you reconnect.' : '$e'),
                    data: (q) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      for (final l in q['lines'] as List)
                        Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [Expanded(child: Text(l['label'], style: TextStyle(color: context.colors.onSurfaceVariant))), Text(rupees(l['amountMinor']))])),
                      if (q['paidMinor'] > 0) Row(children: [Expanded(child: Text('Paid', style: TextStyle(color: context.colors.onSurfaceVariant))), Text('−${rupees(q['paidMinor'])}', style: TextStyle(color: context.status.success))]),
                      const Divider(height: 24),
                      Row(children: [
                        Text(q['outstandingMinor'] > 0 ? 'Due if you leave now' : 'Nothing due', style: context.text.titleMedium),
                        const Spacer(),
                        Text(rupees(q['outstandingMinor']), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                      ]),
                      const SizedBox(height: 4),
                      Text('Updated ${fmtTime(q['asOf'])}. The gate calculates the final amount when you exit.', style: context.text.bodySmall),
                    ]),
                  ),
                ),
              ),
              const SizedBox(height: P2ASpace.lg),
              if (_paidExitWithin != null)
                Container(
                  padding: const EdgeInsets.all(P2ASpace.lg),
                  decoration: BoxDecoration(color: context.status.success.withValues(alpha: .12), borderRadius: BorderRadius.circular(P2ASpace.radius)),
                  child: Row(children: [
                    Icon(Icons.check_circle, color: context.status.success),
                    const SizedBox(width: P2ASpace.md),
                    Expanded(child: Text('Paid. Please exit within $_paidExitWithin minutes — after that, extra time is charged at the gate.')),
                  ]),
                )
              else if ((est.valueOrNull?['outstandingMinor'] ?? 0) > 0)
                FilledButton.icon(onPressed: _busy ? null : _payNow, icon: const Icon(Icons.bolt), label: const Text('Pay now & skip the queue')),
              const SizedBox(height: P2ASpace.xl),
              if (s['ticket']?['qrToken'] != null)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(P2ASpace.lg),
                    child: Column(children: [
                      Text('Exit ticket', style: context.text.titleMedium),
                      const SizedBox(height: P2ASpace.md),
                      Container(color: Colors.white, padding: const EdgeInsets.all(10), child: QrImageView(data: s['ticket']['qrToken'], size: 160)),
                      const SizedBox(height: P2ASpace.sm),
                      Text(s['ticket']['number'], style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700)),
                      Text('Show at the exit gate, or just drive up — your plate is recognised.', textAlign: TextAlign.center, style: context.text.bodySmall),
                    ]),
                  ),
                ),
            ]),
    );
  }
}
