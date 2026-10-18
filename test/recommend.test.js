import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockClient, mockAppIds, mockMetaFetcher } from '../lib/mock.js';
import { multiplayerInfo, recommend } from '../lib/recommend.js';

const client = createMockClient();
const metas = Object.fromEntries(await Promise.all(mockAppIds.map(async (id) => [id, await mockMetaFetcher(id)])));
const getMeta = (id) => metas[id];

async function members(...ids) {
  const all = await client.getSummaries(ids);
  return Promise.all(ids.map(async (id) => ({
    steamid: id,
    name: all.find((s) => s.steamid === id)?.name,
    isMe: id === client.meId,
    library: await client.getOwnedGames(id),
  })));
}

const ME = '76561190000000001';
const ALEX = '76561190000000002';
const SAM = '76561190000000003';
const CASEY = '76561190000000006';

test('group picks are owned by everyone and multiplayer', async () => {
  const r = recommend({ members: await members(ME, ALEX, SAM), getMeta });
  assert.ok(r.ranked.length > 0);
  const libs = await Promise.all([ME, ALEX, SAM].map((id) => client.getOwnedGames(id)));
  for (const g of r.ranked) {
    for (const lib of libs) assert.ok(lib.some((x) => x.appid === g.appid), `${g.name} not owned by all`);
    assert.notEqual(multiplayerInfo(metas[g.appid]).mp, false, `${g.name} is single-player`);
  }
});

test('local-only co-op is penalized for remote groups', async () => {
  const r = recommend({ members: await members(ME, ALEX, SAM), getMeta });
  const cuphead = r.ranked.find((g) => g.appid === 268910);
  assert.ok(cuphead?.flags.includes('localOnly'));
  assert.ok(r.ranked.indexOf(cuphead) > r.ranked.length / 2);
});

test('backlog off excludes games nobody played', async () => {
  const r = recommend({ members: await members(ME), getMeta, backlog: false });
  assert.ok(r.ranked.every((g) => g.hours.some((p) => p.hours >= 0.5)));
});

test('discover mode surfaces unplayed games near the top', async () => {
  const r = recommend({ members: await members(ME), getMeta, backlog: true, novelty: 1 });
  const top5 = r.ranked.slice(0, 5);
  assert.ok(top5.filter((g) => g.flags.includes('backlog')).length >= 3, top5.map((g) => g.name).join(', '));
});

test('private libraries are reported, not counted', async () => {
  const r = recommend({ members: await members(ME, ALEX, CASEY), getMeta });
  assert.deepEqual(r.hiddenLibraries, ['Casey']);
  assert.equal(r.members.length, 2);
});

test('hidden games never come back', async () => {
  const r = recommend({ members: await members(ME), getMeta, hidden: new Set([646570]) });
  assert.ok(!r.ranked.some((g) => g.appid === 646570));
});

test('missing metadata is requested, high priority first', async () => {
  const r = recommend({ members: await members(ME, ALEX), getMeta: () => undefined });
  assert.ok(r.needMeta.high.length > 0);
  assert.equal(r.analyzed, 0);
});
