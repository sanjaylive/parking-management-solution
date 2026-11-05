import 'package:flutter/material.dart';

/// Brand tokens — mirror apps/operator-web/src/app/globals.css.
abstract final class P2AColors {
  static const navy = Color(0xFF0A1433);
  static const electricBlue = Color(0xFF2257FF);
  static const cyan = Color(0xFF00B8D9);
  static const indigo = Color(0xFF4F46E5);
  static const violet = Color(0xFF7C5CFF);
  static const success = Color(0xFF12A150);
  static const warning = Color(0xFFD97706);
  static const danger = Color(0xFFDC2626);

  static const brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [electricBlue, indigo, violet],
    stops: [0, .55, 1],
  );
  static const cyanGradient = LinearGradient(colors: [cyan, electricBlue]);
}

abstract final class P2ASpace {
  static const xs = 4.0, sm = 8.0, md = 12.0, lg = 16.0, xl = 24.0, xxl = 32.0;
  static const radius = 18.0;
  static const radiusSm = 12.0;
  /// Minimum touch target for gate staff (gloves, rain, hurry).
  static const touchTarget = 56.0;
}
