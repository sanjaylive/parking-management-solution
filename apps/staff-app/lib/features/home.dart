import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:p2a_design/p2a_design.dart';
import '../app/state.dart';
import 'gate.dart';
import 'inside.dart';
import 'shift.dart';
import 'sync.dart';

class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});
  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> with WidgetsBindingObserver {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) ref.read(appStateProvider).syncNow();
  }

  @override
  Widget build(BuildContext context) {
    final app = ref.watch(appStateProvider);
    final cfg = app.config;
    if (cfg == null) {
      return Scaffold(
        body: EmptyState(
          icon: Icons.cloud_off,
          title: 'No gate configuration',
          body: 'Connect to the network once to download this facility\'s setup.',
          action: FilledButton(onPressed: app.reloadConfig, child: const Text('Retry')),
        ),
      );
    }
    final pages = const [GateScreen(), InsideScreen(), ShiftScreen(), SyncScreen()];
    return Scaffold(
      appBar: AppBar(
        titleSpacing: P2ASpace.lg,
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(cfg.facilityName, style: context.text.titleMedium),
          Text('${app.me?['name'] ?? ''} · ${(app.me?['memberships'] as List?)?.firstOrNull?['role']?['name'] ?? ''}', style: context.text.bodySmall?.copyWith(color: context.colors.onSurfaceVariant)),
        ]),
        actions: [
          IconButton(tooltip: 'Sign out', icon: const Icon(Icons.logout), onPressed: () => _confirmLogout(context, app)),
        ],
        bottom: PreferredSize(preferredSize: const Size.fromHeight(36), child: _ConnectivityBar(app: app)),
      ),
      body: SafeArea(child: IndexedStack(index: _tab, children: pages)),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) {
          // Tabs stay alive in the IndexedStack; refetch server data whenever a tab is shown.
          if (i == 1) ref.invalidate(insideProvider);
          if (i == 2) ref.invalidate(shiftProvider);
          setState(() => _tab = i);
        },
        destinations: [
          const NavigationDestination(icon: Icon(Icons.qr_code_scanner), label: 'Gate'),
          const NavigationDestination(icon: Icon(Icons.directions_car_outlined), selectedIcon: Icon(Icons.directions_car), label: 'Inside'),
          const NavigationDestination(icon: Icon(Icons.payments_outlined), selectedIcon: Icon(Icons.payments), label: 'Shift'),
          NavigationDestination(
            icon: Badge(isLabelVisible: app.pendingCount + app.attentionCount > 0, label: Text('${app.pendingCount + app.attentionCount}'), child: const Icon(Icons.sync)),
            label: 'Sync',
          ),
        ],
      ),
    );
  }

  Future<void> _confirmLogout(BuildContext context, AppState app) async {
    final pending = app.pendingCount;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Sign out?'),
        content: Text(pending > 0 ? '$pending offline events are not synced yet. They stay on this device and will sync after the next sign-in.' : 'You can sign back in any time.'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Sign out'))],
      ),
    );
    if (ok == true) await app.logout();
  }
}

class _ConnectivityBar extends StatelessWidget {
  const _ConnectivityBar({required this.app});
  final AppState app;
  @override
  Widget build(BuildContext context) {
    final offline = !app.online;
    final color = offline ? context.status.warning : context.status.success;
    return Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: P2ASpace.lg),
      color: color.withValues(alpha: .12),
      child: Row(children: [
        Icon(offline ? Icons.cloud_off : Icons.cloud_done, size: 16, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            offline ? 'Offline — recording provisional events${app.pendingCount > 0 ? ' (${app.pendingCount} queued)' : ''}' : app.pendingCount > 0 ? 'Online — ${app.pendingCount} events waiting to sync' : 'Online',
            style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 13),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (app.syncing) SizedBox.square(dimension: 14, child: CircularProgressIndicator(strokeWidth: 2, color: color)),
      ]),
    );
  }
}
