import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { Session } from '../net/session';
import { ArenaScene } from './ArenaScene';
import { H, W } from './constants';

export function GameBoard({ session }: { session: Session }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mount.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: mount.current,
      width: W,
      height: H,
      backgroundColor: '#050d12',
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      render: { antialias: true, powerPreference: 'high-performance' },
      input: { activePointers: 3 },
      fps: { target: 60 },
      banner: false,
      audio: { noAudio: true },
    });
    game.scene.add('arena', ArenaScene, true, { session });
    if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
    return () => game.destroy(true);
  }, [session]);
  return <div className="arena" ref={mount} aria-label="Refraction arena" />;
}
