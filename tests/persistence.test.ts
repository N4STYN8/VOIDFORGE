import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureModel } from './fixtures.ts';
import { GameModel } from '../src/model.ts';
import { saveGame, saveGameConfirmed, loadSavedGame, backupSavedGame, saveText, SAVE_KEY, SAVE_FAILED, type SaveRecord, type SaveStores } from '../src/persistence.ts';

/** A localStorage stand-in with a total character quota, like the browser's. */
function smallStore(quota = Infinity) {
  const data = new Map<string, string>();
  const used = (skip?: string) => [...data].reduce((sum, [key, value]) => key === skip ? sum : sum + key.length + value.length, 0);
  return { data, get: (key: string) => data.get(key) ?? null, remove: (key: string) => { data.delete(key); },
    set: (key: string, value: string) => { if (used(key) + key.length + value.length > quota) throw new Error('QuotaExceededError'); data.set(key, value); } };
}
function largeStore(broken = false) {
  const data = new Map<string, SaveRecord>();
  return { data, get: async (key: string) => { if (broken) throw new Error('unavailable'); return data.get(key); }, put: async (key: string, record: SaveRecord) => { if (broken) throw new Error('unavailable'); data.set(key, record); } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

test('a save goes to both stores and loads back', async () => {
  const stores = { small: smallStore(), large: largeStore() }, m = fixtureModel(); m.stored.iron = 321; m.renameShip('Keeper');
  assert.equal(saveGame(m, undefined, stores), undefined); await settle();
  assert.ok(stores.small.data.has(SAVE_KEY)); assert.equal(stores.large.data.get('current')!.text, stores.small.data.get(SAVE_KEY));
  const loaded = await loadSavedGame(stores); assert.equal(loaded!.stored.iron, 321); assert.equal(loaded!.shipName, 'Keeper'); assert.equal(loaded!.seed, m.seed);
});

test('a world too big for the small store still saves and the newest copy loads', async () => {
  const m = fixtureModel(); m.stored.iron = 10;
  const stores = { small: smallStore(saveText(m).length + 200), large: largeStore() }; let reported = '';
  assert.equal(saveGame(m, message => { reported = message; }, stores), undefined); await settle();
  const firstSmall = stores.small.data.get(SAVE_KEY);
  // The world grows past the small store's quota.
  m.stored.iron = 777; for (let i = 0; i < 400; i++) m.toggleWaypoint({ x: 100 + i * 37.123456, y: 200 + i * 11.654321 }, 0) === 'full' && m.waypoints.pop();
  m.waypoints = Array.from({ length: 400 }, (_, i) => ({ id: 900000 + i, x: 100 + i * 37.123456, y: 200 + i * 11.654321 }));
  assert.equal(saveGame(m, message => { reported = message; }, stores), undefined); await settle();
  assert.equal(reported, ''); assert.equal(stores.small.data.get(SAVE_KEY), firstSmall, 'the older small copy is left intact');
  const loaded = await loadSavedGame(stores); assert.equal(loaded!.stored.iron, 777); assert.equal(loaded!.waypoints.length, 400);
});

test('saving reports failure only when no store takes the save', async () => {
  const m = fixtureModel();
  assert.equal(saveGame(m, undefined, {}), SAVE_FAILED);
  assert.equal(saveGame(m, undefined, { small: smallStore(10) }), SAVE_FAILED);
  let reported = ''; assert.equal(saveGame(m, message => { reported = message; }, { small: smallStore(10), large: largeStore(true) }), undefined); await settle();
  assert.equal(reported, SAVE_FAILED);
  reported = ''; const stores = { small: smallStore(), large: largeStore(true) };
  assert.equal(saveGame(m, message => { reported = message; }, stores), undefined); await settle(); assert.equal(reported, '');
  assert.equal((await loadSavedGame(stores))!.seed, m.seed);
});

test('saves written before this change, with no timestamp, still load', async () => {
  const m = fixtureModel(); m.stored.copper = 44; const small = smallStore(); small.set(SAVE_KEY, JSON.stringify(m.toSave()));
  assert.equal((await loadSavedGame({ small, large: largeStore() }))!.stored.copper, 44);
  assert.equal((await loadSavedGame({ small }))!.stored.copper, 44);
  assert.equal(await loadSavedGame({ small: smallStore(), large: largeStore() }), null); assert.equal(await loadSavedGame({}), null);
});

test('a corrupt newest copy falls back to the other store', async () => {
  const m = fixtureModel(), stores = { small: smallStore(), large: largeStore() };
  saveGame(m, undefined, stores); await settle();
  stores.large.data.set('current', { at: Date.now() + 1000, text: '{"broken":' });
  assert.equal((await loadSavedGame(stores))!.seed, m.seed);
});

test('the backup moves to the large store and frees the old small backup', async () => {
  const m = fixtureModel(), stores = { small: smallStore(), large: largeStore() };
  stores.small.set('voidforge.save.backup', 'old backup'); saveGame(m, undefined, stores); await settle();
  await backupSavedGame(stores);
  assert.equal(stores.large.data.get('backup')!.text, stores.large.data.get('current')!.text); assert.equal(stores.small.data.has('voidforge.save.backup'), false);
  const fallback: SaveStores & { small: ReturnType<typeof smallStore> } = { small: smallStore(), large: largeStore(true) };
  saveGame(m, undefined, fallback); await settle(); await backupSavedGame(fallback);
  assert.equal(fallback.small.data.get('voidforge.save.backup'), fallback.small.data.get(SAVE_KEY));
});

test('save text trims float digits without touching integers and stays a valid save', () => {
  const m = fixtureModel(); m.player.x = 3200.123456789; m.player.vx = -5.376092279371112e-8; m.stored.iron = 123456789;
  const full = JSON.stringify(m.toSave()), text = saveText(m), data = JSON.parse(text);
  assert.ok(text.length < full.length); assert.equal(data.player.x, 3200.1235); assert.equal(data.player.vx, 0);
  assert.equal(data.stored.iron, 123456789); assert.equal(data.rng, m.toSave().rng); assert.equal(data.id, m.toSave().id);
  // Loading the trimmed text gives the same world as loading the full-precision text.
  const loaded = GameModel.fromSave(data), exact = GameModel.fromSave(JSON.parse(full)); assert.equal(loaded.asteroids.length, exact.asteroids.length); assert.ok(loaded.asteroids.length > 0);
  loaded.asteroids.forEach((rock, i) => { const other = exact.asteroids[i]; assert.equal(rock.id, other.id); assert.equal(rock.ore, other.ore); assert.ok(Math.abs(rock.x - other.x) < 1e-3 && Math.abs(rock.y - other.y) < 1e-3 && Math.abs(rock.amount - other.amount) < 1e-3); });
  // Saving the loaded world again is stable: rounding does not drift.
  assert.equal(saveText(GameModel.fromSave(JSON.parse(saveText(loaded)))), saveText(loaded));
});


test('confirmed saves await durable storage and report failure only when both copies fail',async()=>{
 const m=fixtureModel(),large=largeStore();assert.equal(await saveGameConfirmed(m,{large}),undefined);assert.ok(large.data.has('current'));
 assert.equal(await saveGameConfirmed(m,{small:smallStore(),large:largeStore(true)}),undefined);
 assert.equal(await saveGameConfirmed(m,{small:smallStore(1),large:largeStore(true)}),SAVE_FAILED);
});
test('backup reports failure without clearing the active save',async()=>{
 const m=fixtureModel(),text=saveText(m),small={get:(key:string)=>key===SAVE_KEY?text:null,set:()=>{throw new Error('full');},remove:()=>{throw new Error('must not clear');}};
 assert.equal(await backupSavedGame({small}),false);assert.equal(small.get(SAVE_KEY),text);
 assert.equal(await backupSavedGame({small:smallStore()}),true);
});

test('backup preserves the valid older world when the newest save copy is corrupt',async()=>{
 const small=smallStore(),large=largeStore(),model=fixtureModel(),text=saveText(model);
 small.set(SAVE_KEY,'broken');small.set('voidforge.save.at','200');large.data.set('current',{at:100,text});
 assert.equal(await backupSavedGame({small,large}),true);assert.equal(large.data.get('backup')!.text,text);
});
