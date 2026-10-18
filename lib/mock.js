// Demo data used when no STEAM_API_KEY is set (or STEAM_MOCK=1), so the app
// can be tried without a key. Friends are fictional; games are real app ids so
// the store art loads.

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

// appid: [name, tags (most-voted first), store category ids, % positive]
const GAMES = {
  730: ['Counter-Strike 2', 'FPS,Shooter,Competitive,Tactical,Action,Team-Based', [1, 36, 49], 87],
  570: ['Dota 2', 'MOBA,Strategy,Competitive,Team-Based,Action RTS', [1, 36, 49], 81],
  413150: ['Stardew Valley', 'Farming Sim,Life Sim,Relaxing,Pixel Graphics,Cozy,RPG,Co-op', [2, 1, 9, 38, 24], 98],
  548430: ['Deep Rock Galactic', 'Co-op,FPS,PvE,Mining,Action,Procedural Generation,Online Co-Op', [2, 1, 9, 38], 97],
  105600: ['Terraria', 'Sandbox,Survival,2D,Crafting,Action,Co-op,Exploration', [2, 1, 9, 38, 36], 97],
  892970: ['Valheim', 'Survival,Open World,Crafting,Co-op,Exploration,Base Building', [2, 1, 9, 38], 94],
  1145360: ['Hades', 'Roguelike,Action,Hack and Slash,Mythology,Isometric,Roguelite', [2], 98],
  367520: ['Hollow Knight', 'Metroidvania,Souls-like,2D,Platformer,Difficult,Exploration', [2], 97],
  1086940: ["Baldur's Gate 3", 'RPG,CRPG,Turn-Based Combat,Story Rich,Fantasy,Co-op', [2, 1, 9, 38], 96],
  252950: ['Rocket League', 'Sports,Competitive,Racing,Soccer,Team-Based', [2, 1, 36, 24, 27], 85],
  945360: ['Among Us', 'Social Deduction,Party,Multiplayer,Casual,Funny', [1, 36, 27], 87],
  1966720: ['Lethal Company', 'Horror,Co-op,Funny,Survival Horror,Online Co-Op,Procedural Generation', [1, 9, 38], 97],
  739630: ['Phasmophobia', 'Horror,Co-op,Psychological Horror,Investigation,Online Co-Op', [2, 1, 9, 38], 95],
  646570: ['Slay the Spire', 'Roguelike Deckbuilder,Card Game,Strategy,Roguelike,Turn-Based,Roguelite', [2], 97],
  289070: ["Sid Meier's Civilization VI", '4X,Turn-Based Strategy,Strategy,Historical,Grand Strategy', [2, 1, 36], 85],
  1245620: ['ELDEN RING', 'Souls-like,Open World,RPG,Difficult,Dark Fantasy,Exploration', [2, 1, 38, 36], 93],
  620: ['Portal 2', 'Puzzle,Co-op,First-Person,Comedy,Sci-fi', [2, 1, 9, 38, 24], 98],
  1623730: ['Palworld', 'Survival,Open World,Creature Collector,Crafting,Co-op,Base Building', [2, 1, 9, 38, 36], 93],
  2379780: ['Balatro', 'Roguelike Deckbuilder,Card Game,Roguelike,Poker,Strategy,Roguelite', [2], 98],
  1172470: ['Apex Legends', 'Battle Royale,FPS,Hero Shooter,Free to Play,Team-Based,Shooter', [1, 36, 27], 67],
  322330: ["Don't Starve Together", 'Survival,Co-op,Crafting,Roguelike,Difficult,Open World', [1, 9, 38], 95],
  960090: ['Bloons TD 6', 'Tower Defense,Strategy,Co-op,Casual,Online Co-Op', [2, 1, 9, 38], 97],
  1794680: ['Vampire Survivors', 'Roguelite,Bullet Hell,Action,Pixel Graphics,Casual,Roguelike', [2, 24, 39, 44], 97],
  427520: ['Factorio', 'Automation,Base Building,Strategy,Simulation,Crafting,Sandbox', [2, 1, 9, 38], 98],
  271590: ['Grand Theft Auto V', 'Open World,Action,Crime,Multiplayer,Story Rich,Shooter', [2, 1, 36, 38], 87],
  1426210: ['It Takes Two', 'Co-op,Platformer,Puzzle,Story Rich,Split Screen,Online Co-Op', [1, 9, 38, 24, 39], 95],
  1091500: ['Cyberpunk 2077', 'Open World,RPG,Cyberpunk,Story Rich,FPS,Sci-fi', [2], 86],
  292030: ['The Witcher 3: Wild Hunt', 'Open World,RPG,Story Rich,Fantasy,Mature,Exploration', [2], 96],
  264710: ['Subnautica', 'Survival,Open World,Underwater,Exploration,Crafting,Base Building', [2], 96],
  268910: ['Cuphead', 'Difficult,Platformer,Bullet Hell,2D,Hand-drawn,Local Co-Op', [2, 24, 39], 96],
};

// [appid, hours, hours in last 2 weeks, days since last played]
const LIBRARIES = {
  '76561190000000001': [
    [646570, 210, 6, 1], [2379780, 64, 9, 0], [1145360, 85, 0, 40], [548430, 140, 0, 20],
    [105600, 95, 0, 300], [892970, 60, 0, 200], [730, 30, 0, 400], [1086940, 120, 0, 90],
    [367520, 1.1, 0, 700], [413150, 0, 0, 0], [1966720, 18, 0, 60], [620, 22, 0, 1500],
    [322330, 0, 0, 0], [960090, 12, 0, 30], [1794680, 30, 0, 120], [427520, 0, 0, 0],
    [1091500, 0.3, 0, 900], [264710, 0, 0, 0], [1623730, 25, 0, 150], [289070, 3, 0, 900],
    [271590, 8, 0, 1000], [1426210, 0, 0, 0], [739630, 4, 0, 500], [1172470, 1.5, 0, 800],
    [268910, 0, 0, 0],
  ],
  '76561190000000002': [ // Alex: co-op survival + shooters
    [548430, 300, 4, 3], [1966720, 40, 0, 50], [892970, 80, 0, 120], [105600, 20, 0, 400],
    [1623730, 60, 10, 0], [739630, 30, 0, 200], [730, 900, 15, 0], [322330, 15, 0, 300],
    [1426210, 14, 0, 600], [620, 10, 0, 2000], [1172470, 200, 0, 90], [427520, 0, 0, 0],
    [960090, 0, 0, 0], [264710, 35, 0, 700], [268910, 6, 0, 900],
  ],
  '76561190000000003': [ // Sam: cozy co-op
    [413150, 180, 2, 5], [105600, 150, 0, 60], [322330, 40, 0, 200], [960090, 90, 5, 1],
    [620, 15, 0, 1800], [1966720, 6, 0, 100], [945360, 30, 0, 500], [1426210, 12, 0, 400],
    [548430, 0, 0, 0], [892970, 0, 0, 0], [1794680, 10, 0, 300], [268910, 8, 0, 800],
  ],
  '76561190000000004': [ // Jordan: competitive
    [730, 1500, 20, 0], [1172470, 400, 0, 30], [252950, 600, 3, 4], [570, 300, 0, 200],
    [271590, 120, 0, 400], [548430, 2, 0, 600], [945360, 10, 0, 700], [1966720, 5, 0, 80],
  ],
  '76561190000000005': [ // Riley: big RPGs and strategy
    [1086940, 200, 0, 30], [1245620, 150, 0, 300], [292030, 120, 0, 900], [1091500, 90, 0, 200],
    [289070, 400, 6, 2], [427520, 250, 0, 60], [892970, 30, 0, 500], [548430, 0, 0, 0],
    [413150, 0, 0, 0], [264710, 20, 0, 1000],
  ],
};

const PEOPLE = [
  { steamid: '76561190000000001', name: 'You (demo)', state: 1 },
  { steamid: '76561190000000002', name: 'Alex', state: 1, gameId: 1623730 },
  { steamid: '76561190000000003', name: 'Sam', state: 1 },
  { steamid: '76561190000000004', name: 'Jordan', state: 1, gameId: 730 },
  { steamid: '76561190000000005', name: 'Riley', state: 0 },
  { steamid: '76561190000000006', name: 'Casey', state: 3, privateProfile: true },
];

export function createMockClient() {
  return {
    meId: PEOPLE[0].steamid,
    async resolveId() {
      return PEOPLE[0].steamid;
    },
    async getFriendIds() {
      return PEOPLE.slice(1).map((p) => p.steamid);
    },
    async getSummaries(ids) {
      return PEOPLE.filter((p) => ids.includes(p.steamid)).map((p) => ({
        steamid: p.steamid,
        name: p.name,
        avatar: null,
        state: p.state,
        game: p.gameId ? GAMES[p.gameId][0] : null,
        gameId: p.gameId ?? null,
        publicProfile: !p.privateProfile,
        profileUrl: null,
      }));
    },
    async getOwnedGames(steamid) {
      const lib = LIBRARIES[steamid];
      if (!lib) return null;
      return lib.map(([appid, hours, hours2w, days]) => ({
        appid,
        name: GAMES[appid][0],
        hours,
        hours2w,
        lastPlayed: hours > 0 ? now() - days * DAY : 0,
      }));
    },
  };
}

export const mockAppIds = Object.keys(GAMES).map(Number);

export async function mockMetaFetcher(appid) {
  const g = GAMES[appid];
  if (!g) return { missing: true };
  const [name, tags, categories, pct] = g;
  const list = tags.split(',');
  return {
    name,
    type: 'game',
    header: null,
    categories,
    tags: list.map((t, i) => [t, +(1 - i * 0.12).toFixed(2)]),
    positive: pct * 1000,
    negative: (100 - pct) * 1000,
  };
}
