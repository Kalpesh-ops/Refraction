import { useMemo } from 'react';
import { encode } from 'uqr';

export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, data } = useMemo(() => encode(text), [text]);
  const viewSize = size + 4;

  const rects: Array<{ x: number; y: number; width: number }> = [];
  data.forEach((row, y) => {
    let runStart = -1;
    for (let x = 0; x <= row.length; x++) {
      if (x < row.length && row[x]) {
        if (runStart === -1) runStart = x;
      } else if (runStart !== -1) {
        rects.push({ x: runStart + 2, y: y + 2, width: x - runStart });
        runStart = -1;
      }
    }
  });

  return (
    <svg
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      className="qr-code"
    >
      <rect width={viewSize} height={viewSize} fill="var(--lamp-l)" />
      {rects.map((r) => (
        <rect
          key={`${r.y}-${r.x}`}
          x={r.x}
          y={r.y}
          width={r.width}
          height={1}
          fill="var(--ink)"
        />
      ))}
    </svg>
  );
}
