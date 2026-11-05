import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:p2a_core/p2a_core.dart';
import 'package:p2a_design/p2a_design.dart';
import '../app/state.dart';
import 'scanner.dart';

const vehicleClasses = {'CAR': 'Car', 'SUV': 'SUV', 'TWO_WHEELER': '2-wheeler', 'EV_CAR': 'EV car'};

/// Parses scanner/typed input into an API credential.
Map<String, dynamic> credentialFrom(String raw) {
  final v = raw.trim();
  if (v.startsWith('P2A1.')) return {'type': 'QR', 'token': v};
  if (RegExp(r'^[A-Z0-9]{2,8}-\d{6}-\d{8}$', caseSensitive: false).hasMatch(v)) return {'type': 'TICKET', 'number': v.toUpperCase()};
  return {'type': 'PLATE_MANUAL', 'plate': v.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '')};
}

class GateScreen extends ConsumerStatefulWidget {
  const GateScreen({super.key});
  @override
  ConsumerState<GateScreen> createState() => _GateScreenState();
}

class _GateScreenState extends ConsumerState<GateScreen> {
  bool _entry = true;
  String _class = 'CAR';
  bool _lost = false;
  bool _busy = false;
  final _input = TextEditingController();
  Map<String, dynamic>? _quote;
  Map<String, dynamic>? _result;
  String? _offlineNote;

  AppState get app => ref.read(appStateProvider);

  void _toast(String msg, {bool error = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(msg), backgroundColor: error ? context.status.danger : null));
  }

  Future<void> _run(Future<void> Function() fn) async {
    setState(() => _busy = true);
    try {
      await fn();
    } on ApiException catch (e) {
      if (e.isNetwork) {
        app.markOffline();
        await _offerOffline();
      } else {
        HapticFeedback.heavyImpact();
        _toast(e.message, error: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _scan() async {
    final v = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScannerScreen()));
    if (v == null) return;
    _input.text = v;
    _submit();
  }

  void _submit() {
    if (_input.text.trim().isEmpty) return;
    setState(() {
      _result = null;
      _offlineNote = null;
      if (_entry) _quote = null;
    });
    _entry ? _run(_doEntry) : _run(_doQuote);
  }

  Future<void> _doEntry() async {
    final r = await app.api.post('/v1/gate/entry', {
      'facilityId': app.config!.facilityId,
      'gateId': ?_gateFor(true),
      'credential': credentialFrom(_input.text),
      'vehicleClass': _class,
    }, ApiClient.newIdempotencyKey()) as Map<String, dynamic>;
    app.markOnline();
    HapticFeedback.mediumImpact();
    setState(() {
      _result = {'kind': 'entry', ...r};
      _input.clear();
    });
  }

  Future<void> _doQuote() async {
    final q = await app.api.post('/v1/gate/exit/quote', {
      'facilityId': app.config!.facilityId,
      'gateId': ?_gateFor(false),
      'credential': credentialFrom(_input.text),
      if (_lost) 'lostTicket': true,
    }) as Map<String, dynamic>;
    app.markOnline();
    setState(() => _quote = q);
  }

  Future<void> _cash() => _run(() async {
        await app.api.post('/v1/gate/sessions/${_quote!['sessionId']}/cash', {'amountMinor': _quote!['outstandingMinor']}, ApiClient.newIdempotencyKey());
        _toast('Cash ${rupees(_quote!['outstandingMinor'])} recorded');
        await _doQuote();
      });

  Future<void> _digital() => _run(() async {
        final o = await app.api.post('/v1/payments/staff-orders', {'purpose': 'PARKING_SESSION', 'sessionId': _quote!['sessionId']}) as Map<String, dynamic>;
        setState(() => _quote = {..._quote!, 'order': o});
      });

  Future<void> _confirmExit() => _run(() async {
        final r = await app.api.post('/v1/gate/exit/confirm', {
          'facilityId': app.config!.facilityId,
          'gateId': ?_gateFor(false),
          'credential': {'type': 'PLATE_MANUAL', 'plate': _quote!['plate']},
        }, ApiClient.newIdempotencyKey()) as Map<String, dynamic>;
        HapticFeedback.mediumImpact();
        setState(() {
          _result = {'kind': 'exit', ...r};
          _quote = null;
          _input.clear();
          _lost = false;
        });
      });

  String? _gateFor(bool entry) {
    final gates = app.config!.gates.where((g) => g['direction'] == 'BOTH' || g['direction'] == (entry ? 'ENTRY' : 'EXIT')).toList();
    final selected = gates.where((g) => g['id'] == app.gateId).firstOrNull;
    return (selected ?? gates.firstOrNull)?['id'];
  }

  /// Network failure: offer to record a provisional event. QR/ticket need the server, so plate only.
  Future<void> _offerOffline() async {
    final cred = credentialFrom(_input.text);
    if (cred['type'] != 'PLATE_MANUAL') {
      _toast('Offline: QR and tickets can\'t be verified. Type the vehicle number instead.', error: true);
      return;
    }
    final plate = cred['plate'] as String;
    final cfg = app.config!;
    if (_entry) {
      final ok = await _confirm('Server unreachable', 'Record a provisional entry for $plate? It will sync automatically and be reviewed if it conflicts.\n\nQueued offline entries: ${app.queue.pendingEntries(cfg.facilityId)}/${cfg.offlineMaxProvisionalEntries}');
      if (ok != true) return;
      try {
        final e = await app.queue.enqueueEntry(facilityId: cfg.facilityId, plate: plate, vehicleClass: _class, gateId: _gateFor(true), maxProvisionalEntries: cfg.offlineMaxProvisionalEntries);
        app.queued();
        setState(() {
          _offlineNote = 'Provisional entry recorded for $plate at ${TimeOfDay.fromDateTime(e.occurredAt).format(context)}. Ref ${e.localId.substring(4, 12).toUpperCase()}. Open the barrier manually per facility procedure.';
          _input.clear();
        });
      } on OfflineLimitReached catch (e) {
        _toast(e.toString(), error: true);
      }
    } else {
      if (!cfg.can('payment.collect_cash')) {
        _toast('Offline exits need a cashier or supervisor.', error: true);
        return;
      }
      final cash = await _askCash(plate);
      if (cash == null) return;
      await app.queue.enqueueExit(facilityId: cfg.facilityId, plate: plate, cashCollectedMinor: cash, gateId: _gateFor(false), lostTicket: _lost);
      app.queued();
      setState(() {
        _offlineNote = 'Offline exit recorded for $plate with ${rupees(cash)} cash. The server will recalculate the fee; any shortfall goes to supervisor review.';
        _input.clear();
        _quote = null;
      });
    }
  }

  Future<bool?> _confirm(String title, String body) => showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          icon: Icon(Icons.cloud_off, color: c.status.warning),
          title: Text(title),
          content: Text(body),
          actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Record offline'))],
        ),
      );

  Future<int?> _askCash(String plate) {
    final ctl = TextEditingController();
    return showDialog<int>(
      context: context,
      builder: (c) => AlertDialog(
        icon: Icon(Icons.cloud_off, color: c.status.warning),
        title: const Text('Offline exit'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Fees can\'t be calculated offline. Collect per the posted rate card and enter the cash received for $plate. Digital payments can\'t be verified offline.'),
          const SizedBox(height: P2ASpace.md),
          TextField(controller: ctl, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Cash received (₹)', prefixText: '₹ ')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final v = double.tryParse(ctl.text.trim());
              if (v == null || v < 0) return;
              Navigator.pop(c, (v * 100).round());
            },
            child: const Text('Record exit'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final cfg = appState.config!;
    final canEntry = cfg.can('session.entry');
    final canExit = cfg.can('session.exit');
    final gates = cfg.gates.where((g) => g['direction'] == 'BOTH' || g['direction'] == (_entry ? 'ENTRY' : 'EXIT')).toList();

    return ListView(padding: const EdgeInsets.all(P2ASpace.lg), children: [
      SegmentedButton<bool>(
        style: SegmentedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
        segments: [
          ButtonSegment(value: true, icon: const Icon(Icons.login), label: const Text('Entry'), enabled: canEntry),
          ButtonSegment(value: false, icon: const Icon(Icons.logout), label: const Text('Exit'), enabled: canExit),
        ],
        selected: {_entry},
        onSelectionChanged: (s) => setState(() {
          _entry = s.first;
          _quote = null;
          _result = null;
          _offlineNote = null;
        }),
      ),
      const SizedBox(height: P2ASpace.md),
      if (gates.length > 1)
        Wrap(spacing: 8, children: [
          for (final g in gates)
            ChoiceChip(label: Text('${g['name']}'), selected: _gateFor(_entry) == g['id'], onSelected: (_) => appState.selectGate(g['id'])),
        ]),
      const SizedBox(height: P2ASpace.md),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(P2ASpace.lg),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(
                child: TextField(
                  controller: _input,
                  textCapitalization: TextCapitalization.characters,
                  textInputAction: TextInputAction.go,
                  onSubmitted: (_) => _submit(),
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 24, fontWeight: FontWeight.w800, letterSpacing: 2),
                  decoration: InputDecoration(hintText: 'KA01AB1234', labelText: _entry ? 'Vehicle number or QR' : 'Ticket, QR or vehicle number'),
                ),
              ),
              const SizedBox(width: P2ASpace.sm),
              SizedBox(
                height: 64,
                width: 64,
                child: IconButton.filledTonal(tooltip: 'Scan QR', onPressed: _busy ? null : _scan, icon: const Icon(Icons.qr_code_scanner, size: 30)),
              ),
            ]),
            const SizedBox(height: P2ASpace.md),
            if (_entry)
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final e in vehicleClasses.entries)
                  ChoiceChip(label: Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text(e.value)), selected: _class == e.key, onSelected: (_) => setState(() => _class = e.key)),
              ])
            else
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _lost,
                onChanged: (v) => setState(() => _lost = v ?? false),
                title: const Text('Lost ticket'),
                subtitle: const Text('Needs vehicle number · adds lost-ticket fee'),
              ),
            const SizedBox(height: P2ASpace.md),
            FilledButton.icon(
              onPressed: _busy ? null : _submit,
              icon: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.5)) : Icon(_entry ? Icons.check_circle : Icons.receipt_long),
              label: Text(_entry ? 'Admit vehicle' : 'Calculate fee'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(64)),
            ),
          ]),
        ),
      ),
      if (_offlineNote != null) ...[const SizedBox(height: P2ASpace.md), _Banner(icon: Icons.cloud_off, color: context.status.warning, text: _offlineNote!)],
      if (_quote != null) ...[const SizedBox(height: P2ASpace.md), _QuoteCard(quote: _quote!, busy: _busy, canCash: cfg.can('payment.collect_cash'), onCash: _cash, onDigital: _digital, onRefresh: () => _run(_doQuote), onConfirm: _confirmExit)],
      if (_result != null) ...[const SizedBox(height: P2ASpace.md), _ResultCard(result: _result!)],
    ]);
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.icon, required this.color, required this.text});
  final IconData icon;
  final Color color;
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(P2ASpace.lg),
        decoration: BoxDecoration(color: color.withValues(alpha: .1), borderRadius: BorderRadius.circular(P2ASpace.radius), border: Border.all(color: color.withValues(alpha: .4))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Icon(icon, color: color), const SizedBox(width: P2ASpace.md), Expanded(child: Text(text))]),
      );
}

class _QuoteCard extends StatelessWidget {
  const _QuoteCard({required this.quote, required this.busy, required this.canCash, required this.onCash, required this.onDigital, required this.onRefresh, required this.onConfirm});
  final Map<String, dynamic> quote;
  final bool busy, canCash;
  final VoidCallback onCash, onDigital, onRefresh, onConfirm;

  @override
  Widget build(BuildContext context) {
    final due = quote['outstandingMinor'] as int;
    final lines = (quote['lines'] as List).cast<Map<String, dynamic>>();
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(
          color: context.colors.surfaceContainerHighest,
          padding: const EdgeInsets.all(P2ASpace.lg),
          child: Row(children: [
            VehicleNumberPlate(quote['plate'], large: true),
            const Spacer(),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text('Parked', style: context.text.bodySmall),
              Text(formatDuration(quote['durationMinutes']), style: context.text.titleLarge),
            ]),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.all(P2ASpace.lg),
          child: Column(children: [
            for (final l in lines) _row(context, l['label'], rupees(l['amountMinor'])),
            if ((quote['adjustmentsMinor'] ?? 0) != 0) _row(context, 'Adjustments', rupees(quote['adjustmentsMinor'])),
            if ((quote['paidMinor'] ?? 0) > 0) _row(context, 'Already paid', '−${rupees(quote['paidMinor'])}'),
            const Divider(height: P2ASpace.xl),
            Row(children: [
              Text(due > 0 ? 'To collect' : 'Nothing due', style: context.text.titleMedium),
              const Spacer(),
              Text(rupees(due), style: TextStyle(fontSize: 36, fontWeight: FontWeight.w800, color: due > 0 ? null : context.status.success)),
            ]),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(P2ASpace.lg, 0, P2ASpace.lg, P2ASpace.lg),
          child: due > 0
              ? Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    if (canCash) ...[Expanded(child: OutlinedButton.icon(onPressed: busy ? null : onCash, icon: const Icon(Icons.payments_outlined), label: const Text('Cash'))), const SizedBox(width: P2ASpace.sm)],
                    Expanded(child: OutlinedButton.icon(onPressed: busy ? null : onDigital, icon: const Icon(Icons.qr_code_2), label: const Text('UPI / Card'))),
                  ]),
                  if (quote['order'] != null) ...[
                    const SizedBox(height: P2ASpace.md),
                    Text('Payment order ${quote['order']['checkout']['orderId']} created for ${rupees(quote['order']['amountMinor'])}. Exit unlocks only after the payment provider confirms — not from the customer\'s screen.', style: context.text.bodySmall),
                  ],
                  TextButton.icon(onPressed: busy ? null : onRefresh, icon: const Icon(Icons.refresh), label: const Text('Refresh payment status')),
                ])
              : FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: context.status.success, minimumSize: const Size.fromHeight(64)),
                  onPressed: busy ? null : onConfirm,
                  icon: const Icon(Icons.check_circle),
                  label: const Text('Confirm exit & open barrier'),
                ),
        ),
      ]),
    );
  }

  Widget _row(BuildContext c, String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [Expanded(child: Text(label, style: TextStyle(color: c.colors.onSurfaceVariant))), Text(value, style: const TextStyle(fontWeight: FontWeight.w700))]),
      );
}

class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.result});
  final Map<String, dynamic> result;

  @override
  Widget build(BuildContext context) {
    final entry = result['kind'] == 'entry';
    final barrier = result['barrier'] as Map<String, dynamic>?;
    final plate = entry ? result['plate'] : result['receipt']['plate'];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(P2ASpace.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Icons.check_circle, color: context.status.success, size: 32),
            const SizedBox(width: P2ASpace.md),
            Text(entry ? 'Vehicle admitted' : 'Exit complete', style: context.text.titleLarge),
          ]),
          const SizedBox(height: P2ASpace.md),
          Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            VehicleNumberPlate(plate),
            if (entry) StatusChip('${result['source']}'.toLowerCase().replaceAll('_', '-'), tone: StatusTone.brand),
            if (entry && result['slot'] != null) StatusChip('Slot ${result['slot']['code']} · ${result['slot']['zoneName']}', tone: StatusTone.success, icon: Icons.local_parking),
            if (!entry) StatusChip('${formatDuration(result['receipt']['durationMinutes'])} · ${rupees(result['receipt']['totalMinor'])}'),
          ]),
          const SizedBox(height: P2ASpace.md),
          if (entry) Text('Ticket ${result['ticket']['number']}', style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700)),
          if (!entry)
            Text('Receipt ${((result['receipt']['payments'] as List).map((p) => p['receiptNumber']).whereType<String>().join(', ')).ifEmpty('—')}', style: const TextStyle(fontFamily: 'monospace')),
          const SizedBox(height: P2ASpace.sm),
          if (barrier != null) _barrier(context, barrier),
        ]),
      ),
    );
  }

  Widget _barrier(BuildContext c, Map<String, dynamic> b) => switch (b['status']) {
        'ACKED' => StatusChip('Barrier opened', tone: StatusTone.success, icon: Icons.door_sliding_outlined),
        'NO_DEVICE' => const StatusChip('Manual gate — wave vehicle through'),
        _ => StatusChip('Barrier ${'${b['status']}'.toLowerCase()} — ask supervisor for manual open', tone: StatusTone.danger, icon: Icons.warning_amber),
      };
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}
