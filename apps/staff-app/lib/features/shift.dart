import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:p2a_core/p2a_core.dart';
import 'package:p2a_design/p2a_design.dart';
import '../app/state.dart';

final shiftProvider = FutureProvider.autoDispose<Map<String, dynamic>?>((ref) async {
  final r = await ref.read(appStateProvider).api.get('/v1/shifts/current');
  return r is Map<String, dynamic> ? r : null;
});

class ShiftScreen extends ConsumerStatefulWidget {
  const ShiftScreen({super.key});
  @override
  ConsumerState<ShiftScreen> createState() => _ShiftScreenState();
}

class _ShiftScreenState extends ConsumerState<ShiftScreen> {
  final _float = TextEditingController(text: '0');
  final _counted = TextEditingController();
  bool _busy = false;

  Future<void> _act(Future<void> Function() fn) async {
    setState(() => _busy = true);
    try {
      await fn();
      ref.invalidate(shiftProvider);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.isNetwork ? 'Shifts need a connection.' : e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  int? _paise(String s) {
    final v = double.tryParse(s.trim());
    return v == null || v < 0 ? null : (v * 100).round();
  }

  @override
  Widget build(BuildContext context) {
    final app = ref.watch(appStateProvider);
    if (!app.config!.can('shift.own')) return const EmptyState(icon: Icons.lock_outline, title: 'Shifts not available for your role');
    final shift = ref.watch(shiftProvider);
    return ListView(padding: const EdgeInsets.all(P2ASpace.lg), children: [
      shift.when(
        loading: () => const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator())),
        error: (e, _) => EmptyState(icon: Icons.cloud_off, title: 'Could not load shift', body: '$e', action: OutlinedButton(onPressed: () => ref.invalidate(shiftProvider), child: const Text('Retry'))),
        data: (s) => s == null ? _openForm(app) : _openShift(app, s),
      ),
    ]);
  }

  Widget _openForm(AppState app) => Card(
        child: Padding(
          padding: const EdgeInsets.all(P2ASpace.lg),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Start your shift', style: context.text.titleLarge),
            const SizedBox(height: 4),
            Text('Cash collections are recorded against your open shift.', style: TextStyle(color: context.colors.onSurfaceVariant)),
            const SizedBox(height: P2ASpace.lg),
            TextField(controller: _float, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Opening float (₹)', prefixText: '₹ ')),
            const SizedBox(height: P2ASpace.lg),
            FilledButton(
              onPressed: _busy
                  ? null
                  : () => _act(() async {
                        final f = _paise(_float.text);
                        if (f == null) throw ApiException(400, 'INVALID', 'Enter a valid amount');
                        await app.api.post('/v1/shifts/open', {'facilityId': app.config!.facilityId, 'gateId': ?app.gateId, 'openingFloatMinor': f});
                      }),
              child: const Text('Open shift'),
            ),
          ]),
        ),
      );

  Widget _openShift(AppState app, Map<String, dynamic> s) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        GradientHeader(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Shift open since ${TimeOfDay.fromDateTime(DateTime.parse(s['openedAt']).toLocal()).format(context)}', style: TextStyle(color: Colors.white.withValues(alpha: .75))),
            const SizedBox(height: P2ASpace.md),
            Row(children: [
              Expanded(child: _stat('Collected', rupees(s['collectedMinor']), '${s['collections']} payments')),
              Expanded(child: _stat('Expected in drawer', rupees(s['expectedCashMinor']), 'incl. float ${rupees(s['openingFloatMinor'])}')),
            ]),
          ]),
        ),
        const SizedBox(height: P2ASpace.lg),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(P2ASpace.lg),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('Close shift', style: context.text.titleMedium),
              const SizedBox(height: 4),
              Text('Count the drawer and enter the total. Any shortage or overage is recorded for reconciliation.', style: TextStyle(color: context.colors.onSurfaceVariant)),
              const SizedBox(height: P2ASpace.lg),
              TextField(controller: _counted, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Counted cash (₹)', prefixText: '₹ ')),
              const SizedBox(height: P2ASpace.lg),
              OutlinedButton(
                onPressed: _busy
                    ? null
                    : () => _act(() async {
                          final c = _paise(_counted.text);
                          if (c == null) throw ApiException(400, 'INVALID', 'Enter the counted cash');
                          final r = await app.api.post('/v1/shifts/${s['id']}/close', {'declaredCashMinor': c}) as Map<String, dynamic>;
                          final v = r['varianceMinor'] as int;
                          _counted.clear();
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(v == 0 ? 'Shift closed — cash matches' : 'Shift closed with ${v < 0 ? 'shortage' : 'overage'} of ${rupees(v.abs())}')));
                          }
                        }),
                child: const Text('Close shift'),
              ),
            ]),
          ),
        ),
      ]);

  Widget _stat(String label, String value, String hint) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: TextStyle(color: Colors.white.withValues(alpha: .7), fontSize: 13)),
        Text(value, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
        Text(hint, style: TextStyle(color: Colors.white.withValues(alpha: .6), fontSize: 12)),
      ]);
}
