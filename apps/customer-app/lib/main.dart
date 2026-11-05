import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:p2a_design/p2a_design.dart';
import 'app/data.dart';
import 'app/state.dart';
import 'features/auth.dart';
import 'features/bookings.dart';
import 'features/explore.dart';
import 'features/facility.dart';
import 'features/home.dart';
import 'features/profile.dart';
import 'features/session.dart';

void main() => runApp(const ProviderScope(child: CustomerApp()));

class CustomerApp extends ConsumerStatefulWidget {
  const CustomerApp({super.key});
  @override
  ConsumerState<CustomerApp> createState() => _CustomerAppState();
}

class _CustomerAppState extends ConsumerState<CustomerApp> {
  late final GoRouter _router = GoRouter(
    refreshListenable: ref.read(appStateProvider),
    redirect: (context, s) {
      final stage = ref.read(appStateProvider).stage;
      final loc = s.matchedLocation;
      switch (stage) {
        case Stage.loading:
          return loc == '/splash' ? null : '/splash';
        case Stage.signedOut:
          return loc == '/login' ? null : '/login';
        case Stage.needsProfile:
        case Stage.needsVehicle:
          return loc == '/onboarding' ? null : '/onboarding';
        case Stage.ready:
          return (loc == '/login' || loc == '/onboarding' || loc == '/splash') ? '/' : null;
      }
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const Scaffold(body: Center(child: CircularProgressIndicator()))),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/onboarding', builder: (_, _) => const OnboardingScreen()),
      GoRoute(path: '/', builder: (_, s) => HomeShell(initialTab: int.tryParse(s.uri.queryParameters['tab'] ?? '') ?? 0)),
      GoRoute(path: '/facility/:id', builder: (_, s) => FacilityScreen(s.pathParameters['id']!)),
      GoRoute(path: '/facility/:id/reserve', builder: (_, s) => ReserveScreen(s.pathParameters['id']!)),
      GoRoute(path: '/booking/:id', builder: (_, s) => BookingScreen(s.pathParameters['id']!)),
      GoRoute(path: '/session/:id', builder: (_, s) => SessionScreen(s.pathParameters['id']!)),
    ],
  );

  @override
  Widget build(BuildContext context) => MaterialApp.router(
        title: 'Park2All',
        debugShowCheckedModeBanner: false,
        theme: P2ATheme.light(),
        darkTheme: P2ATheme.dark(),
        routerConfig: _router,
      );
}

class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key, this.initialTab = 0});
  final int initialTab;
  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  late int _tab = widget.initialTab;

  @override
  void didUpdateWidget(HomeShell old) {
    super.didUpdateWidget(old);
    if (old.initialTab != widget.initialTab) _tab = widget.initialTab;
  }

  void _select(int i) {
    // Tabs stay alive; refresh server data when a tab is shown.
    if (i == 0) {
      ref.invalidate(activeSessionsProvider);
      ref.invalidate(reservationsProvider('upcoming'));
    }
    if (i == 2) {
      ref.invalidate(reservationsProvider('upcoming'));
      ref.invalidate(reservationsProvider('past'));
      ref.invalidate(historyProvider);
    }
    if (i == 3) ref.invalidate(passesProvider);
    setState(() => _tab = i);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Row(children: [
            Container(
              width: 32,
              height: 32,
              alignment: Alignment.center,
              decoration: BoxDecoration(gradient: P2AColors.brandGradient, borderRadius: BorderRadius.circular(9)),
              child: const Icon(Icons.local_parking_rounded, color: Colors.white, size: 20),
            ),
            const SizedBox(width: 10),
            Text(const ['Park2All', 'Explore', 'Bookings', 'Profile'][_tab]),
          ]),
        ),
        body: SafeArea(child: IndexedStack(index: _tab, children: const [HomeScreen(), ExploreScreen(), BookingsScreen(), ProfileScreen()])),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: _select,
          destinations: const [
            NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Home'),
            NavigationDestination(icon: Icon(Icons.explore_outlined), selectedIcon: Icon(Icons.explore), label: 'Explore'),
            NavigationDestination(icon: Icon(Icons.confirmation_number_outlined), selectedIcon: Icon(Icons.confirmation_number), label: 'Bookings'),
            NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
          ],
        ),
      );
}
