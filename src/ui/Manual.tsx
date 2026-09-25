import { MIRROR_ICON, SHARD, STONE_ICON, beaconSprite, ghostSprite, keeperSprite } from '../art/sprites';
import { Digits } from './Digits';
import { PixelArt } from './Pixel';

const STEPS = [
  {
    art: <PixelArt sprite={keeperSprite(0)} scale={4} />,
    title: 'You are a keeper',
    body: 'Walk with WASD or the arrow keys. On a phone, press and drag anywhere on the left half of the screen.',
  },
  {
    art: <span className="pair"><PixelArt sprite={MIRROR_ICON} scale={4} /><PixelArt sprite={STONE_ICON} scale={4} /></span>,
    title: 'Throw lamplight',
    body: 'Aim with the mouse and click, or press Space. On a phone, drag on the right half and let go. Beams bounce off brass mirrors and stop dead on stone.',
  },
  {
    art: <PixelArt sprite={ghostSprite(0)} scale={4} />,
    title: 'Mind your echo',
    body: 'Your echo walks your path three seconds behind you and throws every beam again from where you stood. Any other keeper who walks into your echo is caught, so lead chasers through your own trail. A dim echo is harmless.',
  },
  {
    art: <span className="pair"><PixelArt sprite={SHARD} scale={4} /><PixelArt sprite={beaconSprite(0, true)} scale={3} /></span>,
    title: 'Bring lenses home',
    body: 'The prism at the centre casts a new lens every few seconds. Walk over one to carry it, up to five, and stand on your own beacon to bank them. Carrying slows you down. The first keeper to bank ten lights their lighthouse and wins.',
  },
  {
    art: <PixelArt sprite={keeperSprite(1)} scale={4} flip />,
    title: 'Catch the others',
    body: 'A keeper hit by a beam is knocked flat, drops every lens they carry, and loses one lens from their beacon straight into your hands. Nothing is safe, so guard your beacon. If three minutes pass first, most lenses wins.',
  },
];

export function Manual({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={`manual ${compact ? 'compact' : ''}`}>
      {STEPS.map((s, i) => (
        <li key={s.title}>
          <span className="manual-num"><Digits value={String(i + 1).padStart(2, '0')} size={3} /></span>
          <span className="manual-art">{s.art}</span>
          <div>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Controls() {
  return (
    <table className="controls-table">
      <thead><tr><th scope="col">Action</th><th scope="col">Keyboard and mouse</th><th scope="col">Touch</th></tr></thead>
      <tbody>
        <tr><th scope="row">Walk</th><td>WASD or arrows</td><td>Drag, left half</td></tr>
        <tr><th scope="row">Aim</th><td>Mouse pointer</td><td>Drag, right half</td></tr>
        <tr><th scope="row">Throw a beam</th><td>Click, or Space</td><td>Let go of the drag; a tap aims at the nearest keeper</td></tr>
      </tbody>
    </table>
  );
}
