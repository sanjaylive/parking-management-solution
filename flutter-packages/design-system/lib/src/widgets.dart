import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'theme.dart';
import 'tokens.dart';

/// Indian-style number plate. Formats normalized plates as "MH 12 AB 1234".
class VehicleNumberPlate extends StatelessWidget {
  const VehicleNumberPlate(this.plate, {super.key, this.large = false});
  final String plate;
  final bool large;

  static String format(String p) {
    final m = RegExp(r'^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$').firstMatch(p);
    if (m == null) return p;
    return [m[1], m[2], m[3], m[4]].where((s) => s != null && s.isNotEmpty).join(' ');
  }

  @override
  Widget build(BuildContext context) {
    final fs = large ? 26.0 : 15.0;
    return Semantics(
      label: 'Vehicle number $plate',
      child: Container(
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(6), border: Border.all(color: const Color(0xFF0B1530), width: 2)),
        child: IntrinsicHeight(
          child: Row(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Container(
              color: const Color(0xFF1D4ED8),
              padding: EdgeInsets.symmetric(horizontal: large ? 6 : 4),
              alignment: Alignment.center,
              child: Text('IND', style: TextStyle(color: Colors.white, fontSize: large ? 11 : 8, fontWeight: FontWeight.w900)),
            ),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: large ? 12 : 8, vertical: large ? 6 : 3),
              child: Text(format(plate), style: TextStyle(fontFamily: 'monospace', fontSize: fs, fontWeight: FontWeight.w800, letterSpacing: 1.5, color: const Color(0xFF0B1530))),
            ),
          ]),
        ),
      ),
    );
  }
}

enum StatusTone { neutral, brand, success, warning, danger }

class StatusChip extends StatelessWidget {
  const StatusChip(this.label, {super.key, this.tone = StatusTone.neutral, this.icon});
  final String label;
  final StatusTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final c = switch (tone) {
      StatusTone.brand => context.colors.primary,
      StatusTone.success => context.status.success,
      StatusTone.warning => context.status.warning,
      StatusTone.danger => context.status.danger,
      StatusTone.neutral => context.colors.onSurfaceVariant,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: c.withValues(alpha: .13), borderRadius: BorderRadius.circular(99)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 14, color: c), const SizedBox(width: 4)],
        Text(label, style: TextStyle(color: c, fontWeight: FontWeight.w700, fontSize: 12)),
      ]),
    );
  }
}

/// Gradient hero banner used at the top of primary screens.
class GradientHeader extends StatelessWidget {
  const GradientHeader({super.key, required this.child, this.padding = const EdgeInsets.all(P2ASpace.xl)});
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Stack(children: [
          Positioned.fill(child: Container(color: P2AColors.navy)),
          Positioned(right: -60, top: -80, child: _blob(P2AColors.brandGradient, 220)),
          Positioned(left: -40, bottom: -100, child: _blob(P2AColors.cyanGradient, 200)),
          Padding(padding: padding, child: DefaultTextStyle.merge(style: const TextStyle(color: Colors.white), child: IconTheme.merge(data: const IconThemeData(color: Colors.white), child: child))),
        ]),
      );

  Widget _blob(Gradient g, double s) => Opacity(opacity: .45, child: Container(width: s, height: s, decoration: BoxDecoration(shape: BoxShape.circle, gradient: g)));
}

class OccupancyRing extends StatelessWidget {
  const OccupancyRing({super.key, required this.occupied, required this.total, this.size = 120, this.label});
  final int occupied, total;
  final double size;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final pct = total == 0 ? 0.0 : (occupied / total).clamp(0.0, 1.0);
    return Semantics(
      label: '$occupied of $total occupied',
      child: SizedBox.square(
        dimension: size,
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0, end: pct),
          duration: const Duration(milliseconds: 800),
          curve: Curves.easeOutCubic,
          builder: (context, v, _) => CustomPaint(
            painter: _RingPainter(v, context.colors.surfaceContainerHighest, pct > .9 ? context.status.danger : pct > .75 ? context.status.warning : null),
            child: Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Text('${(v * 100).round()}%', style: TextStyle(fontSize: size / 5, fontWeight: FontWeight.w800)),
                Text(label ?? '$occupied/$total', style: TextStyle(fontSize: size / 11, color: context.colors.onSurfaceVariant)),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.pct, this.track, this.solid);
  final double pct;
  final Color track;
  final Color? solid;

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = size.width / 11;
    final rect = Offset.zero & size;
    final r = rect.deflate(stroke / 2);
    canvas.drawArc(r, 0, math.pi * 2, false, Paint()..color = track..style = PaintingStyle.stroke..strokeWidth = stroke);
    if (pct <= 0) return;
    final p = Paint()..style = PaintingStyle.stroke..strokeWidth = stroke..strokeCap = StrokeCap.round;
    if (solid != null) {
      p.color = solid!;
    } else {
      p.shader = const SweepGradient(colors: [P2AColors.cyan, P2AColors.electricBlue, P2AColors.cyan]).createShader(rect);
    }
    canvas.drawArc(r, -math.pi / 2, math.pi * 2 * pct, false, p);
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.pct != pct || old.solid != solid;
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.body, this.action});
  final IconData icon;
  final String title;
  final String? body;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(P2ASpace.xxl),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(color: context.colors.surfaceContainerHighest, borderRadius: BorderRadius.circular(18)),
            child: Icon(icon, color: context.colors.onSurfaceVariant, size: 28),
          ),
          const SizedBox(height: P2ASpace.lg),
          Text(title, style: context.text.titleMedium, textAlign: TextAlign.center),
          if (body != null) ...[const SizedBox(height: P2ASpace.xs), Text(body!, textAlign: TextAlign.center, style: TextStyle(color: context.colors.onSurfaceVariant))],
          if (action != null) ...[const SizedBox(height: P2ASpace.lg), action!],
        ]),
      );
}

String rupees(int? minor) {
  if (minor == null) return '—';
  final neg = minor < 0;
  final abs = minor.abs();
  final r = abs ~/ 100, p = abs % 100;
  // Indian digit grouping: 12,34,567
  final s = r.toString();
  String grouped;
  if (s.length <= 3) {
    grouped = s;
  } else {
    final last3 = s.substring(s.length - 3);
    var rest = s.substring(0, s.length - 3);
    final parts = <String>[];
    while (rest.length > 2) {
      parts.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) parts.insert(0, rest);
    grouped = '${parts.join(',')},$last3';
  }
  return '${neg ? '−' : ''}₹$grouped${p == 0 ? '' : '.${p.toString().padLeft(2, '0')}'}';
}

String formatDuration(int minutes) => minutes < 60 ? '${minutes}m' : '${minutes ~/ 60}h ${(minutes % 60).toString().padLeft(2, '0')}m';
