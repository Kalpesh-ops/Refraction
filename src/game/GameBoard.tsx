import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { GameSession } from '../net/types';
import { ArenaScene } from './ArenaScene';
import { H, W } from './constants';

export function GameBoard({ session, label = 'Refraction arena' }: { session: GameSession; label?: string }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mount.current) return;
    let game: Phaser.Game | null = null;
    let cancelled = false;
    // Phaser rasterises text once, so the pixel font has to be ready first.
    const fonts = document.fonts?.load('16px "Pixelify Sans"').catch(() => undefined) ?? Promise.resolve();
    const timeout = new Promise((r) => setTimeout(r, 1500));
    void Promise.race([fonts, timeout]).then(() => {
      if (cancelled || !mount.current) return;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: mount.current,
        width: W,
        height: H,
        backgroundColor: '#1b2627',
        pixelArt: true,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        input: { activePointers: 3, keyboard: session.kind !== 'demo', mouse: session.kind !== 'demo', touch: session.kind !== 'demo' },
        fps: { target: 60 },
        banner: false,
        audio: { noAudio: true },
      });
      game.scene.add('arena', ArenaScene, true, { session });
      if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
    });
    return () => { cancelled = true; game?.destroy(true); };
  }, [session]);
  return <div className="arena" ref={mount} role="img" aria-label={label} />;
}
