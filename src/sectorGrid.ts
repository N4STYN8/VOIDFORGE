import { SECTOR, WORLD } from './data.ts';

/**
 * Pure sector-grid maths (no model, Phaser or DOM). Every world is one sector on an endless grid.
 * The home sector (0,0) uses the pilot's own seed; any other cell is generated from a seed derived
 * from the home seed and its grid position, so the same neighbour always comes back. A later stage
 * lets the relay server put another player's sector in a cell instead.
 */
export type SectorDirection = 'north' | 'south' | 'east' | 'west';
export const SECTOR_STEPS: Record<SectorDirection, { dx: number; dy: number }> = { north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 }, east: { dx: 1, dy: 0 }, west: { dx: -1, dy: 0 } };
export const sectorKey = (x: number, y: number) => `${x},${y}`;
export const sectorSeed = (home: string, x: number, y: number) => x === 0 && y === 0 ? home : `${home}:sector:${x},${y}`;
export const sectorLabel = (x: number, y: number) => x === 0 && y === 0 ? 'Home sector' : `Sector ${x >= 0 ? 'E' : 'W'}${Math.abs(x)} ${y <= 0 ? 'N' : 'S'}${Math.abs(y)}`;

/** The edge the ship is pressed against and thrusting through, if any. */
export function edgeDirection(p: { x: number; y: number }, thrust: { x: number; y: number }): SectorDirection | undefined {
  const near = SECTOR.bound + SECTOR.edge;
  if (p.x >= WORLD.width - near && thrust.x > 0) return 'east';
  if (p.x <= near && thrust.x < 0) return 'west';
  if (p.y >= WORLD.height - near && thrust.y > 0) return 'south';
  if (p.y <= near && thrust.y < 0) return 'north';
}

/** Where a ship that left through `direction` at `p` appears in the next sector: the opposite edge, inset. */
export function entryPoint(direction: SectorDirection, p: { x: number; y: number }) {
  const inset = SECTOR.entryInset, x = Math.min(WORLD.width - inset, Math.max(inset, p.x)), y = Math.min(WORLD.height - inset, Math.max(inset, p.y));
  if (direction === 'east') return { x: inset, y };
  if (direction === 'west') return { x: WORLD.width - inset, y };
  if (direction === 'south') return { x, y: inset };
  return { x, y: WORLD.height - inset };
}
