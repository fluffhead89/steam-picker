const $ = (id) => document.getElementById(id);

// Tiny element builder: h('div', { class: 'x', onclick }, child, 'text', ...)
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const STATE_LABEL = { 0: 'Offline', 1: 'Online', 2: 'Busy', 3: 'Away', 4: 'Snooze', 5: 'Online', 6: 'Looking to play' };

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`steam-picker:${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`steam-picker:${key}`, JSON.stringify(value));
    } catch {
      // storage unavailable; settings just won't persist
    }
  },
};

const state = {
  me: null,
  friends: [],
  selected: new Set(store.get('selected', [])),
  result: null,
  current: null,
  skipped: new Set(),
  fetchedAtPick: 0,
  polling: null,
};

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

function avatar(person) {
  if (person.avatar) return h('img', { class: 'avatar', src: person.avatar, alt: '' });
  return h('div', { class: 'avatar', 'aria-hidden': 'true' }, (person.name || '?').trim().charAt(0).toUpperCase());
}

const ART_URLS = (appid, header) => [
  header,
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
].filter(Boolean);

function art(game) {
  const urls = ART_URLS(game.appid, game.header);
  const wrap = h('div', { class: 'art' });
  const img = h('img', { alt: '', loading: 'lazy' });
  let i = 0;
  img.addEventListener('error', () => {
    i++;
    if (i < urls.length) img.src = urls[i];
    else {
      img.remove();
      wrap.append(h('div', { class: 'fallback' }, game.name));
    }
  });
  img.src = urls[0];
  wrap.append(img);
  return wrap;
}

// ---------- Sidebar ----------

function renderMe() {
  const { me, tasteTags, librarySize } = state.me;
  $('me').replaceChildren(
    avatar(me),
    h('div', { class: 'who' },
      h('div', { class: 'name' }, me.name),
      h('div', { class: 'sub' }, librarySize === null ? 'Library private' : `${librarySize} games`),
      tasteTags.length ? h('div', { class: 'taste' }, tasteTags.slice(0, 5).map((t) => h('span', { class: 'chip tag' }, t))) : null,
    ),
  );
}

function friendStatus(f) {
  if (f.game) return h('div', { class: 'state ingame' }, `Playing ${f.game}`);
  const cls = f.state > 0 ? 'state online' : 'state';
  return h('div', { class: cls }, STATE_LABEL[f.state] || 'Offline');
}

function renderFriends() {
  const q = $('friend-search').value.trim().toLowerCase();
  const list = state.friends.filter((f) => !q || f.name.toLowerCase().includes(q));
  const online = list.filter((f) => f.state > 0);
  const offline = list.filter((f) => f.state === 0);

  const row = (f) => {
    const on = state.selected.has(f.steamid);
    return h('li', {},
      h('button', { class: 'friend', 'aria-pressed': String(on), onclick: () => toggleFriend(f.steamid) },
        h('span', { class: 'check', 'aria-hidden': 'true' }, on ? '✓' : ''),
        avatar(f),
        h('div', { class: 'info' },
          h('div', { class: 'name' }, f.name, f.publicProfile ? null : h('span', { class: 'lock', title: 'Private profile — library may not be visible' }, ' 🔒')),
          friendStatus(f),
        ),
      ),
    );
  };

  const items = [];
  if (online.length) items.push(h('li', { class: 'group-label' }, `Online — ${online.length}`), ...online.map(row));
  if (offline.length) items.push(h('li', { class: 'group-label' }, `Offline — ${offline.length}`), ...offline.map(row));
  if (!items.length) items.push(h('li', { class: 'group-label' }, state.friendsPrivate ? 'Your friends list is private.' : 'No friends found.'));
  $('friends').replaceChildren(...items);

  const chosen = state.friends.filter((f) => state.selected.has(f.steamid));
  $('selected-chips').replaceChildren(
    h('span', { class: 'chip' }, 'You'),
    ...chosen.map((f) => h('button', { class: 'chip', title: 'Remove', onclick: () => toggleFriend(f.steamid) }, `${f.name} ✕`)),
  );
}

function toggleFriend(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  store.set('selected', [...state.selected]);
  renderFriends();
}

// ---------- Picking ----------

function syncSlider() {
  const on = $('backlog').checked;
  $('novelty').disabled = !on;
  $('novelty-wrap').classList.toggle('disabled', !on);
}

async function pick() {
  showError('');
  $('pick').disabled = true;
  $('pick').textContent = 'Thinking…';
  try {
    const result = await api('/api/recommend', {
      members: [...state.selected],
      backlog: $('backlog').checked,
      novelty: Number($('novelty').value) / 100,
    });
    state.result = result;
    state.skipped = new Set();
    state.fetchedAtPick = result.metaStatus.fetched;
    renderGroupInfo();
    roll();
    watchStatus(result.metaStatus);
  } catch (e) {
    showError(e.message);
  } finally {
    $('pick').disabled = false;
    $('pick').textContent = 'Pick a game';
  }
}

// Weighted random choice among the top few, so repeat picks vary but stay good.
function sample(pool) {
  const top = pool.slice(0, 8);
  const best = top[0].score;
  const weights = top.map((g) => Math.exp((g.score - best) / 0.06));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i++) if ((r -= weights[i]) <= 0) return top[i];
  return top[0];
}

function roll() {
  const pool = state.result.ranked.filter((g) => !state.skipped.has(g.appid));
  if (!pool.length && state.skipped.size) {
    state.skipped = new Set();
    return roll();
  }
  state.current = pool.length ? sample(pool) : null;
  renderResult();
}

function reroll() {
  if (state.current) state.skipped.add(state.current.appid);
  roll();
}

async function hideGame(game) {
  try {
    const { hidden } = await api('/api/hide', { appid: game.appid, name: game.name, hidden: true });
    state.me.hidden = hidden;
    renderHidden();
    state.result.ranked = state.result.ranked.filter((g) => g.appid !== game.appid);
    roll();
  } catch (e) {
    showError(e.message);
  }
}

// ---------- Result rendering ----------

const FLAG_CHIPS = {
  recent: ['good', 'Played in the last 2 weeks'],
  backlog: ['', 'Sitting in your backlog'],
  newToAll: ['', 'New to everyone'],
  bounced: ['warn', 'Someone bounced off this before'],
  localOnly: ['warn', 'Local / split-screen only'],
  mpUnverified: ['warn', 'Multiplayer not confirmed yet'],
  unknownMeta: ['warn', 'Still learning about this game'],
};

function reasonChips(g) {
  const chips = [];
  if (g.tags.length) {
    const who = state.result.members.length > 1 ? 'Fits the group' : 'Fits your taste';
    chips.push(h('span', { class: 'chip tag' }, `${who}: ${g.tags.join(' · ')}`));
  }
  for (const f of g.flags) {
    const [cls, label] = FLAG_CHIPS[f] || [];
    if (label) chips.push(h('span', { class: `chip ${cls}` }, label));
  }
  if (g.quality !== null) chips.push(h('span', { class: `chip ${g.quality >= 85 ? 'good' : ''}` }, `${g.quality}% positive reviews`));
  return chips;
}

function hoursRow(g) {
  return g.hours.map((p) =>
    h('span', {},
      `${p.name} `,
      h('b', {}, !p.owns ? "doesn't own" : p.hours >= 0.5 ? `${formatHours(p.hours)}` : 'never played'),
      p.hours2w > 0 ? ` (${formatHours(p.hours2w)} lately)` : '',
    ),
  );
}

function formatHours(x) {
  return x >= 10 ? `${Math.round(x)}h` : `${x.toFixed(1)}h`;
}

function shortWhy(g) {
  if (g.flags.includes('recent')) return 'Played recently';
  const total = g.hours.reduce((a, p) => a + p.hours, 0);
  if (g.tags.length) return g.tags.join(' · ');
  if (total >= 0.5) return `${formatHours(total)} played between you`;
  return 'Unplayed';
}

function renderResult() {
  const r = state.result;
  const g = state.current;
  $('result').hidden = !g;
  $('empty').hidden = !!g;

  if (!g) {
    const group = r.members.length > 1;
    $('empty').replaceChildren(
      h('p', {}, group
        ? 'No multiplayer games that everyone owns matched these settings.'
        : 'Nothing matched these settings.'),
      $('backlog').checked ? null : h('p', {}, 'Try turning on "Include games nobody has played yet".'),
      r.analyzed < r.candidates ? h('p', {}, `Still analyzing ${r.candidates - r.analyzed} of ${r.candidates} shared games — try again in a bit.`) : null,
    );
    renderAlmost();
    $('almost-wrap').hidden = !r.almost.length;
    if (r.almost.length) {
      $('result').hidden = false;
      $('featured').hidden = true;
      $('runners').replaceChildren();
    }
    return;
  }

  $('featured').hidden = false;
  const group = r.members.length > 1;
  $('featured').replaceChildren(
    art(g),
    h('div', { class: 'body' },
      // Buttons come first so they sit in the same spot whatever the game's
      // name and reasons look like — rerolling is click, click, click.
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: reroll, title: 'Reroll (R)' }, '🎲 Reroll'),
        h('a', { class: 'btn go', href: `steam://run/${g.appid}` }, '▶ Launch'),
        h('a', { class: 'btn', href: `https://store.steampowered.com/app/${g.appid}`, target: '_blank', rel: 'noopener' }, 'Store page'),
        h('button', { class: 'btn', onclick: () => hideGame(g), title: 'Never suggest this again' }, 'Never suggest'),
      ),
      h('div', { class: 'eyebrow' }, group ? `Tonight's pick for ${r.members.length}` : "Tonight's pick"),
      h('h3', {}, g.name),
      h('div', { class: 'match' }, 'Taste match', h('div', { class: 'meter' }, h('div', { style: `width:${g.match}%` })), `${g.match}%`),
      h('div', { class: 'reasons' }, reasonChips(g)),
      h('div', { class: 'hours' }, hoursRow(g)),
    ),
  );

  const runners = r.ranked.filter((x) => x.appid !== g.appid).slice(0, 8);
  $('runners').replaceChildren(
    ...runners.map((x) =>
      h('button', { class: 'mini', onclick: () => { state.current = x; renderResult(); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
        art(x),
        h('div', { class: 'meta' }, h('div', { class: 'title' }, x.name), h('div', { class: 'why' }, shortWhy(x))),
      ),
    ),
  );
  renderAlmost();
}

function renderAlmost() {
  const list = state.result.almost;
  $('almost-wrap').hidden = !list.length;
  $('almost').replaceChildren(
    ...list.map((x) =>
      h('div', { class: 'almost-row card' },
        art(x),
        h('div', { class: 'info' },
          h('div', { class: 'title' }, x.name),
          h('div', { class: 'why' }, `${x.missing.join(', ')} ${x.missing.length > 1 ? "don't" : "doesn't"} own it`, x.tags.length ? ` · ${x.tags.join(' · ')}` : ''),
        ),
        h('a', { class: 'btn', href: `https://store.steampowered.com/app/${x.appid}`, target: '_blank', rel: 'noopener' }, 'Store'),
      ),
    ),
  );
}

function renderGroupInfo() {
  const r = state.result;
  const bits = [];
  if (r.members.length > 1) {
    bits.push(`${r.candidates} games owned by everyone`);
    if (r.groupTaste.length) bits.push(h('span', {}, ' · Group vibe: '), ...r.groupTaste.slice(0, 4).map((t) => h('span', { class: 'chip tag' }, t)));
  }
  if (r.hiddenLibraries.length) bits.push(h('span', { class: 'chip warn' }, `Can't see ${r.hiddenLibraries.join(', ')}'s library — not counted`));
  $('group-info').replaceChildren(...bits);
  $('group-info').hidden = !bits.length;
}

function renderHidden() {
  const list = state.me.hidden;
  $('hidden-wrap').hidden = !list.length;
  $('hidden-count').textContent = list.length;
  $('hidden-list').replaceChildren(
    ...list.map((g) =>
      h('li', {}, g.name,
        h('button', {
          class: 'link',
          onclick: async () => {
            const { hidden } = await api('/api/hide', { appid: g.appid, hidden: false });
            state.me.hidden = hidden;
            renderHidden();
          },
        }, 'Unhide'),
      ),
    ),
  );
}

// ---------- Background metadata progress ----------

function watchStatus(status) {
  clearTimeout(state.polling);
  const fresh = status.fetched - state.fetchedAtPick;
  const bar = $('status');
  if (status.pending > 0) {
    bar.hidden = false;
    bar.classList.remove('idle');
    $('status-text').textContent = `Looking up tags for ${status.pending} games — picks get smarter as this finishes`;
    $('refresh').hidden = fresh < 10;
    state.polling = setTimeout(async () => watchStatus(await api('/api/status').catch(() => status)), 3000);
  } else if (fresh > 0) {
    bar.hidden = false;
    bar.classList.add('idle');
    $('status-text').textContent = `Learned about ${fresh} more games.`;
    $('refresh').hidden = false;
  } else {
    bar.hidden = true;
  }
}

// ---------- Boot ----------

async function init() {
  $('backlog').checked = store.get('backlog', true);
  $('novelty').value = store.get('novelty', 40);
  syncSlider();
  $('backlog').addEventListener('change', () => { store.set('backlog', $('backlog').checked); syncSlider(); });
  $('novelty').addEventListener('change', () => store.set('novelty', Number($('novelty').value)));
  $('friend-search').addEventListener('input', renderFriends);
  $('pick').addEventListener('click', pick);
  $('refresh').addEventListener('click', () => { $('status').hidden = true; pick(); });
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('input, textarea')) return;
    if (state.current) reroll();
  });

  try {
    const [me, friends] = await Promise.all([api('/api/me'), api('/api/friends')]);
    state.me = me;
    state.friends = friends.friends;
    state.friendsPrivate = friends.private;
    const known = new Set(state.friends.map((f) => f.steamid));
    for (const id of state.selected) if (!known.has(id)) state.selected.delete(id);
    if (me.mode === 'demo') {
      $('mode-badge').textContent = 'Demo data — add your Steam API key to .env';
      $('mode-badge').hidden = false;
    }
    renderMe();
    renderFriends();
    renderHidden();
    pick();
  } catch (e) {
    showError(e.message);
  }
}

init();
