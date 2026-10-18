// Scoring. Everything here is pure so it can be tested with fixture data.
//
// Taste: each game becomes a unit vector over its Steam user tags. A player's
// taste profile is the sum of those vectors weighted by log(hours played),
// boosted for recent play and damped for games they bounced off. A candidate's
// affinity is its cosine similarity to that profile, with the candidate's own
// contribution removed so "you played this 300h" counts as familiarity, not as
// "this is similar to what you like".

const DAY = 86400;
const MIN_HOURS = 0.5;

// Tags that say nothing about what kind of game it is.
const STOP_TAGS = new Set([
  'Singleplayer', 'Multiplayer', 'Free to Play', 'Early Access', 'Indie',
  'Great Soundtrack', 'Controller', 'Steam Achievements',
]);

// Steam store category ids.
const MP_CATEGORIES = new Set([1, 9, 20, 24, 27, 36, 37, 38, 39, 44, 47, 48, 49]);
const LOCAL_ONLY_CATEGORIES = new Set([24, 37, 39, 47, 48]); // split screen / LAN
const REMOTE_PLAY_TOGETHER = 44;
const MP_TAGS = new Set(['Multiplayer', 'Co-op', 'Online Co-Op', 'PvP', 'Online PvP', 'Massively Multiplayer', 'MMORPG']);

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function dot(a, b) {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [k, x] of small) {
    const y = big.get(k);
    if (y) s += x * y;
  }
  return s;
}

function normalize(v) {
  const n = Math.sqrt(dot(v, v));
  if (!n) return null;
  const out = new Map();
  for (const [k, x] of v) out.set(k, x / n);
  return out;
}

export function gameVector(meta) {
  if (!meta?.tags?.length) return null;
  const v = new Map();
  for (const [tag, w] of meta.tags.slice(0, 15)) if (!STOP_TAGS.has(tag)) v.set(tag, w);
  return normalize(v);
}

export function multiplayerInfo(meta) {
  if (!meta || meta.missing) return { mp: null, localOnly: false };
  const cats = meta.categories || [];
  if (cats.length) {
    const mpCats = cats.filter((c) => MP_CATEGORIES.has(c));
    if (!mpCats.length) return { mp: false, localOnly: false };
    const localOnly = !cats.includes(REMOTE_PLAY_TOGETHER) && mpCats.every((c) => LOCAL_ONLY_CATEGORIES.has(c));
    return { mp: true, localOnly };
  }
  if (meta.tags?.some(([t]) => MP_TAGS.has(t))) return { mp: true, localOnly: false };
  return { mp: null, localOnly: false };
}

function isBounced(g, now) {
  return g.hours > 0.2 && g.hours < 2 && !g.hours2w && g.lastPlayed > 0 && now - g.lastPlayed > 180 * DAY;
}

function playWeight(g, now) {
  if (g.hours < MIN_HOURS) return 0;
  let w = Math.log1p(g.hours);
  if (g.hours2w > 0) w *= 1.5;
  else if (g.lastPlayed && now - g.lastPlayed < 60 * DAY) w *= 1.2;
  if (isBounced(g, now)) w *= 0.3;
  return w;
}

export function buildProfile(library, getMeta, now = Date.now() / 1000) {
  const sum = new Map();
  const contrib = new Map(); // appid -> weight it added
  for (const g of library) {
    const w = playWeight(g, now);
    if (!w) continue;
    const v = gameVector(getMeta(g.appid));
    if (!v) continue;
    contrib.set(g.appid, w);
    for (const [t, x] of v) sum.set(t, (sum.get(t) || 0) + w * x);
  }
  const sum2 = dot(sum, sum);
  const topTags = [...sum].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  return { sum, sum2, contrib, used: contrib.size, topTags };
}

// Cosine similarity of a game to the profile, leaving the game itself out.
function affinity(profile, appid, v) {
  if (profile.used < 3) return null;
  const d = dot(v, profile.sum);
  const w = profile.contrib.get(appid) || 0;
  const num = d - w;
  const den2 = profile.sum2 - 2 * w * d + w * w;
  if (den2 <= 1e-9) return null;
  return Math.max(0, num / Math.sqrt(den2));
}

function topMatchingTags(v, groupTaste, n = 3) {
  return [...v]
    .map(([t, x]) => [t, x * (groupTaste.get(t) || 0)])
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

function qualityOf(meta) {
  const pos = meta?.positive ?? 0;
  const neg = meta?.negative ?? 0;
  if (pos + neg < 50) return { q: 0.5, pct: null };
  const pct = pos / (pos + neg);
  return { q: clamp01((pct - 0.5) * 2), pct: Math.round(pct * 100) };
}

/**
 * members: [{ steamid, name, isMe, library: [ownedGame] | null }]
 * novelty: 0 = stick to what we know, 1 = something new (only used with backlog)
 */
export function recommend({ members, getMeta, hidden = new Set(), backlog = true, novelty = 0.5, now = Date.now() / 1000 }) {
  const group = members.length > 1;
  const known = members
    .filter((m) => m.library)
    .map((m) => ({
      ...m,
      owned: new Map(m.library.map((g) => [g.appid, g])),
      profile: buildProfile(m.library, getMeta, now),
    }));
  const hiddenLibraries = members.filter((m) => !m.library).map((m) => m.name);

  // Combined taste: every member counts equally regardless of total hours.
  const groupTaste = new Map();
  for (const m of known) {
    if (m.profile.used < 3) continue;
    const n = Math.sqrt(m.profile.sum2);
    for (const [t, x] of m.profile.sum) groupTaste.set(t, (groupTaste.get(t) || 0) + x / n);
  }

  const owners = new Map();
  const names = new Map();
  known.forEach((m, i) => {
    for (const g of m.library) {
      if (!owners.has(g.appid)) owners.set(g.appid, []);
      owners.get(g.appid).push(i);
      if (!names.has(g.appid)) names.set(g.appid, g.name);
    }
  });

  const full = [];
  const almost = [];
  for (const [appid, idx] of owners) {
    if (hidden.has(appid)) continue;
    if (idx.length === known.length) full.push(appid);
    else if (known.length >= 2 && idx.length === known.length - 1) almost.push(appid);
  }

  const discover = backlog ? clamp01(novelty) : 0;
  const comfort = 1 - discover;

  function evaluate(appid) {
    const meta = getMeta(appid);
    if (meta?.type && meta.type !== 'game') return null;
    const mp = multiplayerInfo(meta);
    if (group && mp.mp === false) return null;

    const entries = known.map((m) => ({ m, g: m.owned.get(appid) }));
    const playedBy = entries.filter(({ g }) => g && g.hours >= MIN_HOURS);
    if (!backlog && !playedBy.length) return null;

    const fam = mean(entries.map(({ g }) => (g ? Math.min(1, Math.log1p(g.hours) / Math.log1p(150)) : 0)));
    const rec = mean(entries.map(({ g }) => (g ? Math.min(1, Math.log1p(g.hours2w) / Math.log1p(15)) : 0)));
    const bounce = mean(entries.map(({ g }) => (g && isBounced(g, now) ? 1 : 0)));

    const v = gameVector(meta);
    const affs = v ? known.map((m) => affinity(m.profile, appid, v)).filter((a) => a !== null) : [];
    const aff = affs.length ? mean(affs) : null;
    const { q, pct } = qualityOf(meta);

    const flags = [];
    if (!meta || meta.missing) flags.push('unknownMeta');
    if (group && mp.mp === null) flags.push('mpUnverified');
    if (group && mp.localOnly) flags.push('localOnly');
    if (bounce > 0) flags.push('bounced');
    if (!playedBy.length) flags.push(group ? 'newToAll' : 'backlog');
    if (rec > 0) flags.push('recent');

    return {
      appid,
      name: meta?.name || names.get(appid),
      header: meta?.header || null,
      aff, fam, rec, bounce, q,
      mp,
      quality: pct,
      tags: v && groupTaste.size ? topMatchingTags(v, groupTaste) : [],
      hours: entries.map(({ m, g }) => ({
        name: m.name,
        isMe: !!m.isMe,
        owns: !!g,
        hours: g ? +g.hours.toFixed(1) : 0,
        hours2w: g ? +g.hours2w.toFixed(1) : 0,
      })),
      missing: entries.filter(({ g }) => !g).map(({ m }) => m.name),
      flags,
    };
  }

  const scored = full.map(evaluate).filter(Boolean);
  const scoredAlmost = almost.map(evaluate).filter(Boolean);

  // Affinity is relative: the best match in this pool counts as 1.
  const maxAff = Math.max(0.01, ...[...scored, ...scoredAlmost].map((s) => s.aff ?? 0));
  for (const s of [...scored, ...scoredAlmost]) {
    const a = s.aff === null ? 0.35 : s.aff / maxAff;
    s.match = Math.round(a * 100);
    s.score =
      0.5 * a +
      comfort * (0.3 * s.fam + 0.15 * s.rec) +
      discover * 0.3 * (1 - s.fam) +
      0.1 * s.q -
      0.15 * s.bounce -
      (s.flags.includes('localOnly') ? 0.2 : 0) -
      (s.flags.includes('mpUnverified') ? 0.08 : 0);
    delete s.aff;
    delete s.q;
  }

  const byScore = (a, b) => b.score - a.score;
  scored.sort(byScore);
  scoredAlmost.sort(byScore);

  // What the server should look up next.
  const noMeta = (appid) => getMeta(appid) === undefined;
  const maxHours = (appid) => Math.max(...known.map((m) => m.owned.get(appid)?.hours ?? 0));
  const needMeta = {
    high: full.filter(noMeta).sort((a, b) => maxHours(b) - maxHours(a)),
    mid: known.flatMap((m) =>
      [...m.library].filter((g) => g.hours >= MIN_HOURS).sort((a, b) => b.hours - a.hours).slice(0, 60).map((g) => g.appid).filter(noMeta),
    ),
    low: almost.filter(noMeta),
  };

  return {
    ranked: scored.slice(0, 40),
    almost: scoredAlmost.filter((s) => s.mp.mp !== null).slice(0, 6),
    groupTaste: [...groupTaste].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t),
    members: known.map((m) => ({ name: m.name, isMe: !!m.isMe, games: m.library.length, tasteTags: m.profile.topTags.slice(0, 5) })),
    hiddenLibraries,
    candidates: full.length,
    analyzed: full.filter((a) => !noMeta(a)).length,
    needMeta,
  };
}
