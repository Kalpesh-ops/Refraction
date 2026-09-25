// The Lens Works palette. Every pixel in the game and the site comes from this list.
export const P = {
  ink: '#1b2627',
  ink2: '#263536',
  slate: '#34494a',
  slate2: '#435c5b',
  moss: '#56705c',
  stone: '#7d7a66',
  stoneL: '#a39d82',
  parchment: '#eadfc6',
  paper2: '#dccfb0',
  paperLine: '#b9a983',
  brass: '#c08a3e',
  brassD: '#8a5d2a',
  brassL: '#e0b867',
  lamp: '#f3cf6b',
  lampL: '#fbecc0',
  rust: '#b04a33',
  glass: '#8fbcb5',
  glassL: '#cfe5dd',
  skin: '#d9a77c',
} as const;

export interface Keeper { name: string; cloak: string; shade: string; ghost: string }

/** One cloak colour per slot. Muted dyes, readable on slate and on parchment. */
export const KEEPERS: Keeper[] = [
  { name: 'Amber', cloak: '#d99a2b', shade: '#9c6a17', ghost: '#ecd29a' },
  { name: 'Rust', cloak: '#b8472e', shade: '#7f2e1d', ghost: '#e2b3a0' },
  { name: 'Verdigris', cloak: '#3f8f86', shade: '#2a615b', ghost: '#aed2c8' },
  { name: 'Fern', cloak: '#6f9442', shade: '#4b672b', ghost: '#c5d4a3' },
  { name: 'Cobalt', cloak: '#4467a6', shade: '#2d4675', ghost: '#b0bfd8' },
  { name: 'Madder', cloak: '#b35d6e', shade: '#7d3d4a', ghost: '#e3bcc0' },
];

export const keeperOf = (slot: number) => KEEPERS[((slot % KEEPERS.length) + KEEPERS.length) % KEEPERS.length];
export const hexNum = (hex: string) => parseInt(hex.slice(1), 16);
