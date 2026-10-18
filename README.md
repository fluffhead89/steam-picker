# Steam Picker

Picks a Steam game for you (or your group) to play tonight.

- **Learns your taste from playtime.** Each game's Steam user tags are weighted by
  log(hours played), with a boost for recent play and a penalty for games you
  bounced off (under 2h and untouched for 6+ months).
- **Knows who's playing.** Pick friends from your list (online and in-game friends come first).
  Only games everyone owns are considered, and in a group they must support multiplayer.
  Local or split-screen-only games are ranked down.
- **Comfort ↔ something new.** Turn on backlog games and use the slider to choose between
  old favorites and games nobody has played yet.
- **"If someone grabs it"** lists good games that everyone except one person owns.
- Reroll, launch straight into Steam, or hide a game for good.

No dependencies. Needs Node 22.9 or newer.

## Setup

1. Get a Steam Web API key at https://steamcommunity.com/dev/apikey (any domain, e.g. `localhost`).
2. Copy `.env.example` to `.env` and fill in `STEAM_API_KEY` and `STEAM_ID` (SteamID64, vanity name, or profile URL).
3. Run:

```bash
npm start
```

Then open http://localhost:3456.

Without a key it runs on built-in demo data so you can try it out.

## Things to know

- **Privacy settings matter.** Your friends list and each person's "Game details" must be public
  (Steam → Profile → Edit Profile → Privacy Settings) for the app to see them. Private libraries
  are flagged in the UI and left out of the group check.
- **The first run is slow to get smart.** Tags and multiplayer info come from the Steam store and
  SteamSpy, which are rate limited, so the app looks up roughly 40 games a minute in the background.
  It starts with shared games and your most-played games. A progress pill shows how many are left.
  Results are cached in `data/meta-cache.json`, so this only happens once.
- Hidden games are stored in `data/prefs.json`.

## Running in Docker

`compose.yaml` builds the image and reads `STEAM_API_KEY` / `STEAM_ID` from `.env`.
The tag cache and hidden-games list are kept in the `steam-picker-data` volume.

```bash
docker compose up -d --build
```

It listens on port 3456. There's no login, so keep it on your home network or behind your reverse proxy.
Don't port-forward it.

## Tests

```bash
npm test
```
