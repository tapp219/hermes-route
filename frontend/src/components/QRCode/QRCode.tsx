import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

const QUIET_ZONE = 4;

/** Always dark-on-light, whatever the theme, so phone cameras can read it. */
export default function QRCode({ value, label }: { value: string; label: string }) {
  const { path, size } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) d += `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return { path: d, size: count + QUIET_ZONE * 2 };
  }, [value]);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
