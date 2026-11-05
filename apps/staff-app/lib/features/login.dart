import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:p2a_core/p2a_core.dart';
import 'package:p2a_design/p2a_design.dart';
import '../app/state.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _id = TextEditingController();
  final _pw = TextEditingController();
  bool _busy = false, _obscure = true;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(appStateProvider).login(_id.text.trim(), _pw.text);
    } on ApiException catch (e) {
      setState(() => _error = e.isNetwork ? 'Cannot reach Park2All. Check the connection and try again.' : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(P2ASpace.xl),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: AutofillGroup(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    GradientHeader(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Container(
                          width: 44,
                          height: 44,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(gradient: P2AColors.brandGradient, borderRadius: BorderRadius.circular(12)),
                          child: const Text('P', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 20)),
                        ),
                        const SizedBox(height: P2ASpace.xl),
                        const Text('Park2All Staff', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 4),
                        Text('Gate, cashier and supervisor console', style: TextStyle(color: Colors.white.withValues(alpha: .7))),
                      ]),
                    ),
                    const SizedBox(height: P2ASpace.xl),
                    TextField(
                      controller: _id,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.username],
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(labelText: 'Email or mobile', prefixIcon: Icon(Icons.person_outline)),
                    ),
                    const SizedBox(height: P2ASpace.md),
                    TextField(
                      controller: _pw,
                      obscureText: _obscure,
                      autofillHints: const [AutofillHints.password],
                      onSubmitted: (_) => _submit(),
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          tooltip: _obscure ? 'Show password' : 'Hide password',
                          icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: P2ASpace.md),
                      Container(
                        padding: const EdgeInsets.all(P2ASpace.md),
                        decoration: BoxDecoration(color: context.status.danger.withValues(alpha: .1), borderRadius: BorderRadius.circular(12)),
                        child: Text(_error!, style: TextStyle(color: context.status.danger)),
                      ),
                    ],
                    const SizedBox(height: P2ASpace.xl),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5)) : const Text('Sign in'),
                    ),
                  ]),
                ),
              ),
            ),
          ),
        ),
      );
}
