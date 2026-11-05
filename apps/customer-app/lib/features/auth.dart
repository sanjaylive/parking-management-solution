import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:p2a_core/p2a_core.dart';
import 'package:p2a_design/p2a_design.dart';
import '../app/state.dart';

const vehicleClasses = {'CAR': 'Car', 'SUV': 'SUV', 'TWO_WHEELER': 'Two-wheeler', 'EV_CAR': 'Electric car', 'EV_TWO_WHEELER': 'Electric 2W'};

String friendlyError(Object e) => e is ApiException ? (e.isNetwork ? 'Can\'t reach Park2All. Check your connection.' : e.message) : 'Something went wrong';

/// One flow for new and returning users: phone → OTP. No separate sign-up.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phone = TextEditingController();
  final _otp = TextEditingController();
  String? _sentTo, _error, _devCode;
  bool _busy = false;
  int _cooldown = 0;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  String get _e164 => '+91${_phone.text.replaceAll(RegExp(r'\D'), '')}';

  Future<void> _send() async {
    if (_phone.text.replaceAll(RegExp(r'\D'), '').length != 10) {
      setState(() => _error = 'Enter your 10-digit mobile number');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await ref.read(appStateProvider).requestOtp(_e164);
      setState(() {
        _sentTo = r['sentTo'];
        _devCode = r['devCode'];
        _cooldown = 30;
      });
      _timer?.cancel();
      _timer = Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted || _cooldown <= 1) t.cancel();
        if (mounted) setState(() => _cooldown = (_cooldown - 1).clamp(0, 30));
      });
    } catch (e) {
      setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    if (_otp.text.length != 6) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(appStateProvider).verifyOtp(_e164, _otp.text);
    } catch (e) {
      _otp.clear();
      setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final otpStep = _sentTo != null;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(P2ASpace.xl),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                GradientHeader(
                  padding: const EdgeInsets.all(28),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Container(
                      width: 48,
                      height: 48,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(gradient: P2AColors.brandGradient, borderRadius: BorderRadius.circular(14)),
                      child: const Icon(Icons.local_parking_rounded, size: 28),
                    ),
                    const SizedBox(height: 28),
                    const Text('Park smarter.', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, height: 1.1)),
                    const SizedBox(height: 6),
                    Text('Find, book and pay for parking in seconds.', style: TextStyle(color: Colors.white.withValues(alpha: .75), fontSize: 15)),
                  ]),
                ),
                const SizedBox(height: P2ASpace.xl),
                if (!otpStep) ...[
                  Text('Your mobile number', style: context.text.titleMedium),
                  const SizedBox(height: P2ASpace.sm),
                  TextField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    autofillHints: const [AutofillHints.telephoneNumberNational],
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, letterSpacing: 1.5),
                    onSubmitted: (_) => _send(),
                    decoration: const InputDecoration(prefixText: '+91  ', hintText: '98765 43210'),
                  ),
                  const SizedBox(height: P2ASpace.lg),
                  FilledButton(onPressed: _busy ? null : _send, child: _busy ? const _Spinner() : const Text('Get OTP')),
                ] else ...[
                  Text('Enter the code sent to $_sentTo', style: context.text.titleMedium),
                  const SizedBox(height: P2ASpace.sm),
                  TextField(
                    controller: _otp,
                    autofocus: true,
                    keyboardType: TextInputType.number,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 12),
                    onChanged: (v) => v.length == 6 ? _verify() : null,
                    decoration: const InputDecoration(hintText: '••••••'),
                  ),
                  if (_devCode != null)
                    Padding(
                      padding: const EdgeInsets.only(top: P2ASpace.sm),
                      child: Text('Development server — your code is $_devCode', textAlign: TextAlign.center, style: TextStyle(color: context.status.warning, fontWeight: FontWeight.w600)),
                    ),
                  const SizedBox(height: P2ASpace.lg),
                  FilledButton(onPressed: _busy ? null : _verify, child: _busy ? const _Spinner() : const Text('Verify & continue')),
                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    TextButton(onPressed: () => setState(() => _sentTo = null), child: const Text('Change number')),
                    TextButton(onPressed: _cooldown > 0 || _busy ? null : _send, child: Text(_cooldown > 0 ? 'Resend in ${_cooldown}s' : 'Resend OTP')),
                  ]),
                ],
                if (_error != null) ...[
                  const SizedBox(height: P2ASpace.md),
                  Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: context.status.danger, fontWeight: FontWeight.w600)),
                ],
                const SizedBox(height: P2ASpace.xl),
                Text('By continuing you agree to the Terms and Privacy Policy. Vehicle numbers are used only to manage your parking.', textAlign: TextAlign.center, style: context.text.bodySmall?.copyWith(color: context.colors.onSurfaceVariant)),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

class _Spinner extends StatelessWidget {
  const _Spinner();
  @override
  Widget build(BuildContext context) => const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5));
}

/// New users: name, then first vehicle. Returning users with both skip straight to Home.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});
  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  bool _busy = false;
  String? _error;

  Future<void> _saveProfile() async {
    if (_name.text.trim().length < 2) return setState(() => _error = 'Enter your name');
    setState(() => _busy = true);
    try {
      await ref.read(appStateProvider).saveProfile(_name.text.trim(), _email.text.trim());
    } catch (e) {
      setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = ref.watch(appStateProvider);
    final step = app.stage == Stage.needsProfile ? 0 : 1;
    return Scaffold(
      appBar: AppBar(title: Text('Step ${step + 1} of 2')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(P2ASpace.xl),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: step == 0
                  ? Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text('What should we call you?', style: context.text.headlineMedium),
                      const SizedBox(height: P2ASpace.xl),
                      TextField(controller: _name, autofocus: true, textCapitalization: TextCapitalization.words, autofillHints: const [AutofillHints.name], decoration: const InputDecoration(labelText: 'Full name')),
                      const SizedBox(height: P2ASpace.md),
                      TextField(controller: _email, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.email], decoration: const InputDecoration(labelText: 'Email for receipts (optional)')),
                      if (_error != null) Padding(padding: const EdgeInsets.only(top: P2ASpace.md), child: Text(_error!, style: TextStyle(color: context.status.danger))),
                      const SizedBox(height: P2ASpace.xl),
                      FilledButton(onPressed: _busy ? null : _saveProfile, child: const Text('Continue')),
                    ])
                  : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text('Add your vehicle', style: context.text.headlineMedium),
                      const SizedBox(height: 4),
                      Text('Gates recognise your number plate, so entry is faster.', style: TextStyle(color: context.colors.onSurfaceVariant)),
                      const SizedBox(height: P2ASpace.xl),
                      const VehicleForm(),
                    ]),
            ),
          ),
        ),
      ),
    );
  }
}

class VehicleForm extends ConsumerStatefulWidget {
  const VehicleForm({super.key, this.onSaved});
  final VoidCallback? onSaved;
  @override
  ConsumerState<VehicleForm> createState() => _VehicleFormState();
}

class _VehicleFormState extends ConsumerState<VehicleForm> {
  final _plate = TextEditingController();
  final _nick = TextEditingController();
  String _class = 'CAR';
  bool _busy = false;
  String? _error;

  Future<void> _save() async {
    final plate = _plate.text.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
    if (plate.length < 4) return setState(() => _error = 'Enter the registration number');
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(appStateProvider).addVehicle({'plate': plate, 'vehicleClass': _class, if (_nick.text.trim().isNotEmpty) 'nickname': _nick.text.trim()});
      widget.onSaved?.call();
    } catch (e) {
      setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        TextField(
          controller: _plate,
          textCapitalization: TextCapitalization.characters,
          style: const TextStyle(fontFamily: 'monospace', fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: 2),
          decoration: const InputDecoration(labelText: 'Registration number', hintText: 'KA 01 AB 1234'),
        ),
        const SizedBox(height: P2ASpace.md),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final e in vehicleClasses.entries) ChoiceChip(label: Text(e.value), selected: _class == e.key, onSelected: (_) => setState(() => _class = e.key)),
        ]),
        const SizedBox(height: P2ASpace.md),
        TextField(controller: _nick, decoration: const InputDecoration(labelText: 'Nickname (optional)', hintText: 'Family car')),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: P2ASpace.md), child: Text(_error!, style: TextStyle(color: context.status.danger))),
        const SizedBox(height: P2ASpace.xl),
        FilledButton(onPressed: _busy ? null : _save, child: _busy ? const _Spinner() : const Text('Save vehicle')),
      ]);
}
