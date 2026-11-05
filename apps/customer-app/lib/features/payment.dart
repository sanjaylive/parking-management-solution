import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:p2a_core/p2a_core.dart';
import 'package:p2a_design/p2a_design.dart';
import '../app/state.dart';

/// Checkout sheet. In this build the provider is the Park2All SANDBOX: "Pay" asks the API to emit a
/// signed provider webhook, exercising the real verification path. A production build opens the
/// gateway's checkout SDK here (adapter pending merchant credentials).
///
/// Either way the app never decides that payment succeeded — it polls the server, which only marks
/// success after a verified webhook. Returns true when the server confirms.
Future<bool> showCheckout(BuildContext context, {required Map<String, dynamic> order, required String title}) async =>
    await showModalBottomSheet<bool>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => _CheckoutSheet(order: order, title: title)) ?? false;

class _CheckoutSheet extends ConsumerStatefulWidget {
  const _CheckoutSheet({required this.order, required this.title});
  final Map<String, dynamic> order;
  final String title;
  @override
  ConsumerState<_CheckoutSheet> createState() => _CheckoutSheetState();
}

class _CheckoutSheetState extends ConsumerState<_CheckoutSheet> {
  String _method = 'UPI';
  String _state = 'idle'; // idle | paying | verifying | failed
  String? _error;

  Future<void> _pay({bool fail = false}) async {
    final api = ref.read(appStateProvider).api;
    setState(() {
      _state = 'paying';
      _error = null;
    });
    try {
      await api.post('/v1/payments/sandbox/simulate', {'orderId': widget.order['checkout']['orderId'], 'method': _method, 'outcome': fail ? 'failure' : 'success'});
      setState(() => _state = 'verifying');
      for (var i = 0; i < 10; i++) {
        final s = await api.get('/v1/payments/${widget.order['paymentId']}/status') as Map;
        if (s['status'] == 'SUCCEEDED') {
          if (mounted) Navigator.pop(context, true);
          return;
        }
        if (s['status'] == 'FAILED') throw ApiException(402, 'PAYMENT_FAILED', 'Payment was declined. No money was taken.');
        await Future<void>.delayed(const Duration(seconds: 1));
      }
      throw ApiException(408, 'PAYMENT_PENDING', 'Still waiting for the bank. We\'ll update your booking as soon as it confirms.');
    } on ApiException catch (e) {
      setState(() {
        _state = 'failed';
        _error = e.isNetwork ? 'Connection lost. If money was debited it will be confirmed or refunded automatically.' : e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final busy = _state == 'paying' || _state == 'verifying';
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(P2ASpace.xl, 0, P2ASpace.xl, P2ASpace.xl + MediaQuery.viewInsetsOf(context).bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(widget.title, style: context.text.titleLarge),
          const SizedBox(height: 4),
          Text(rupees(widget.order['amountMinor']), style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w800)),
          const SizedBox(height: P2ASpace.md),
          Container(
            padding: const EdgeInsets.all(P2ASpace.md),
            decoration: BoxDecoration(color: context.status.warning.withValues(alpha: .12), borderRadius: BorderRadius.circular(12)),
            child: Row(children: [
              Icon(Icons.science_outlined, color: context.status.warning),
              const SizedBox(width: P2ASpace.sm),
              const Expanded(child: Text('Sandbox payment — no real money moves. Confirmation still comes from a verified provider webhook.')),
            ]),
          ),
          const SizedBox(height: P2ASpace.lg),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'UPI', label: Text('UPI'), icon: Icon(Icons.qr_code_2)),
              ButtonSegment(value: 'CARD', label: Text('Card'), icon: Icon(Icons.credit_card)),
              ButtonSegment(value: 'NETBANKING', label: Text('Bank'), icon: Icon(Icons.account_balance)),
            ],
            selected: {_method},
            onSelectionChanged: busy ? null : (s) => setState(() => _method = s.first),
          ),
          const SizedBox(height: P2ASpace.lg),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: P2ASpace.md), child: Text(_error!, style: TextStyle(color: context.status.danger, fontWeight: FontWeight.w600))),
          FilledButton(
            onPressed: busy ? null : _pay,
            child: busy
                ? Row(mainAxisSize: MainAxisSize.min, children: [const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.5)), const SizedBox(width: 12), Text(_state == 'paying' ? 'Paying…' : 'Confirming with bank…')])
                : Text('Pay ${rupees(widget.order['amountMinor'])}'),
          ),
          TextButton(onPressed: busy ? null : () => _pay(fail: true), child: const Text('Simulate a declined payment')),
        ]),
      ),
    );
  }
}
