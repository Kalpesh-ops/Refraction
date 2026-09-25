// Writes public/favicon.svg from the brandmark grid. Usage: npx tsx scripts/favicon.ts
import { writeFileSync } from 'node:fs';
import { BRANDMARK, svgMarkup } from '../src/art/sprites';
const svg = svgMarkup(BRANDMARK).replace('<svg ', '<svg style="background:#eadfc6" ');
writeFileSync(new URL('../public/favicon.svg', import.meta.url), svg);
console.log('wrote public/favicon.svg', svg.length, 'bytes');
