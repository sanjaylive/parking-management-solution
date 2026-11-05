import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:p2a_design/p2a_design.dart';
import '../app/state.dart';

/// Offline queue status: pending uploads and items the server flagged for attention.
class SyncScreen extends ConsumerWidget {
  const SyncScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final app = ref.watch(appStateProvider);
    final pending = app.queue.pending;
    final attention = app.queue.attention;
    return ListView(padding: const EdgeInsets.all(P2ASpace.lg), children: [
      Card(
        child: Padding(
          padding: const EdgeInsets.all(P2ASpace.lg),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Icon(app.online ? Icons.cloud_done : Icons.cloud_off, color: app.online ? context.status.success : context.status.warning),
              const SizedBox(width: P2ASpace.sm),
              Text(app.online ? 'Connected' : 'Offline', style: context.text.titleMedium),
              const Spacer(),
              Text('${pending.length} queued', style: context.text.bodyMedium),
            ]),
            if (app.lastSyncMessage != null) ...[const SizedBox(height: P2ASpace.sm), Text(app.lastSyncMessage!, style: TextStyle(color: context.colors.onSurfaceVariant))],
            const SizedBox(height: P2ASpace.md),
            FilledButton.icon(onPressed: app.syncing ? null : app.syncNow, icon: const Icon(Icons.sync), label: Text(app.syncing ? 'Syncing…' : 'Sync now')),
            const SizedBox(height: P2ASpace.sm),
            Text('Offline events are encrypted on this device and sync automatically every 20 seconds when the server is reachable.', style: context.text.bodySmall),
          ]),
        ),
      ),
      if (attention.isNotEmpty) ...[
        const SizedBox(height: P2ASpace.lg),
        Text('Needs attention', style: context.text.titleMedium),
        const SizedBox(height: P2ASpace.sm),
        for (final a in attention)
          Card(
            child: ListTile(
              leading: Icon(Icons.warning_amber, color: context.status.warning),
              title: Row(children: [VehicleNumberPlate('${a.event.data['plate']}'), const SizedBox(width: 8), StatusChip(a.event.type.toLowerCase())]),
              subtitle: Padding(padding: const EdgeInsets.only(top: 6), child: Text('${a.message} (${a.code}). Reported to supervisor review.')),
              trailing: IconButton(tooltip: 'Dismiss', icon: const Icon(Icons.close), onPressed: () => app.dismissAttention(a.event.localId)),
            ),
          ),
      ],
      const SizedBox(height: P2ASpace.lg),
      Text('Queued events', style: context.text.titleMedium),
      const SizedBox(height: P2ASpace.sm),
      if (pending.isEmpty) const EmptyState(icon: Icons.inbox_outlined, title: 'Nothing waiting to sync'),
      for (final e in pending)
        Card(
          child: ListTile(
            leading: Icon(e.type == 'ENTRY' ? Icons.login : Icons.logout),
            title: VehicleNumberPlate('${e.data['plate']}'),
            subtitle: Text('${e.type.toLowerCase()} · ${TimeOfDay.fromDateTime(e.occurredAt.toLocal()).format(context)}${e.type == 'EXIT' ? ' · cash ${rupees(e.data['cashCollectedMinor'])}' : ''}'),
          ),
        ),
    ]);
  }
}
