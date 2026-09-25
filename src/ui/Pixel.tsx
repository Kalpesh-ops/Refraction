import { useMemo } from 'react';
import { BRANDMARK, runs, spriteSize, type SpriteDef } from '../art/sprites';

/** Renders a sprite grid as crisp SVG, so the site and the game share the same art. */
export function PixelArt({ sprite, scale = 4, flip = false, className, label }: { sprite: SpriteDef; scale?: number; flip?: boolean; className?: string; label?: string }) {
  const { w, h } = spriteSize(sprite);
  const rects = useMemo(() => runs(sprite), [sprite]);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      width={w * scale}
      height={h * scale}
      shapeRendering="crispEdges"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      {rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.color} />)}
    </svg>
  );
}

export function Brand({ size = 3, href = '/' }: { size?: number; href?: string }) {
  return (
    <a className="brand" href={href} aria-label="Refraction, home">
      <PixelArt sprite={BRANDMARK} scale={size} />
      <span className="brand-word">Refraction</span>
    </a>
  );
}
