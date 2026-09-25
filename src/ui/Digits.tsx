// Hand-drawn 5 x 7 numerals. The UI font's 8 and 9 blur together at small sizes; these don't.
const GLYPHS: Record<string, string[]> = {
  '0': ['.xxx.', 'x...x', 'x..xx', 'x.x.x', 'xx..x', 'x...x', '.xxx.'],
  '1': ['..x..', '.xx..', '..x..', '..x..', '..x..', '..x..', '.xxx.'],
  '2': ['.xxx.', 'x...x', '....x', '...x.', '..x..', '.x...', 'xxxxx'],
  '3': ['xxxx.', '....x', '....x', '.xxx.', '....x', '....x', 'xxxx.'],
  '4': ['...x.', '..xx.', '.x.x.', 'x..x.', 'xxxxx', '...x.', '...x.'],
  '5': ['xxxxx', 'x....', 'xxxx.', '....x', '....x', 'x...x', '.xxx.'],
  '6': ['..xx.', '.x...', 'x....', 'xxxx.', 'x...x', 'x...x', '.xxx.'],
  '7': ['xxxxx', '....x', '...x.', '..x..', '.x...', '.x...', '.x...'],
  '8': ['.xxx.', 'x...x', 'x...x', '.xxx.', 'x...x', 'x...x', '.xxx.'],
  '9': ['.xxx.', 'x...x', 'x...x', '.xxxx', '....x', '...x.', '.xx..'],
  ':': ['.', '.', 'x', '.', 'x', '.', '.'],
  '+': ['.....', '.....', '..x..', '.xxx.', '..x..', '.....', '.....'],
  '-': ['.....', '.....', '.....', '.xxx.', '.....', '.....', '.....'],
  '/': ['....x', '...x.', '...x.', '..x..', '.x...', '.x...', 'x....'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
};

/** Renders numbers (and : + - /) in the Lens Works numerals. Colour follows `currentColor`. */
export function Digits({ value, size = 3, className, label }: { value: string | number; size?: number; className?: string; label?: string }) {
  const text = String(value);
  const rects: Array<{ x: number; y: number; w: number }> = [];
  let x = 0;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    g.forEach((row, y) => {
      let i = 0;
      while (i < row.length) {
        if (row[i] !== 'x') { i++; continue; }
        let end = i;
        while (end < row.length && row[end] === 'x') end++;
        rects.push({ x: x + i, y, w: end - i });
        i = end;
      }
    });
    x += g[0].length + 1;
  }
  const width = Math.max(1, x - 1);
  return (
    <svg className={`digits ${className ?? ''}`} viewBox={`0 0 ${width} 7`} width={width * size} height={7 * size} shapeRendering="crispEdges" role="img" aria-label={label ?? text}>
      {rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill="currentColor" />)}
    </svg>
  );
}
