import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:p2a_design/p2a_design.dart';

void main() {
  test('rupees uses Indian grouping and paise', () {
    expect(rupees(16250), '₹162.50');
    expect(rupees(12345600), '₹1,23,456');
    expect(rupees(0), '₹0');
    expect(rupees(-5000), '−₹50');
    expect(rupees(null), '—');
  });

  test('plate formatting', () {
    expect(VehicleNumberPlate.format('MH12AB1234'), 'MH 12 AB 1234');
    expect(VehicleNumberPlate.format('22BH1234AB'), '22BH1234AB');
  });

  test('duration formatting', () {
    expect(formatDuration(45), '45m');
    expect(formatDuration(151), '2h 31m');
  });

  testWidgets('widgets render in light and dark themes', (t) async {
    for (final theme in [P2ATheme.light(), P2ATheme.dark()]) {
      await t.pumpWidget(MaterialApp(
        theme: theme,
        home: const Scaffold(body: Column(children: [VehicleNumberPlate('KA01AB1234'), StatusChip('active', tone: StatusTone.brand), OccupancyRing(occupied: 30, total: 40)])),
      ));
      await t.pumpAndSettle();
      expect(find.text('KA 01 AB 1234'), findsOneWidget);
      expect(find.text('75%'), findsOneWidget);
    }
  });
}
