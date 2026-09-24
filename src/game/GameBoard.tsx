import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { ARENA, shrineFor } from './engine';
import type { MatchSnapshot, Player } from '../types';

class MazeScene extends Phaser.Scene {
  private frame?: Phaser.GameObjects.Container;
  private snapshot?: MatchSnapshot;
  private players: Record<string, Player> = {};
  private uid = '';
  constructor() { super('maze'); }
  setState(snapshot: MatchSnapshot, players: Record<string, Player>, uid: string) { this.snapshot = snapshot; this.players = players; this.uid = uid; this.draw(); }
  create() { this.draw(); }
  private draw() {
    if (!this.snapshot) return;
    this.frame?.destroy(true);
    const g = this.add.graphics(); const nodes: Phaser.GameObjects.GameObject[] = [g];
    g.fillStyle(0x0b1821, 1).fillRect(0, 0, ARENA.width, ARENA.height);
    g.lineStyle(3, 0x214656, .9).strokeRect(25, 25, ARENA.width - 50, ARENA.height - 50);
    [[190, 150, 170, 18], [600, 150, 170, 18], [190, 452, 170, 18], [600, 452, 170, 18], [382, 255, 196, 18], [382, 350, 196, 18]].forEach(([x,y,w,h]) => { g.fillStyle(0x1b3440).fillRoundedRect(x,y,w,h,9); g.lineStyle(1,0x4a7886,.65).strokeRoundedRect(x,y,w,h,9); });
    const plate = this.snapshot.runners[this.uid]?.trail.find(p => p.at >= Date.now() - ARENA.delayMs);
    const held = plate && (Math.hypot(plate.x - 480, plate.y - 310) < 95 || Math.hypot(plate.x - 480, plate.y - 210) < 45);
    [[480,310,90],[480,210,42]].forEach(([x,y,r]) => { g.lineStyle(2, held ? 0x77ffee : 0x3c7181, held ? .9 : .5).strokeCircle(x,y,r); });
    Object.values(this.snapshot.relics).filter(r => r.active).forEach(relic => { const c = this.add.circle(relic.x,relic.y,11,0xd7f4ea,1); c.setStrokeStyle(3,0x4ed9c5,.9); nodes.push(c); });
    Object.values(this.snapshot.runners).forEach(runner => {
      const player = this.players[runner.id]; const echo = runner.trail.find(point => point.at >= Date.now() - ARENA.delayMs);
      if (echo) { const ghost = this.add.circle(echo.x, echo.y, 18, Phaser.Display.Color.HexStringToColor(player?.color ?? '#88ffff').color, .16); ghost.setStrokeStyle(2, Phaser.Display.Color.HexStringToColor(player?.color ?? '#88ffff').color, .55); nodes.push(ghost); }
      const body = this.add.circle(runner.x, runner.y, 19, Phaser.Display.Color.HexStringToColor(player?.color ?? '#ffffff').color, 1); body.setStrokeStyle(runner.id === this.uid ? 4 : 2, 0xe7fffa, runner.id === this.uid ? 1 : .55); nodes.push(body);
      if (runner.carrying) { const sigil = this.add.circle(runner.x, runner.y - 31, 7, 0xd7f4ea, 1); sigil.setStrokeStyle(2,0x4ed9c5,1); nodes.push(sigil); }
      const label = this.add.text(runner.x, runner.y + 27, player?.name ?? 'Runner', { fontFamily: 'system-ui', fontSize: '14px', color: '#e5fbf5' }).setOrigin(.5,0); nodes.push(label);
      const [sx,sy] = shrineFor(runner.id); g.lineStyle(2, Phaser.Display.Color.HexStringToColor(player?.color ?? '#ffffff').color,.45).strokeCircle(sx,sy,34);
    });
    this.frame = this.add.container(0,0,nodes);
  }
}

export function GameBoard({ snapshot, players, uid }: { snapshot?: MatchSnapshot; players: Record<string, Player>; uid: string }) {
  const mount = useRef<HTMLDivElement>(null); const scene = useRef<MazeScene | null>(null);
  useEffect(() => { if (!mount.current) return; const active = new MazeScene(); scene.current = active; const game = new Phaser.Game({ type: Phaser.AUTO, parent: mount.current, width: ARENA.width, height: ARENA.height, transparent: true, scene: active, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } }); return () => game.destroy(true); }, []);
  useEffect(() => { if (snapshot) scene.current?.setState(snapshot, players, uid); }, [snapshot, players, uid]);
  return <div className="maze" ref={mount} aria-label="Live Refraction mirror maze" />;
}
