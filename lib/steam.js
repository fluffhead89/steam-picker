// Thin client for the Steam Web API. Responses are cached in memory so
// clicking around the UI doesn't hammer Steam.

const API = 'https://api.steampowered.com';

export class SteamError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function normalizeSummary(p) {
  return {
    steamid: p.steamid,
    name: p.personaname,
    avatar: p.avatarmedium || p.avatar || null,
    state: p.personastate ?? 0, // 0 offline, 1 online, 2 busy, 3 away, 4 snooze, 5 trade, 6 looking to play
    game: p.gameextrainfo || null,
    gameId: p.gameid ? Number(p.gameid) : null,
    publicProfile: p.communityvisibilitystate === 3,
    profileUrl: p.profileurl || null,
  };
}

export function normalizeOwnedGame(g) {
  return {
    appid: g.appid,
    name: g.name || `App ${g.appid}`,
    hours: (g.playtime_forever || 0) / 60,
    hours2w: (g.playtime_2weeks || 0) / 60,
    lastPlayed: g.rtime_last_played || 0, // unix seconds, 0 = never / unknown
  };
}

export function createSteamClient(key) {
  const cache = new Map();

  async function call(iface, method, version, params, ttlMs) {
    const cacheKey = `${iface}/${method}?${new URLSearchParams(params)}`;
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value;

    const qs = new URLSearchParams({ ...params, key, format: 'json' });
    const res = await fetch(`${API}/${iface}/${method}/v${version}/?${qs}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 403) throw new SteamError('Steam rejected the API key. Check STEAM_API_KEY in .env.', 403);
    if (!res.ok) throw new SteamError(`Steam API ${method} failed (HTTP ${res.status})`, res.status);
    const value = await res.json();
    cache.set(cacheKey, { value, expires: Date.now() + ttlMs });
    return value;
  }

  return {
    // Accepts a SteamID64, a vanity name, or a full profile URL.
    async resolveId(input) {
      const s = (input || '').trim();
      if (!s) throw new SteamError('Set STEAM_ID in .env (your SteamID64, vanity name, or profile URL).');
      const byProfile = s.match(/profiles\/(\d{17})/);
      if (byProfile) return byProfile[1];
      if (/^\d{17}$/.test(s)) return s;
      const vanity = s.match(/\/id\/([^/?#]+)/)?.[1] ?? s;
      const r = await call('ISteamUser', 'ResolveVanityURL', 1, { vanityurl: vanity }, 24 * 3600e3);
      if (r.response?.success === 1) return r.response.steamid;
      throw new SteamError(`Couldn't find a Steam profile for "${vanity}".`);
    },

    // Returns null when the friends list is private.
    async getFriendIds(steamid) {
      try {
        const r = await call('ISteamUser', 'GetFriendList', 1, { steamid, relationship: 'friend' }, 10 * 60e3);
        return (r.friendslist?.friends || []).map((f) => f.steamid);
      } catch (e) {
        if (e.status === 401) return null;
        throw e;
      }
    },

    async getSummaries(ids) {
      const out = [];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const r = await call('ISteamUser', 'GetPlayerSummaries', 2, { steamids: chunk.join(',') }, 60e3);
        out.push(...(r.response?.players || []).map(normalizeSummary));
      }
      return out;
    },

    // Returns null when the library isn't visible (private profile / game details).
    async getOwnedGames(steamid) {
      const r = await call(
        'IPlayerService', 'GetOwnedGames', 1,
        { steamid, include_appinfo: 1, include_played_free_games: 1 },
        30 * 60e3,
      );
      const resp = r.response;
      if (!resp || resp.game_count === undefined) return null;
      return (resp.games || []).map(normalizeOwnedGame);
    },
  };
}
