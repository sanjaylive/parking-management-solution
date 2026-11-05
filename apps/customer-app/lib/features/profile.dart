import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:p2a_core/p2a_core.dart';
import 'package:p2a_design/p2a_design.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../app/data.dart';
import '../app/state.dart';
import 'auth.dart';
import 'common.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final app = ref.watch(appStateProvider);
    final passes = ref.watch(passesProvider);
    return ListView(padding: const EdgeInsets.all(P2ASpace.lg), children: [
      Card(
        child: ListTile(
          contentPadding: const EdgeInsets.all(P2ASpace.lg),
          leading: CircleAvatar(radius: 26, backgroundColor: context.colors.primary, child: Text('${app.me?['name'] ?? '?'}'.substring(0, 1).toUpperCase(), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 20))),
          title: Text('${app.me?['name'] ?? ''}', style: context.text.titleMedium),
          subtitle: Text([app.me?['phone'], app.me?['email']].whereType<String>().join(' · ')),
        ),
      ),
      const SizedBox(height: P2ASpace.xl),
      Row(children: [
        Text('My vehicles', style: context.text.titleLarge),
        const Spacer(),
        TextButton.icon(
          onPressed: () => showModalBottomSheet(
            context: context,
            isScrollControlled: true,
            showDragHandle: true,
            builder: (c) => Padding(
              padding: EdgeInsets.fromLTRB(P2ASpace.xl, 0, P2ASpace.xl, P2ASpace.xl + MediaQuery.viewInsetsOf(c).bottom),
              child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [Text('Add vehicle', style: c.text.titleLarge), const SizedBox(height: P2ASpace.lg), VehicleForm(onSaved: () => Navigator.pop(c))])),
            ),
          ),
          icon: const Icon(Icons.add),
          label: const Text('Add'),
        ),
      ]),
      for (final v in app.vehicles)
        Padding(
          padding: const EdgeInsets.only(bottom: P2ASpace.sm),
          child: Card(
            child: ListTile(
              title: Align(alignment: Alignment.centerLeft, child: VehicleNumberPlate(v['vehicle']['plateNormalized'])),
              subtitle: Padding(padding: const EdgeInsets.only(top: 6), child: Text([v['nickname'], vehicleClasses[v['vehicle']['vehicleClass']]].whereType<String>().join(' · '))),
              trailing: IconButton(
                tooltip: 'Remove vehicle',
                icon: const Icon(Icons.delete_outline),
                onPressed: app.vehicles.length <= 1
                    ? null
                    : () async {
                        try {
                          await app.removeVehicle(v['vehicleId']);
                        } on ApiException catch (e) {
                          if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
                        }
                      },
              ),
            ),
          ),
        ),
      const SizedBox(height: P2ASpace.xl),
      Text('Monthly passes', style: context.text.titleLarge),
      const SizedBox(height: P2ASpace.sm),
      passes.when(
        loading: () => const Loading(),
        error: (e, _) => ErrorView(e, onRetry: () => ref.invalidate(passesProvider)),
        data: (list) => list.isEmpty
            ? Card(child: ListTile(leading: const Icon(Icons.card_membership), title: const Text('No passes yet'), subtitle: const Text('Ask your parking operator about monthly, resident or employee passes.')))
            : Column(children: [for (final p in list) _PassCard(p)]),
      ),
      const SizedBox(height: P2ASpace.xl),
      Card(
        child: Column(children: [
          ListTile(leading: const Icon(Icons.support_agent), title: const Text('Help & support'), subtitle: const Text('support@park2all.example')),
          ListTile(leading: const Icon(Icons.privacy_tip_outlined), title: const Text('Privacy'), subtitle: const Text('Number plates are used only to manage your parking and are retained per operator policy.')),
          ListTile(leading: const Icon(Icons.logout), title: const Text('Sign out'), onTap: app.logout),
          ListTile(
            leading: Icon(Icons.delete_forever_outlined, color: context.status.danger),
            title: Text('Delete account', style: TextStyle(color: context.status.danger)),
            onTap: () async {
              final ok = await showDialog<bool>(
                context: context,
                builder: (c) => AlertDialog(
                  title: const Text('Delete your account?'),
                  content: const Text('You will be signed out everywhere and your profile will be removed. Payment records are kept as required by law.'),
                  actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), FilledButton(style: FilledButton.styleFrom(backgroundColor: c.status.danger), onPressed: () => Navigator.pop(c, true), child: const Text('Delete'))],
                ),
              );
              if (ok == true) await app.deleteAccount();
            },
          ),
        ]),
      ),
    ]);
  }
}

class _PassCard extends StatelessWidget {
  const _PassCard(this.p);
  final Json p;
  @override
  Widget build(BuildContext context) => Card(
        child: ExpansionTile(
          leading: const Icon(Icons.card_membership),
          title: Text(p['plan']['name']),
          subtitle: Text('${p['status']}'.toLowerCase() == 'active' ? 'Valid until ${fmtDateTime(p['validUntil'])}' : '${p['status']}'.toLowerCase()),
          children: [if (p['qrToken'] != null) Padding(padding: const EdgeInsets.all(P2ASpace.lg), child: Container(color: Colors.white, padding: const EdgeInsets.all(8), child: QrImageView(data: p['qrToken'], size: 180)))],
        ),
      );
}
