import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Full-screen QR scanner. Returns the first decoded value.
class ScannerScreen extends StatefulWidget {
  const ScannerScreen({super.key});
  @override
  State<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<ScannerScreen> {
  final _ctl = MobileScannerController(formats: const [BarcodeFormat.qrCode], detectionSpeed: DetectionSpeed.noDuplicates);
  bool _done = false;

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          foregroundColor: Colors.white,
          title: const Text('Scan ticket or pass', style: TextStyle(color: Colors.white)),
          actions: [IconButton(tooltip: 'Torch', onPressed: _ctl.toggleTorch, icon: const Icon(Icons.flashlight_on, color: Colors.white))],
        ),
        body: Stack(children: [
          MobileScanner(
            controller: _ctl,
            onDetect: (capture) {
              final v = capture.barcodes.firstOrNull?.rawValue;
              if (v == null || _done) return;
              _done = true;
              Navigator.of(context).pop(v);
            },
            errorBuilder: (context, error) => Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text('Camera unavailable (${error.errorCode.name}). Type the vehicle or ticket number instead.', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
              ),
            ),
          ),
          Center(
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 3), borderRadius: BorderRadius.circular(24)),
            ),
          ),
        ]),
      );
}
