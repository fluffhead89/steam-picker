import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSteamClient } from './lib/steam.js';
import { createMockClient, mockAppIds, mockMetaFetcher } from './lib/mock.js';
import { createMetadataStore, fetchStoreMeta } from './lib/metadata.js';
import { buildProfile, recommend } from './lib/recommend.js';
import { createPrefs } from './lib/prefs.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3456;
const HOST = process.env.HOST || '127.0.0.1';
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const KEY = process.env.STEAM_API_KEY?.trim();
const MOCK = process.env.STEAM_MOCK === '1' || !KEY;

const steam = MOCK ? createMockClient() : createSteamClient(KEY);
const meta = createMetadataStore({
  fetcher: MOCK ? mockMetaFetcher : fetchStoreMeta,
  cacheFile: MOCK ? null : path.join(DATA, 'meta-cache.json'),
  delayMs: MOCK ? 0 : 1500,
});
const prefs = createPrefs(path.join(DATA, MOCK ? 'prefs-demo.json' : 'prefs.json'));
if (MOCK) meta.want(mockAppIds, 0);

let meIdPromise = null;
function getMeId() {
  meIdPromise ??= steam.resolveId(process.env.STEAM_ID).catch((e) => {
    meIdPromise = null;
    throw e;
  });
  return meIdPromise;
}

const routes = {
  async 'GET /api/me'() {
    const meId = await getMeId();
    const [me] = await steam.getSummaries([meId]);
    const library = await steam.getOwnedGames(meId);
    if (library) {
      const top = [...library].sort((a, b) => b.hours - a.hours).slice(0, 150);
      meta.want(top.map((g) => g.appid), 1);
    }
    return {
      mode: MOCK ? 'demo' : 'live',
      me,
      librarySize: library?.length ?? null,
      tasteTags: library ? buildProfile(library, meta.get).topTags : [],
      hidden: prefs.hiddenList(),
    };
  },

  async 'GET /api/friends'() {
    const meId = await getMeId();
    const ids = await steam.getFriendIds(meId);
    if (ids === null) return { private: true, friends: [] };
    const friends = await steam.getSummaries(ids);
    const rank = (f) => (f.game ? 0 : f.state === 1 || f.state === 6 ? 1 : f.state > 0 ? 2 : 3);
    friends.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return { private: false, friends };
  },

  async 'POST /api/recommend'(body) {
    const meId = await getMeId();
    const friendIds = (Array.isArray(body.members) ? body.members : [])
      .filter((id) => /^\d{17}$/.test(id) && id !== meId)
      .slice(0, 15);
    const ids = [meId, ...friendIds];
    const summaries = await steam.getSummaries(ids);
    const nameOf = new Map(summaries.map((s) => [s.steamid, s.name]));
    const libraries = await Promise.all(ids.map((id) => steam.getOwnedGames(id).catch(() => null)));
    const members = ids.map((id, i) => ({
      steamid: id,
      name: id === meId ? 'You' : nameOf.get(id) ?? 'Friend',
      isMe: id === meId,
      library: libraries[i],
    }));
    if (!members[0].library) {
      throw Object.assign(new Error("Your own library isn't visible. Set Game details to Public in Steam privacy settings."), { status: 400 });
    }
    const result = recommend({
      members,
      getMeta: meta.get,
      hidden: prefs.hiddenSet(),
      backlog: !!body.backlog,
      novelty: Number(body.novelty ?? 0.5),
    });
    const { needMeta, ...rest } = result;
    meta.want(needMeta.high, 0);
    meta.want(needMeta.mid, 1);
    meta.want(needMeta.low, 2);
    return { ...rest, metaStatus: meta.status() };
  },

  'GET /api/status'() {
    return meta.status();
  },

  'POST /api/hide'(body) {
    const appid = Number(body.appid);
    if (!Number.isInteger(appid)) throw Object.assign(new Error('Bad appid'), { status: 400 });
    prefs.setHidden(appid, String(body.name || ''), body.hidden !== false);
    return { hidden: prefs.hiddenList() };
  },
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const handler = routes[`${req.method} ${url.pathname}`];
  try {
    if (handler) {
      const body = req.method === 'POST' ? await readBody(req) : null;
      return send(res, 200, await handler(body));
    }
    if (req.method !== 'GET') return send(res, 404, { error: 'Not found' });
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, { error: 'Not found' });
    const data = await readFile(file).catch(() => null);
    if (!data) return send(res, 404, { error: 'Not found' });
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    console.error(e.message);
    send(res, e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Steam Picker running at http://localhost:${PORT} (${MOCK ? 'demo data — set STEAM_API_KEY in .env for your real library' : 'live Steam data'})`);
});
