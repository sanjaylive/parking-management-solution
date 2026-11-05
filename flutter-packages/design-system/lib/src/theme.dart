import 'package:flutter/material.dart';
import 'tokens.dart';

/// Extra semantic colours not covered by [ColorScheme].
@immutable
class P2AStatusColors extends ThemeExtension<P2AStatusColors> {
  const P2AStatusColors({required this.success, required this.warning, required this.danger});
  final Color success, warning, danger;

  @override
  P2AStatusColors copyWith({Color? success, Color? warning, Color? danger}) =>
      P2AStatusColors(success: success ?? this.success, warning: warning ?? this.warning, danger: danger ?? this.danger);

  @override
  P2AStatusColors lerp(P2AStatusColors? other, double t) => other == null
      ? this
      : P2AStatusColors(
          success: Color.lerp(success, other.success, t)!,
          warning: Color.lerp(warning, other.warning, t)!,
          danger: Color.lerp(danger, other.danger, t)!,
        );
}

extension P2AThemeX on BuildContext {
  P2AStatusColors get status => Theme.of(this).extension<P2AStatusColors>()!;
  ColorScheme get colors => Theme.of(this).colorScheme;
  TextTheme get text => Theme.of(this).textTheme;
}

abstract final class P2ATheme {
  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness b) {
    final dark = b == Brightness.dark;
    final scheme = ColorScheme.fromSeed(
      seedColor: P2AColors.electricBlue,
      brightness: b,
      primary: dark ? const Color(0xFF4D7CFF) : P2AColors.electricBlue,
      secondary: dark ? const Color(0xFF22D3EE) : P2AColors.cyan,
      tertiary: dark ? const Color(0xFFA78BFA) : P2AColors.violet,
      error: dark ? const Color(0xFFF87171) : P2AColors.danger,
      surface: dark ? const Color(0xFF0E1733) : Colors.white,
      onSurface: dark ? const Color(0xFFE8EDFF) : const Color(0xFF0B1530),
      surfaceContainerHighest: dark ? const Color(0xFF15204A) : const Color(0xFFEEF2F9),
      outlineVariant: dark ? const Color(0xFF22305E) : const Color(0xFFDDE3EE),
    );
    final base = ThemeData(useMaterial3: true, colorScheme: scheme, brightness: b);
    final text = base.textTheme.apply(bodyColor: scheme.onSurface, displayColor: scheme.onSurface).copyWith(
          headlineMedium: base.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.5),
          titleLarge: base.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
          titleMedium: base.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          labelLarge: base.textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
        );
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(P2ASpace.radiusSm));
    return base.copyWith(
      scaffoldBackgroundColor: dark ? const Color(0xFF070D22) : const Color(0xFFF4F6FB),
      textTheme: text,
      extensions: [
        P2AStatusColors(
          success: dark ? const Color(0xFF34D399) : P2AColors.success,
          warning: dark ? const Color(0xFFFBBF24) : P2AColors.warning,
          danger: scheme.error,
        ),
      ],
      appBarTheme: AppBarTheme(backgroundColor: Colors.transparent, surfaceTintColor: Colors.transparent, elevation: 0, titleTextStyle: text.titleLarge, centerTitle: false),
      cardTheme: CardThemeData(
        color: scheme.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(P2ASpace.radius), side: BorderSide(color: scheme.outlineVariant)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size(64, P2ASpace.touchTarget), shape: shape, textStyle: text.labelLarge?.copyWith(fontSize: 16)),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(64, P2ASpace.touchTarget), shape: shape, side: BorderSide(color: scheme.outlineVariant, width: 1.5), textStyle: text.labelLarge?.copyWith(fontSize: 16)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(P2ASpace.radiusSm), borderSide: BorderSide(color: scheme.outlineVariant)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(P2ASpace.radiusSm), borderSide: BorderSide(color: scheme.outlineVariant, width: 1.5)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(P2ASpace.radiusSm), borderSide: BorderSide(color: scheme.primary, width: 2)),
      ),
      chipTheme: base.chipTheme.copyWith(shape: StadiumBorder(side: BorderSide(color: scheme.outlineVariant))),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surface,
        indicatorColor: scheme.primary.withValues(alpha: .14),
        labelTextStyle: WidgetStatePropertyAll(text.labelMedium?.copyWith(fontWeight: FontWeight.w700)),
      ),
      snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, shape: shape),
    );
  }
}
