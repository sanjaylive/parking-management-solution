import 'package:customer_app/app/data.dart';
import 'package:customer_app/app/state.dart';
import 'package:customer_app/features/facility.dart' show describeRate;
import 'package:customer_app/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:p2a_core/p2a_core.dart';

void main() {
  testWidgets('signed-out user sees phone login (no separate signup)', (t) async {
    await t.pumpWidget(ProviderScope(overrides: [kvProvider.overrideWithValue(MemoryKeyValueStore())], child: const CustomerApp()));
    await t.pumpAndSettle();
    expect(find.text('Park smarter.'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Get OTP'), findsOneWidget);
    expect(find.textContaining('Sign up'), findsNothing);
  });

  testWidgets('invalid phone number is rejected before calling the API', (t) async {
    await t.pumpWidget(ProviderScope(overrides: [kvProvider.overrideWithValue(MemoryKeyValueStore())], child: const CustomerApp()));
    await t.pumpAndSettle();
    await t.enterText(find.byType(TextField), '12345');
    await t.tap(find.text('Get OTP'));
    await t.pump();
    expect(find.text('Enter your 10-digit mobile number'), findsOneWidget);
  });

  test('rate descriptions are human readable', () {
    expect(describeRate({'base': {'unitMinutes': 60, 'amount': 40, 'firstUnitAmount': 50}, 'dailyCap': 400, 'graceMinutes': 10}), '₹50 first hr, then ₹40/hr · max ₹400/day · first 10 min free');
    expect(describeRate(null), 'Rates on request');
    expect(
      describeRate({'base': {'unitMinutes': 60, 'amount': 40}, 'windows': [{'name': 'Evening peak', 'from': '17:00', 'to': '21:00', 'multiplier': 1.25}], 'overnight': {'from': '23:00', 'to': '06:00', 'flat': 100}}),
      '₹40/hr · Evening peak 17:00–21:00 ×1.25 · overnight 23:00–06:00 flat ₹100',
    );
  });

  test('search filters build the API query and compare by value', () {
    const a = SearchFilters(ev: true, sort: 'price');
    expect(a.toQuery(), {'ev': 'true', 'sort': 'price', 'radiusKm': '10.0'});
    expect(a, const SearchFilters(ev: true, sort: 'price'));
    expect(a.copyWith(vehicleClass: 'CAR').copyWith(clearVehicle: true).toQuery().containsKey('vehicleClass'), isFalse);
  });
}
