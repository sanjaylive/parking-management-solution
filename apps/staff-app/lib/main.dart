import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:p2a_design/p2a_design.dart';
import 'app/state.dart';
import 'features/login.dart';
import 'features/home.dart';

void main() => runApp(const ProviderScope(child: StaffApp()));

class StaffApp extends ConsumerStatefulWidget {
  const StaffApp({super.key});
  @override
  ConsumerState<StaffApp> createState() => _StaffAppState();
}

class _StaffAppState extends ConsumerState<StaffApp> {
  late final GoRouter _router = GoRouter(
    refreshListenable: ref.read(appStateProvider),
    initialLocation: '/',
    redirect: (context, s) {
      final app = ref.read(appStateProvider);
      if (!app.ready) return '/splash';
      final atLogin = s.matchedLocation == '/login';
      if (!app.signedIn) return atLogin ? null : '/login';
      if (atLogin || s.matchedLocation == '/splash') return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const Scaffold(body: Center(child: CircularProgressIndicator()))),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/', builder: (_, _) => const HomeShell()),
    ],
  );

  @override
  Widget build(BuildContext context) => MaterialApp.router(
        title: 'Park2All Staff',
        debugShowCheckedModeBanner: false,
        theme: P2ATheme.light(),
        darkTheme: P2ATheme.dark(),
        routerConfig: _router,
      );
}
