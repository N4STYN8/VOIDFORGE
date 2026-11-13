import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameModel } from '../src/model.ts';
import { NetClient } from '../src/net.ts';
import { travel, worldRef, ownsSector, progressionScore, linkedHomes } from '../src/sectors.ts';
import { sectorSeed } from '../src/sectorGrid.ts';
import { startRelay } from '../server/relay.ts';
import { saveText } from '../src/persistence.ts';
import { WORLD } from '../src/data.ts';

const wait = async (check: () => boolean) => { for (let i = 0; i < 400 && !check(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(check()); };

test('progression score counts the core ten times plus every module level', () => {
  assert.equal(progressionScore({ coreLevel: 2, modules: [{ level: 3 }, { level: 1 }] } as never), 24);
});

test('the relay matches the online pilot closest in progression, never yourself or homes already linked', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1' }), url = `ws://127.0.0.1:${relay.port}`;
  try {
    const me = new NetClient(), close = new NetClient(), far = new NetClient(), other = new NetClient();
    for (const [c, name] of [[me, 'Me'], [close, 'Close'], [far, 'Far'], [other, 'Other']] as const) c.connect(url, name);
    await wait(() => [me, close, far, other].every(c => c.connected));
    me.profile('home-me', 40); close.profile('home-close', 46); far.profile('home-far', 400); other.profile('home-other', 30);
    await new Promise(r => setTimeout(r, 30));
    const first = await me.match([]);
    assert.equal(first?.world.home, 'home-close'); assert.equal(first?.name, 'Close'); assert.equal(first?.world.seed, 'home-close');
    const second = await me.match(['home-close']);
    assert.equal(second?.world.home, 'home-other', 'next closest once the first is linked');
    assert.equal(await me.match(['home-close', 'home-other']), null, 'ten times stronger is not a fair neighbour');
    const offline = new NetClient(); assert.equal(await offline.match([]), null);
    for (const c of [me, close, far, other]) c.disconnect();
  } finally { await relay.close(); }
});

test('a matched cell becomes that pilot\'s home sector and stays linked across travel and saves', () => {
  const home = new GameModel('match-home'), neighbour = new GameModel('neighbour-home');
  home.player.x = WORLD.width - 20; home.player.y = 9000;
  const east = travel(home, 'east', { world: { home: 'neighbour-home', x: 0, y: 0, seed: 'neighbour-home' }, name: 'Nate' });
  assert.equal(east.seed, 'neighbour-home', 'the neighbour\'s own generated world');
  assert.deepEqual(east.world.spec.belts, neighbour.world.spec.belts);
  assert.equal(east.sectorName, "Nate's sector");
  assert.deepEqual([east.galaxy.x, east.galaxy.y], [1, 0], 'still on the pilot\'s own grid');
  assert.deepEqual(worldRef(east), { home: 'neighbour-home', x: 0, y: 0, seed: 'neighbour-home' }, 'same relay room as the neighbour');
  assert.equal(ownsSector(east), false); assert.equal(ownsSector(home), true);
  assert.deepEqual(linkedHomes(east), ['neighbour-home']);
  // Edges from a linked cell continue on the pilot's own grid.
  east.player.x = WORLD.width - 20;
  const further = travel(east, 'east');
  assert.equal(further.seed, sectorSeed('match-home', 2, 0));
  further.player.x = 20;
  const back = travel(further, 'west', { world: { home: 'someone-else', x: 0, y: 0, seed: 'someone-else' } });
  assert.equal(back.seed, 'neighbour-home', 'a visited cell never changes, whatever matchmaking says');
  const loaded = GameModel.fromSave(JSON.parse(saveText(back)));
  assert.equal(loaded.galaxy.links?.['1,0']?.name, 'Nate');
  assert.equal(loaded.sectorName, "Nate's sector");
});
