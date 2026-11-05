import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:p2a_core/p2a_core.dart';
import 'package:staff_app/app/state.dart';
import 'package:staff_app/features/gate.dart';
import 'package:staff_app/main.dart';

void main() {
  group('credentialFrom', () {
    test('signed QR tokens', () => expect(credentialFrom(' P2A1.abc.def '), {'type': 'QR', 'token': 'P2A1.abc.def'}));
    test('ticket numbers', () => expect(credentialFrom('skymall-261105-55978178'), {'type': 'TICKET', 'number': 'SKYMALL-261105-55978178'}));
    test('plates are normalized', () => expect(credentialFrom('ka 01-ab 1234'), {'type': 'PLATE_MANUAL', 'plate': 'KA01AB1234'}));
  });

  testWidgets('signed-out user lands on login', (t) async {
    await t.pumpWidget(ProviderScope(overrides: [kvProvider.overrideWithValue(MemoryKeyValueStore())], child: const StaffApp()));
    await t.pumpAndSettle();
    expect(find.text('Park2All Staff'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Sign in'), findsOneWidget);
    await t.pumpWidget(const SizedBox()); // dispose providers -> cancels sync timer
  });

  test('gate config permissions', () {
    final c = GateConfig({'id': 'f', 'name': 'F', 'gates': [], 'permissions': ['session.entry'], 'offlineMaxProvisionalEntries': 5});
    expect(c.can('session.entry'), isTrue);
    expect(c.can('payment.collect_cash'), isFalse);
    expect(c.offlineMaxProvisionalEntries, 5);
  });
}
