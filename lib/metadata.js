// Game metadata (tags, multiplayer categories, review counts) comes from the
// Steam store and SteamSpy. Both are rate limited, so lookups go through a
// throttled background queue and are cached on disk forever.

import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'steam-picker (personal use)' },
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function fetchStoreMeta(appid) {
  const [store, spy] = await Promise.allSettled([
    getJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&cc=us`),
    getJson(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`),
  ]);
  // The store is the source of truth for multiplayer info; if it's down or
  // rate limiting us, retry later rather than caching a half answer.
  if (store.status === 'rejected') throw store.reason;

  const entry = store.value?.[appid];
  const d = entry?.success ? entry.data : null;
  const sp = spy.status === 'fulfilled' ? spy.value : null;

  const tagCounts = sp?.tags && !Array.isArray(sp.tags) ? Object.entries(sp.tags) : [];
  tagCounts.sort((a, b) => b[1] - a[1]);
  const max = tagCounts[0]?.[1] || 1;
  // sqrt flattens vote counts so one meme tag ("Dwarf") doesn't swamp the rest.
  let tags = tagCounts.slice(0, 20).map(([t, n]) => [t, +Math.sqrt(n / max).toFixed(3)]);
  if (!tags.length && d?.genres) tags = d.genres.map((g) => [g.description, 0.6]);

  const positive = sp?.positive ?? null;
  const negative = sp?.negative ?? null;

  if (!d && !tags.length) return { missing: true };
  return {
    name: d?.name ?? sp?.name ?? null,
    type: d?.type ?? null,
    header: d?.header_image ?? null,
    categories: d?.categories?.map((c) => c.id) ?? [],
    tags,
    positive,
    negative,
  };
}

export function createMetadataStore({ fetcher, cacheFile, delayMs = 1500 }) {
  let cache = {};
  if (cacheFile) {
    try {
      cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
    } catch {
      cache = {};
    }
  }

  const buckets = [[], [], []]; // high, mid, low priority
  const queuedAt = new Map(); // appid -> bucket index
  const retryAfter = new Map(); // appid -> timestamp
  let running = false;
  let done = 0;
  let dirty = 0;
  let saveTimer = null;

  function scheduleSave() {
    if (!cacheFile) return;
    dirty++;
    if (dirty >= 25) return void save();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 5000);
  }

  async function save() {
    clearTimeout(saveTimer);
    dirty = 0;
    await mkdir(path.dirname(cacheFile), { recursive: true });
    const tmp = `${cacheFile}.tmp`;
    await writeFile(tmp, JSON.stringify(cache));
    await rename(tmp, cacheFile);
  }

  function next() {
    for (const b of buckets) if (b.length) return b.shift();
    return undefined;
  }

  async function run() {
    if (running) return;
    running = true;
    let appid;
    while ((appid = next()) !== undefined) {
      queuedAt.delete(appid);
      if (cache[appid]) continue;
      try {
        cache[appid] = await fetcher(appid);
        done++;
        scheduleSave();
      } catch (e) {
        if (e.status === 429 || e.status === 403) {
          // Rate limited: put it back and back off for a minute.
          buckets[0].unshift(appid);
          queuedAt.set(appid, 0);
          await sleep(60e3);
          continue;
        }
        retryAfter.set(appid, Date.now() + 10 * 60e3);
      }
      if (delayMs) await sleep(delayMs);
    }
    running = false;
  }

  return {
    get: (appid) => cache[appid],

    want(appids, priority = 1) {
      const now = Date.now();
      for (const appid of appids) {
        if (cache[appid]) continue;
        if ((retryAfter.get(appid) ?? 0) > now) continue;
        const current = queuedAt.get(appid);
        if (current !== undefined && current <= priority) continue;
        if (current !== undefined) {
          const b = buckets[current];
          b.splice(b.indexOf(appid), 1);
        }
        buckets[priority].push(appid);
        queuedAt.set(appid, priority);
      }
      run();
    },

    status: () => ({ pending: queuedAt.size, fetched: done, known: Object.keys(cache).length }),
  };
}
