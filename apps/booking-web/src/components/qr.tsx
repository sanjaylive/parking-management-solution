'use client';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export function QR({ value, size = 220 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toString(value, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: size }).then(setSvg).catch(() => setSvg(null));
  }, [value, size]);
  return svg ? <div role="img" aria-label="Entry QR code" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="skeleton" style={{ width: size, height: size }} />;
}
