import { GameModel } from '../src/model.ts';
import { BASES } from '../src/data.ts';
export function fixtureModel() {
  const m = new GameModel('unit-fixture', { streaming: false });
  m.player = { x: 3200, y: 3330, vx: 0, vy: 0, health: 100, angle: -Math.PI / 2 };
  m.bases = BASES.map((base, i) => ({ ...base, unlocked: i === 0 }));
  m.asteroids = [{ id: 161, x: 3380, y: 3330, vx: 0, vy: 0, radius: 35, ore: 'iron', amount: 40, health: 40 }, { id: 162, x: 3000, y: 3350, vx: 0, vy: 0, radius: 30, ore: 'copper', amount: 30, health: 30 }];
  m.enemies = []; m.squads = []; m.explored.clear();
  m.update(0, { x: 0, y: 0, aim: { x: 3380, y: 3330 }, fire: false, mine: false, dock: false });
  return m;
}
