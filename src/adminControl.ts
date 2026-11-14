import { ENEMIES, OUTPOST, WORLD, type EnemyKind, type Resource } from './data.ts';
import type { GameModel } from './model.ts';
import { maxHealth } from './outposts.ts';
import { enterWorld, goHome, moveToSector } from './sectors.ts';
import { ADMIN, type AdminCommand } from './adminProtocol.ts';

/**
 * Carries out a relay admin's command on this pilot's own game (no DOM or sockets; src/main.ts wires it to
 * the network and answers with `admin-ack`). The relay never simulates, so teleports, enemy spawns, evictions
 * and base edits all happen here. Admin mineral edits are the one deliberate exception to "minerals are only
 * moved, never created or deleted"; each is announced to the pilot with an [Admin] note.
 */
export type AdminOutcome = { ok: boolean; model?: GameModel; message?: string; data?: unknown; rename?: string };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const note = (model: GameModel, text: string) => { model.message = `[Admin] ${text}`; };
type Spawner = { spawnEnemy(kind: EnemyKind, x: number, y: number, angle: number): unknown };

function inspect(model: GameModel) {
  const data = {
    ship: model.shipName, coreLevel: model.coreLevel, hull: Math.round(model.player.health), dead: model.dead || undefined,
    sector: model.sectorName, seed: model.seed, galaxy: { home: model.galaxy.home, x: model.galaxy.x, y: model.galaxy.y, away: model.galaxy.away?.seed },
    at: { x: Math.round(model.player.x), y: Math.round(model.player.y) }, kills: model.kills, deaths: model.deaths,
    cargo: { ...model.cargo }, stored: { ...model.stored },
    bases: model.bases.map((b, index) => ({ index, name: b.name, x: Math.round(b.x), y: Math.round(b.y), unlocked: b.unlocked })),
    modules: model.modules.length,
    outposts: model.outposts.map(o => ({ id: o.id, name: o.name, cx: o.cx, cy: o.cy, stored: o.stored && { ...o.stored },
      blocks: o.structures.map(s => [s.id, s.kind, s.level, Math.round(s.health), maxHealth(s)] as [number, string, number, number, number]) })),
    truncated: undefined as boolean | undefined,
  };
  // Stay under the relay's ack size limit: big bases are cut down block lists first.
  for (let keep = 80; JSON.stringify(data).length > ADMIN.maxAck - 500 && keep >= 0; keep = keep ? Math.floor(keep / 2) : -1) {
    for (const o of data.outposts) o.blocks = o.blocks.slice(0, keep);
    data.truncated = true;
  }
  while (JSON.stringify(data).length > ADMIN.maxAck - 500 && data.outposts.length) { data.outposts.length = Math.floor(data.outposts.length * 0.7); data.truncated = true; }
  return data;
}

export function applyAdminCommand(model: GameModel, c: AdminCommand, ctx: { authority: boolean }): AdminOutcome {
  switch (c.op) {
    case 'notice': note(model, c.text); return { ok: true };
    case 'rename': note(model, `Your pilot name is now ${c.name}.`); return { ok: true, rename: c.name };
    case 'teleport': {
      const at = { x: clamp(c.x, 60, WORLD.width - 60), y: clamp(c.y, 60, WORLD.height - 60) };
      if (c.cell) { const next = moveToSector(model, c.cell[0], c.cell[1], at); note(next, `You were moved to ${next.sectorName}.`); return { ok: true, model: next }; }
      if (c.world && c.world.seed !== model.seed) { const next = enterWorld(model, c.world, at); note(next, `You were sent to ${next.sectorName}.`); return { ok: true, model: next }; }
      Object.assign(model.player, at, { vx: 0, vy: 0 });
      note(model, 'You were moved.');
      return { ok: true };
    }
    case 'evict': {
      const next = goHome(model);
      if (!next) { note(model, c.reason); return { ok: true, message: 'Already home.' }; }
      note(next, c.reason);
      return { ok: true, model: next };
    }
    case 'spawn': {
      if (!ctx.authority) return { ok: false, message: 'This pilot does not run the sector enemies.' };
      const def = ENEMIES[c.kind as EnemyKind];
      if (!def || def.boss || def.part) return { ok: false, message: 'That enemy cannot be spawned on its own.' };
      for (let i = 0; i < c.count; i++) {
        const angle = i / c.count * Math.PI * 2, r = c.count > 1 ? 70 : 0;
        (model as unknown as Spawner).spawnEnemy(c.kind as EnemyKind, clamp(c.x + Math.cos(angle) * r, 60, WORLD.width - 60), clamp(c.y + Math.sin(angle) * r, 60, WORLD.height - 60), angle);
      }
      return { ok: true, message: `Spawned ${c.count} ${def.label ?? c.kind}.` };
    }
    case 'clear': {
      if (!ctx.authority) return { ok: false, message: 'This pilot does not run the sector enemies.' };
      // Bosses and their parts stay: their defeat ledger and cooldown belong to the population system.
      const bosses = new Set(model.enemies.filter(e => ENEMIES[e.kind ?? 'raider']?.boss).map(e => e.id));
      const before = model.enemies.length;
      model.enemies = model.enemies.filter(e => bosses.has(e.id) || (e.parent !== undefined && bosses.has(e.parent)));
      return { ok: true, message: `Cleared ${before - model.enemies.length} enemies${bosses.size ? '; bosses were left' : ''}.` };
    }
    case 'inspect': return { ok: true, data: inspect(model) };
    case 'cargo': {
      const store = c.target === 'cargo' ? model.cargo : c.target === 'stored' ? model.stored : model.outposts.find(o => o.id === (c.target as { outpost: number }).outpost)?.stored;
      if (!store) return { ok: false, message: 'No such outpost storage.' };
      for (const [ore, n] of Object.entries(c.delta) as [Resource, number][]) store[ore] = Math.max(0, (store[ore] ?? 0) + n);
      note(model, `An admin adjusted your ${c.target === 'cargo' ? 'cargo' : c.target === 'stored' ? 'station storage' : 'outpost storage'}.`);
      return { ok: true, data: inspect(model) };
    }
    case 'station': {
      const base = model.bases[c.index];
      if (!base) return { ok: false, message: 'No such station.' };
      if (c.index === 0 && !c.unlocked) return { ok: false, message: 'The home station always stays active.' };
      base.unlocked = c.unlocked;
      note(model, `${base.name} was ${c.unlocked ? 'unlocked' : 'locked'} by an admin.`);
      return { ok: true, data: inspect(model) };
    }
    case 'structure': {
      const outpost = model.outposts.find(o => o.id === c.outpost);
      if (!outpost) return { ok: false, message: 'No such outpost.' };
      if (c.structure === undefined) {
        if (c.action !== 'destroy') { for (const s of outpost.structures) { if (c.action === 'repair') { s.health = maxHealth(s); s.progress = 1; } else s.level = Math.min(OUTPOST.maxLevel, s.level + 1); } }
        else {
          // Minerals are never deleted: the outpost's stock and its drones' loads move to station storage.
          for (const [ore, n] of Object.entries(outpost.stored ?? {}) as [Resource, number][]) model.stored[ore] += n;
          for (const d of outpost.drones ?? []) if (d.ore && d.load > 0) model.stored[d.ore] += d.load;
          model.outposts = model.outposts.filter(o => o !== outpost);
        }
      } else {
        const s = outpost.structures.find(b => b.id === c.structure);
        if (!s) return { ok: false, message: 'No such block.' };
        if (c.action === 'repair') { s.health = maxHealth(s); s.progress = 1; }
        else if (c.action === 'upgrade') { s.level = Math.min(OUTPOST.maxLevel, s.level + 1); s.health = maxHealth(s); }
        else outpost.structures = outpost.structures.filter(b => b !== s);
      }
      outpost.revision++;
      note(model, `An admin changed ${outpost.name}.`);
      return { ok: true, data: inspect(model) };
    }
  }
}
