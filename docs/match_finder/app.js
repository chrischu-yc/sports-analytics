/**
 * app.js — StatsBomb Open Data Match Explorer
 *
 * Fetches JSON directly from the StatsBomb open-data GitHub repo (raw.githubusercontent.com)
 */

const BASE = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data';

// ── State ────────────────────────────────────────────────────────────
let state = {
  competitions: [],        // all competition+season rows
  matches: [],             // matches for selected comp+season
  events: [],              // events for selected match
  lineups: {},             // { teamName: [...players] }
  selectedComp: null,      // { competition_id, season_id, competition_name, season_name }
  selectedMatch: null,
  shotTeam: 'home',        // which team on shot map
};

// ── Helpers ──────────────────────────────────────────────────────────
async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.json();
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.toggle('active', tc.id === `tab-${name}`));
}

function toast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

function setBreadcrumb(crumbs) {
  // crumbs: [{ label, onclick }]
  const nav = document.getElementById('breadcrumb');
  nav.innerHTML = crumbs.map((c, i) =>
    i < crumbs.length - 1
      ? `<span class="crumb" data-i="${i}">${c.label}</span><span class="sep">›</span>`
      : `<span>${c.label}</span>`
  ).join('');
  nav.querySelectorAll('.crumb').forEach(el => {
    const i = parseInt(el.dataset.i);
    el.addEventListener('click', crumbs[i].onclick);
  });
}

function formatFormation(f) {
  if (!f) return '?';
  return String(f).split('').join('-');
}

// ── Step 1: Load competitions ────────────────────────────────────────
async function loadCompetitions() {
  showView('view-picker');
  setBreadcrumb([{ label: 'Home' }]);

  const grid = document.getElementById('comp-grid');
  grid.innerHTML = '<div class="loading-spinner"></div>';

  try {
    const comps = await fetchJSON(`${BASE}/competitions.json`);
    state.competitions = comps;

    // Group by competition
    const byComp = {};
    for (const c of comps) {
      if (!byComp[c.competition_id]) byComp[c.competition_id] = { name: c.competition_name, seasons: [] };
      byComp[c.competition_id].seasons.push(c);
    }

    grid.innerHTML = '';
    for (const [cid, comp] of Object.entries(byComp)) {
      const card = document.createElement('div');
      card.className = 'comp-card';
      card.innerHTML = `<h3>${comp.name}</h3>
        <div class="season-list">
          ${comp.seasons.map(s =>
            `<span class="season-pill" data-cid="${s.competition_id}" data-sid="${s.season_id}"
              data-cname="${s.competition_name}" data-sname="${s.season_name}">
              ${s.season_name}
            </span>`
          ).join('')}
        </div>`;
      grid.appendChild(card);
    }

    grid.addEventListener('click', e => {
      const pill = e.target.closest('.season-pill');
      if (!pill) return;
      state.selectedComp = {
        competition_id: parseInt(pill.dataset.cid),
        season_id:      parseInt(pill.dataset.sid),
        competition_name: pill.dataset.cname,
        season_name:    pill.dataset.sname,
      };
      loadMatches();
    });
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--red)">Failed to load competitions: ${err.message}</p>`;
  }
}

// ── Step 2: Load matches ─────────────────────────────────────────────
async function loadMatches() {
  const { competition_id, season_id, competition_name, season_name } = state.selectedComp;
  showView('view-matches');
  setBreadcrumb([
    { label: 'Home', onclick: loadCompetitions },
    { label: `${competition_name} — ${season_name}` },
  ]);

  document.getElementById('matches-title').textContent = `${competition_name} · ${season_name}`;
  const list = document.getElementById('match-list');
  list.innerHTML = '<div class="loading-spinner"></div>';
  document.getElementById('match-search').value = '';

  try {
    const matches = await fetchJSON(`${BASE}/matches/${competition_id}/${season_id}.json`);
    state.matches = matches;
    renderMatchList(matches);
  } catch (err) {
    list.innerHTML = `<p style="color:var(--red)">Failed to load matches: ${err.message}</p>`;
  }
}

function renderMatchList(matches) {
  const list = document.getElementById('match-list');
  list.innerHTML = '';
  if (!matches.length) {
    list.innerHTML = '<p style="color:var(--muted)">No matches found.</p>';
    return;
  }
  for (const m of matches) {
    const card = document.createElement('div');
    card.className = 'match-card';
    card.innerHTML = `
      <span class="match-team home">${m.home_team.home_team_name ?? m.home_team}</span>
      <span class="match-score">${m.home_score} – ${m.away_score}</span>
      <span class="match-team away">${m.away_team.away_team_name ?? m.away_team}</span>
      <span class="match-meta">${m.match_date}</span>`;
    card.addEventListener('click', () => loadMatchDetail(m));
    list.appendChild(card);
  }
}

// filter
document.getElementById('match-search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  const filtered = state.matches.filter(m => {
    const ht = (m.home_team.home_team_name ?? m.home_team).toLowerCase();
    const at = (m.away_team.away_team_name ?? m.away_team).toLowerCase();
    return ht.includes(q) || at.includes(q);
  });
  renderMatchList(filtered);
});

// random match
document.getElementById('btn-random').addEventListener('click', () => {
  if (!state.matches.length) return;
  const m = state.matches[Math.floor(Math.random() * state.matches.length)];
  loadMatchDetail(m);
});

// ── Step 3: Load match detail ────────────────────────────────────────
async function loadMatchDetail(match) {
  state.selectedMatch = match;

  const homeName = match.home_team.home_team_name ?? match.home_team;
  const awayName = match.away_team.away_team_name ?? match.away_team;
  const { competition_name, season_name } = state.selectedComp;

  showView('view-detail');
  setBreadcrumb([
    { label: 'Home', onclick: loadCompetitions },
    { label: `${competition_name} — ${season_name}`, onclick: loadMatches },
    { label: `${homeName} vs ${awayName}` },
  ]);

  // Header
  document.getElementById('match-header').innerHTML = `
    <div class="teams">${homeName} <span style="color:var(--muted);font-size:1rem">vs</span> ${awayName}</div>
    <div class="score-big">${match.home_score} – ${match.away_score}</div>
    <div class="info">${match.match_date} · ${competition_name} · ${season_name}
      · ${match.competition_stage?.name ?? ''} · Stadium: ${match.stadium?.name ?? 'Unknown'}</div>`;

  // Update shotmap labels
  document.getElementById('label-shotmap-home').textContent = homeName;
  document.getElementById('label-shotmap-away').textContent = awayName;
  document.getElementById('home-team-title').textContent = homeName;
  document.getElementById('away-team-title').textContent = awayName;

  // Reset to formations tab
  showTab('formations');

  // Loading indicators on canvases
  ['canvas-home', 'canvas-away', 'canvas-shotmap-home', 'canvas-shotmap-away',
   'canvas-passmap-home', 'canvas-passmap-away',
   'canvas-carrymap-home', 'canvas-carrymap-away',
   'canvas-passnet-home', 'canvas-passnet-away', 'canvas-xgplot'].forEach(id => {
    const c = document.getElementById(id);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#6b7280';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Loading…', c.width / 2, c.height / 2);
  });
  document.getElementById('xgplot-summary').innerHTML = '<div style="color:var(--muted)">Loading xG summary…</div>';

  try {
    const [eventsData, lineupsData] = await Promise.all([
      fetchJSON(`${BASE}/events/${match.match_id}.json`),
      fetchJSON(`${DATA_LINEUPS_URL(match.match_id)}`),
    ]);

    state.events = eventsData;
    state.lineups = buildLineups(lineupsData);

    renderFormations(homeName, awayName);
    renderBench(homeName, awayName);
    renderStats(homeName, awayName);
    renderShotmap();
    initPassmapDropdowns(homeName, awayName);
    renderPassmap();
    initCarrymapDropdowns(homeName, awayName);
    renderCarrymap();
    renderPassNetworks(homeName, awayName);
    renderXGPlot();



  } catch (err) {
    toast(`Error loading match data: ${err.message}`, 5000);
    console.error(err);
  }
}

function DATA_LINEUPS_URL(matchId) {
  return `${BASE}/lineups/${matchId}.json`;
}

// ── Build lineup objects ─────────────────────────────────────────────
function buildLineups(lineupsData) {
  const result = {};
  for (const team of lineupsData) {
    const players = team.lineup.map(p => {
      const positions = Array.isArray(p.positions) ? p.positions : [];
      const pos0 = positions[0] ?? {};
      const posL = positions[positions.length - 1] ?? {}; // last position = how they left
      return {
        player_name:   p.player_nickname || p.player_name,
        real_name:     p.player_name,   // always the real name, used to match events
        jersey_number: p.jersey_number,
        position:      pos0.position    ?? null,
        position_id:   pos0.position_id ?? null,
        start_reason:  pos0.start_reason ?? null,  // how they entered
        end_reason:    posL.end_reason   ?? null,  // how they left (last period)
      };
    });
    result[team.team_name] = players;
  }
  return result;
}

// ── Formations ───────────────────────────────────────────────────────
function getFormation(teamName) {
  const xi = state.events.find(e => e.type?.id === 35 && e.team?.name === teamName);
  if (!xi) return null;
  const f = xi.tactics?.formation;
  return f ? formatFormation(f) : null;
}

const TEAM_COLORS  = ['#e53e3e', '#60a5fa'];   // home=red, away=bright-blue
const GK_COLORS    = ['#d97706', '#7c3aed'];   // home=amber, away=purple

function renderFormations(homeName, awayName) {
  const teams = [homeName, awayName];
  const canvases = ['canvas-home', 'canvas-away'];

  teams.forEach((team, i) => {
    const lineup   = state.lineups[team] ?? [];
    const formation = getFormation(team);
    drawFormation(
      document.getElementById(canvases[i]),
      lineup,
      formation,
      TEAM_COLORS[i],
      GK_COLORS[i]
    );
  });
}

// ── Bench ────────────────────────────────────────────────────────────
function renderBench(homeName, awayName) {
  const section = document.getElementById('bench-section');
  section.innerHTML = '';

  [homeName, awayName].forEach((team, i) => {
    const lineup = state.lineups[team] ?? [];
    const bench  = lineup.filter(p => p.start_reason !== 'Starting XI');

    // Cross-reference substitution events for reliability
    // Type 19 = Substitution; e.player = subbed OFF, e.substitution.replacement = subbed ON
    const teamSubs = state.events.filter(e => e.type?.id === 19 && e.team?.name === team);
    const subbedOnSet  = new Set(teamSubs.map(e => e.substitution?.replacement?.name));
    const subbedOffSet = new Set(teamSubs.map(e => e.player?.name));

    const panel = document.createElement('div');
    panel.className = 'bench-panel';
    panel.innerHTML = `<h4>${team} — Substitutes</h4>`;

    if (!bench.length) {
      panel.innerHTML += '<p style="color:var(--muted);font-size:.85rem">No data</p>';
    } else {
      for (const p of bench) {
        const subbedOn  = subbedOnSet.has(p.real_name);
        const subbedOff = subbedOffSet.has(p.real_name);
        const row = document.createElement('div');
        row.className = 'bench-player';

        // Build substitution badge
        let subBadge = '';
        if (subbedOn && subbedOff) {
          subBadge = '<span class="sub-on-off">▲▼ on &amp; off</span>';
        } else if (subbedOn) {
          subBadge = '<span class="sub-on">▲ on</span>';
        } else if (subbedOff) {
          subBadge = '<span class="sub-off">▼ off</span>';
        }

        // Only show position for players who never came on (position is reliable for starters/unused subs)
        const posLabel = (!subbedOn && p.position)
          ? `<span style="color:var(--muted);font-size:.78rem;margin-left:.3rem">${p.position}</span>`
          : '';

        row.innerHTML = `
          <span class="jersey-num" style="background:${TEAM_COLORS[i]}">${p.jersey_number}</span>
          <span>${p.player_name}</span>
          ${posLabel}
          ${subBadge}`;
        panel.appendChild(row);
      }
    }
    section.appendChild(panel);
  });

  // Match ID footer
  const mid = state.selectedMatch?.match_id;
  if (mid) {
    const footer = document.createElement('p');
    footer.style.cssText = 'color:var(--muted);font-size:.75rem;margin-top:.5rem;text-align:center;grid-column:1/-1';
    footer.textContent = `StatsBomb match ID: ${mid}`;
    section.appendChild(footer);
  }
}

// ── Stats ────────────────────────────────────────────────────────────
function renderStats(homeName, awayName) {
  const ev = state.events;

  const count = (team, type) =>
    ev.filter(e => e.team?.name === team && e.type?.id === type).length;
  const countOutcome = (team, type, outcome) =>
    ev.filter(e => e.team?.name === team && e.type?.id === type &&
                   e[type === 16 ? 'shot' : 'pass']?.outcome?.name === outcome).length;
  const shots   = team => ev.filter(e => e.team?.name === team && e.type?.id === 16);
  const xg      = team => shots(team).reduce((s, e) => s + (e.shot?.statsbomb_xg ?? 0), 0);
  const goals   = team => shots(team).filter(e => e.shot?.outcome?.name === 'Goal').length;
  const passes  = team => ev.filter(e => e.team?.name === team && e.type?.id === 30);
  const pAcc    = team => { const p = passes(team); return p.length ? p.filter(e => e.pass?.outcome === undefined || e.pass?.outcome === null).length / p.length * 100 : 0; };

  const rows = [
    ['Goals',         goals(homeName),                   goals(awayName)],
    ['Shots',         shots(homeName).length,             shots(awayName).length],
    ['xG',            xg(homeName).toFixed(2),            xg(awayName).toFixed(2)],
    ['Passes',        passes(homeName).length,             passes(awayName).length],
    ['Pass Acc. %',   pAcc(homeName).toFixed(0) + '%',    pAcc(awayName).toFixed(0) + '%'],
    ['Dribbles',      count(homeName, 14),                count(awayName, 14)],
    ['Fouls',         count(homeName, 22),                count(awayName, 22)],
    ['Pressure',      count(homeName, 17),                count(awayName, 17)],
    ['Ball Recovery', count(homeName, 2),                 count(awayName, 2)],
    ['Clearances',    count(homeName, 9),                 count(awayName, 9)],
  ];

  const table = document.getElementById('stats-table');
  table.innerHTML = `
    <div class="stat-row" style="font-weight:700;border-bottom:2px solid var(--border)">
      <div class="stat-val-home" style="font-size:.9rem;color:var(--red)">${homeName}</div>
      <div class="stat-label">Stat</div>
      <div class="stat-val-away" style="font-size:.9rem;color:var(--blue)">${awayName}</div>
    </div>
    ${rows.map(([label, hv, av]) => {
      const hn = parseFloat(hv) || 0;
      const an = parseFloat(av) || 0;
      const total = hn + an || 1;
      const hPct = (hn / total * 50).toFixed(1);
      const aPct = (an / total * 50).toFixed(1);
      return `
        <div class="stat-row">
          <div class="stat-val-home" style="color:var(--red)">${hv}
            <div class="stat-bar-wrap" style="margin-top:4px"><div class="stat-bar-home" style="width:${hPct}%"></div></div>
          </div>
          <div class="stat-label">${label}</div>
          <div class="stat-val-away" style="color:var(--blue)">${av}
            <div class="stat-bar-wrap" style="margin-top:4px"><div class="stat-bar-away" style="width:${aPct}%"></div></div>
          </div>
        </div>`;
    }).join('')}`;
}

// ── Nickname lookup (real_name → display player_name) ───────────────
function buildNicknameLookup() {
  const map = {};
  for (const players of Object.values(state.lineups)) {
    for (const p of players) map[p.real_name] = p.player_name;
  }
  return map;
}

// ── Shot map ─────────────────────────────────────────────────────────
function renderShotmap() {
  const homeName = state.selectedMatch.home_team.home_team_name ?? state.selectedMatch.home_team;
  const awayName = state.selectedMatch.away_team.away_team_name ?? state.selectedMatch.away_team;

  const nicknames = buildNicknameLookup();

  const getShots = teamName => state.events.filter(
    e => e.team?.name === teamName && e.type?.id === 16
  ).map(e => ({
    location:          e.location,
    shot_outcome:      e.shot?.outcome?.name,
    shot_statsbomb_xg: e.shot?.statsbomb_xg,
    player:            nicknames[e.player?.name] ?? e.player?.name,
    minute:            e.minute,
  }));

  const attach = (canvasEl, result) => {
    canvasEl._shotHits = result.hits;
  };

  const homeCanvas = document.getElementById('canvas-shotmap-home');
  const awayCanvas = document.getElementById('canvas-shotmap-away');
  const homeResult = drawShotmap(homeCanvas, getShots(homeName));
  const awayResult = drawShotmap(awayCanvas, getShots(awayName));
  attach(homeCanvas, homeResult);
  attach(awayCanvas, awayResult);

  const legendEntries = homeResult.legendEntries;

  const legend = document.getElementById('shot-legend');
  legend.innerHTML = legendEntries.map(([label, style]) =>
    `<span class="legend-item">
      <span class="legend-dot" style="background:${style.color};border:1.5px solid ${style.stroke}"></span>
      ${label}
    </span>`
  ).join('') + `<span class="legend-item" style="margin-left:auto;color:var(--muted);font-size:.8rem">
    Circle size = xG
  </span>`;
}

// ── Shot tooltip ─────────────────────────────────────────────────────
(function setupShotTooltip() {
  const tooltip = document.getElementById('shot-tooltip');

  const onCanvasClick = (e) => {
    const canvas = e.currentTarget;
    const hits = canvas._shotHits;
    if (!hits) return;

    const rect  = canvas.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;

    // Pick the smallest circle containing the click — handles overlapping dots
    // so a tiny low-xG shot inside a larger one is always selectable.
    let hit = null;
    for (const h of hits) {
      const dist = Math.sqrt((mx - h.cx) ** 2 + (my - h.cy) ** 2);
      if (dist <= h.r + 2 && (!hit || h.r < hit.r)) hit = h;
    }

    if (!hit) { tooltip.classList.remove('visible'); return; }

    const s = hit.shot;
    const xg = s.shot_statsbomb_xg ? ` · xG ${s.shot_statsbomb_xg.toFixed(2)}` : '';
    const outcome = s.shot_outcome ? ` · ${s.shot_outcome}` : '';
    tooltip.textContent = `${s.player}, ${s.minute}'${outcome}${xg}`;

    // Position tooltip near the click, keeping it on-screen
    const scrollX = window.scrollX, scrollY = window.scrollY;
    let tx = e.clientX + scrollX + 12;
    let ty = e.clientY + scrollY - 36;
    tooltip.style.left = tx + 'px';
    tooltip.style.top  = ty + 'px';
    tooltip.classList.add('visible');
  };

  // Dismiss on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#canvas-shotmap-home, #canvas-shotmap-away')) {
      tooltip.classList.remove('visible');
    }
  });

  document.getElementById('canvas-shotmap-home').addEventListener('click', onCanvasClick);
  document.getElementById('canvas-shotmap-away').addEventListener('click', onCanvasClick);
})();

// ── Pass network node tooltip ─────────────────────────────────────────
(function setupPassNetTooltip() {
  const tooltip = document.getElementById('passnet-tooltip');

  const onCanvasClick = (e) => {
    const canvas = e.currentTarget;
    const result = canvas._passNetResult;
    if (!result || !result.hits) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Find the smallest circle containing the click (handles overlapping nodes —
    // the innermost/smallest hit is the most precisely targeted node).
    let hit = null;
    for (const h of result.hits) {
      const dist = Math.sqrt((mx - h.cx) ** 2 + (my - h.cy) ** 2);
      if (dist <= h.r + 4 && (!hit || h.r < hit.r)) hit = h;
    }

    if (!hit) { tooltip.classList.remove('visible'); return; }

    const node = result.nodes[hit.name];
    const displayName = node.display;

    // Gather all pairs this player is involved in, sorted by count
    const pairs = [];
    for (const [key, count] of Object.entries(result.edgeMap)) {
      const [a, b] = key.split('||');
      if (a === hit.name || b === hit.name) {
        const partnerName = a === hit.name ? b : a;
        const partnerDisplay = result.nodes[partnerName]?.display ?? partnerName;
        pairs.push({ partnerDisplay, count });
      }
    }
    pairs.sort((a, b) => b.count - a.count);
    const top3 = pairs.slice(0, 3);

    const pairsHtml = top3.length
      ? top3.map(p => `<div>\u21d4 ${p.partnerDisplay} &middot; ${p.count} passes</div>`).join('')
      : `<div style="color:var(--muted)">No frequent pairs</div>`;

    tooltip.innerHTML =
      `<strong>${displayName}</strong>` +
      `<div class="passnet-tooltip-sub">Top passing pairs:</div>` +
      pairsHtml;

    tooltip.style.left = (e.clientX + window.scrollX + 14) + 'px';
    tooltip.style.top  = (e.clientY + window.scrollY - 20) + 'px';
    tooltip.classList.add('visible');
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#canvas-passnet-home, #canvas-passnet-away')) {
      tooltip.classList.remove('visible');
    }
  });

  document.getElementById('canvas-passnet-home').addEventListener('click', onCanvasClick);
  document.getElementById('canvas-passnet-away').addEventListener('click', onCanvasClick);
})();

// ── Tab switching ────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});
// ── Logo → Home ──────────────────────────────────────────────────────
document.getElementById('logo').addEventListener('click', loadCompetitions);
// ── Competition search filter ───────────────────────────────────────────────
document.getElementById('comp-search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  document.querySelectorAll('#comp-grid .comp-card').forEach(card => {
    card.style.display = !q || card.dataset.compName.includes(q) ? '' : 'none';
  });
});
// ── Help modal ───────────────────────────────────────────────────────
(function setupHelpModal() {
  const modal = document.getElementById('help-modal');
  document.getElementById('btn-help').addEventListener('click', () => modal.classList.add('open'));
  document.getElementById('modal-close').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.remove('open'); });
})();
// ── Pass network ─────────────────────────────────────────────────────────
function renderPassNetworks(homeName, awayName) {
  document.getElementById('label-passnet-home').textContent = homeName;
  document.getElementById('label-passnet-away').textContent = awayName;

  const nicknames = buildNicknameLookup();

  const getNetworkPasses = teamName => {
    // Find first substitution event for this team
    const subEvents = state.events
      .filter(e => e.type?.id === 19 && e.team?.name === teamName)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    const firstSubEvent = subEvents[0] ?? null;
    const firstSubIdx   = firstSubEvent?.index ?? Infinity;

    // Attach first-sub info so renderStats can use it
    getNetworkPasses._firstSub = getNetworkPasses._firstSub ?? {};
    getNetworkPasses._firstSub[teamName] = firstSubEvent
      ? { minute: firstSubEvent.minute, period: firstSubEvent.period }
      : null;

    return state.events
      .filter(e =>
        e.type?.id === 30 &&
        e.team?.name === teamName &&
        (e.index ?? 0) < firstSubIdx &&
        !e.pass?.outcome   // successful passes only
      )
      .map(e => ({
        player:       e.player?.name,
        recipient:    e.pass?.recipient?.name,
        location:     e.location,
        end_location: e.pass?.end_location,
      }));
  };

  const firstSubInfo = {};
  const homePassesData = getNetworkPasses(homeName);
  firstSubInfo[homeName] = getNetworkPasses._firstSub?.[homeName] ?? null;
  const awayPassesData  = getNetworkPasses(awayName);
  firstSubInfo[awayName] = getNetworkPasses._firstSub?.[awayName] ?? null;

  const renderStats = (statsId, result, color, teamName) => {
    const ci  = result.centralisationIndex;
    const sub = firstSubInfo[teamName];
    const subHtml = sub
      ? `<div style="color:var(--muted);font-size:.78rem;margin-bottom:.3rem">
           Data up to <strong style="color:var(--text)">
           ${sub.minute}′
           </strong> &mdash; first substitution
         </div>`
      : `<div style="color:var(--muted);font-size:.78rem;margin-bottom:.3rem">No substitutions &mdash; full match data used</div>`;
    document.getElementById(statsId).innerHTML = subHtml + (ci !== null
      ? `Centralisation index: <span style="color:${color};font-weight:700">${ci.toFixed(3)}</span>
         <span style="color:var(--muted);font-size:.78rem">&nbsp;(0 = perfectly distributed, 1 = one player does everything)</span>`
      : `<span style="color:var(--muted)">No data</span>`);
  };

  const homeCanvas = document.getElementById('canvas-passnet-home');
  const awayCanvas = document.getElementById('canvas-passnet-away');
  const homeResult = drawPassNetwork(homeCanvas, homePassesData, TEAM_COLORS[0], nicknames);
  const awayResult = drawPassNetwork(awayCanvas, awayPassesData,  TEAM_COLORS[1], nicknames);
  homeCanvas._passNetResult = homeResult;
  awayCanvas._passNetResult = awayResult;

  renderStats('passnet-stats-home', homeResult, TEAM_COLORS[0], homeName);
  renderStats('passnet-stats-away', awayResult, TEAM_COLORS[1], awayName);
}// ── Pass map ─────────────────────────────────────────────────────────
function initPassmapDropdowns(homeName, awayName) {
  document.getElementById('label-passmap-home').textContent = homeName;
  document.getElementById('label-passmap-away').textContent = awayName;

  const nicknames = buildNicknameLookup();

  // Build set of players who actually made a pass in the match
  const passers = new Set(state.events
    .filter(e => e.type?.id === 30)
    .map(e => e.player?.name));

  const populate = (selectId, teamName) => {
    const players = (state.lineups[teamName] ?? [])
      .filter(p => passers.has(p.real_name));
    const sel = document.getElementById(selectId);
    sel.innerHTML = '';
    // "All players" sentinel option (value='' means no filter)
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = '— All players —';
    sel.appendChild(allOpt);
    for (const p of players) {
      const opt = document.createElement('option');
      opt.value = p.real_name;  // match against event player names
      opt.textContent = `${p.jersey_number}. ${p.player_name}`;
      sel.appendChild(opt);
    }
  };

  populate('select-passmap-home', homeName);
  populate('select-passmap-away', awayName);
}

function renderPassmap() {
  const homeName = state.selectedMatch.home_team.home_team_name ?? state.selectedMatch.home_team;
  const awayName = state.selectedMatch.away_team.away_team_name ?? state.selectedMatch.away_team;

  // Empty-string sentinel means "All players"; filter it out from player names
  const selectedValues = id => {
    const vals = Array.from(document.getElementById(id).selectedOptions).map(o => o.value);
    return vals.filter(v => v !== '');
  };

  const isAllSelected = id => {
    const opts = Array.from(document.getElementById(id).selectedOptions);
    return opts.length === 0 || opts.some(o => o.value === '');
  };

  const getPasses = (teamName, selectId) => {
    const playerFilter = isAllSelected(selectId) ? [] : selectedValues(selectId);
    return state.events
    .filter(e =>
      e.type?.id === 30 &&
      e.team?.name === teamName &&
      (playerFilter.length === 0 || playerFilter.includes(e.player?.name))
    )
    .map(e => ({
      location:     e.location,
      end_location: e.pass?.end_location,
      outcome:      e.pass?.outcome?.name ?? null,
    }));
  };

  const renderPassStats = (statsId, passes, selectId, color) => {
    const total = passes.length;
    const successful = passes.filter(p => !p.outcome).length;
    const acc = total ? (successful / total * 100).toFixed(1) : '—';

    const playerFilter = isAllSelected(selectId) ? [] : selectedValues(selectId);
    const nicknames = buildNicknameLookup();
    const label = playerFilter.length === 0
      ? 'Team'
      : playerFilter.length === 1
        ? (nicknames[playerFilter[0]] ?? playerFilter[0].split(' ').pop())
        : `${playerFilter.length} players`;

    document.getElementById(statsId).innerHTML =
      `<span style="color:${color};font-weight:600">${label}:</span> ` +
      `${successful} / ${total} passes &nbsp;·&nbsp; ` +
      `<span style="color:${color};font-weight:700">${acc}%</span> accuracy`;
  };

  drawPassmap(
    document.getElementById('canvas-passmap-home'),
    getPasses(homeName, 'select-passmap-home'),
    TEAM_COLORS[0]
  );
  renderPassStats('passmap-stats-home', getPasses(homeName, 'select-passmap-home'), 'select-passmap-home', TEAM_COLORS[0]);

  drawPassmap(
    document.getElementById('canvas-passmap-away'),
    getPasses(awayName, 'select-passmap-away'),
    TEAM_COLORS[1]
  );
  renderPassStats('passmap-stats-away', getPasses(awayName, 'select-passmap-away'), 'select-passmap-away', TEAM_COLORS[1]);
}

document.getElementById('select-passmap-home').addEventListener('change', renderPassmap);
document.getElementById('select-passmap-away').addEventListener('change', renderPassmap);

// ── Carry map ─────────────────────────────────────────────────────────
function initCarrymapDropdowns(homeName, awayName) {
  document.getElementById('label-carrymap-home').textContent = homeName;
  document.getElementById('label-carrymap-away').textContent = awayName;

  const nicknames = buildNicknameLookup();

  // Build set of players who actually made a carry
  const carriers = new Set(state.events
    .filter(e => e.type?.id === 43)
    .map(e => e.player?.name));

  const populate = (selectId, teamName) => {
    const players = (state.lineups[teamName] ?? [])
      .filter(p => carriers.has(p.real_name));
    const sel = document.getElementById(selectId);
    sel.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = '— All players —';
    sel.appendChild(allOpt);
    for (const p of players) {
      const opt = document.createElement('option');
      opt.value = p.real_name;
      opt.textContent = `${p.jersey_number}. ${p.player_name}`;
      sel.appendChild(opt);
    }
  };

  populate('select-carrymap-home', homeName);
  populate('select-carrymap-away', awayName);
}

function renderCarrymap() {
  const homeName = state.selectedMatch.home_team.home_team_name ?? state.selectedMatch.home_team;
  const awayName = state.selectedMatch.away_team.away_team_name ?? state.selectedMatch.away_team;

  const selectedValues = id => {
    const vals = Array.from(document.getElementById(id).selectedOptions).map(o => o.value);
    return vals.filter(v => v !== '');
  };
  const isAllSelected = id => {
    const opts = Array.from(document.getElementById(id).selectedOptions);
    return opts.length === 0 || opts.some(o => o.value === '');
  };

  const evByIdx = {};
  for (const e of state.events) evByIdx[e.index] = e;

  const getCarries = (teamName, selectId) => {
    const playerFilter = isAllSelected(selectId) ? [] : selectedValues(selectId);
    return state.events
      .filter(e =>
        e.type?.id === 43 &&
        e.team?.name === teamName &&
        (playerFilter.length === 0 || playerFilter.includes(e.player?.name))
      )
      .map(e => {
        const next  = evByIdx[e.index + 1];
        const ntype = next?.type?.id;
        let outcome;
        if      (ntype === 30)                outcome = 'pass';
        else if (ntype === 16)                outcome = 'shot';
        else if (ntype === 38 || ntype === 3) outcome = 'lost';
        else                                  outcome = 'other';
        return {
          location:     e.location,
          end_location: e.carry?.end_location,
          outcome,
        };
      });
  };

  const renderCarryStats = (statsId, carries, selectId, color) => {
    const validCarries = carries.filter(c => {
      if (!c.location || !c.end_location) return false;
      const [x1, y1] = c.location, [x2, y2] = c.end_location;
      return Math.hypot(x2 - x1, y2 - y1) >= 5;
    });
    const total = validCarries.length;

    const playerFilter = isAllSelected(selectId) ? [] : selectedValues(selectId);
    const nicknames = buildNicknameLookup();
    const label = playerFilter.length === 0
      ? 'Team'
      : playerFilter.length === 1
        ? (nicknames[playerFilter[0]] ?? playerFilter[0].split(' ').pop())
        : `${playerFilter.length} players`;

    const counts = { pass: 0, shot: 0, lost: 0, other: 0 };
    for (const c of validCarries) counts[c.outcome] = (counts[c.outcome] || 0) + 1;

    document.getElementById(statsId).innerHTML =
      `<span style="color:${color};font-weight:600">${label}:</span> ` +
      `<span style="color:#fff;font-weight:700">${total}</span> carries (≥5 units)` +
      ` &nbsp;&middot;&nbsp; ` +
      `<span style="color:#f97316">Pass ${counts.pass}</span> &middot; ` +
      `<span style="color:#eab308">Shot ${counts.shot}</span> &middot; ` +
      `<span style="color:#a855f7">Lost ${counts.lost}</span> &middot; ` +
      `<span style="color:#9ca3af">Other ${counts.other}</span>`;
  };

  drawCarrymap(
    document.getElementById('canvas-carrymap-home'),
    getCarries(homeName, 'select-carrymap-home'),
    TEAM_COLORS[0]
  );
  renderCarryStats('carrymap-stats-home', getCarries(homeName, 'select-carrymap-home'), 'select-carrymap-home', TEAM_COLORS[0]);

  drawCarrymap(
    document.getElementById('canvas-carrymap-away'),
    getCarries(awayName, 'select-carrymap-away'),
    TEAM_COLORS[1]
  );
  renderCarryStats('carrymap-stats-away', getCarries(awayName, 'select-carrymap-away'), 'select-carrymap-away', TEAM_COLORS[1]);
}

document.getElementById('select-carrymap-home').addEventListener('change', renderCarrymap);
document.getElementById('select-carrymap-away').addEventListener('change', renderCarrymap);

// ── xG Plot ──────────────────────────────────────────────────────────

function renderXGPlot() {
  const homeName = state.selectedMatch.home_team.home_team_name ?? state.selectedMatch.home_team;
  const awayName = state.selectedMatch.away_team.away_team_name ?? state.selectedMatch.away_team;

  // Extract shots data from events
  const shots = state.events.filter(e => e.type?.id === 16).sort((a, b) => {
    if (a.minute !== b.minute) return a.minute - b.minute;
    return (a.second || 0) - (b.second || 0);
  });

  // Build player nickname lookup (same as pass network)
  const nicknames = buildNicknameLookup();

  // Build team shot arrays with cumulative xG
  const homeShots = [];
  const awayShots = [];
  let homeXG = 0, awayXG = 0;

  for (const shot of shots) {
    const xg = shot.shot?.statsbomb_xg || 0;
    const isGoal = shot.shot?.outcome?.id === 97;
    const playerRealName = shot.player?.name || 'Unknown';
    const playerDisplay = nicknames[playerRealName] ?? playerRealName;

    if (shot.team?.name === homeName) {
      homeXG += xg;
      homeShots.push({
        minute: shot.minute + (shot.second || 0) / 60,
        cumXG: homeXG,
        xg,
        isGoal,
        player: playerRealName,
        playerDisplay,
      });
    } else if (shot.team?.name === awayName) {
      awayXG += xg;
      awayShots.push({
        minute: shot.minute + (shot.second || 0) / 60,
        cumXG: awayXG,
        xg,
        isGoal,
        player: playerRealName,
        playerDisplay,
      });
    }
  }

  // Calculate match duration
  const matchDuration = Math.max(...state.events.map(e => e.minute || 0), 90);

  // Use actual match score from state instead of counting goals
  const homeGoals = state.selectedMatch.home_score;
  const awayGoals = state.selectedMatch.away_score;

  // Calculate goal probabilities from xG values
  const homeXGList = homeShots.map(s => s.xg);
  const awayXGList = awayShots.map(s => s.xg);

  // PMF calculation: P(scoring exactly k goals)
  function calculateGoalPMF(xgValues) {
    let pmf = new Float64Array([1.0]);
    for (const p of xgValues) {
      const newPMF = new Float64Array(pmf.length + 1);
      for (let i = 0; i < pmf.length; i++) {
        newPMF[i] += pmf[i] * (1 - p);  // miss
        newPMF[i + 1] += pmf[i] * p;    // goal
      }
      pmf = newPMF;
    }
    return pmf;
  }

  const homePMF = calculateGoalPMF(homeXGList);
  const awayPMF = calculateGoalPMF(awayXGList);

  // Calculate win/draw/lose probabilities
  let homeWinProb = 0, drawProb = 0, awayWinProb = 0;

  // Draw: home score == away score
  for (let i = 0; i < Math.min(homePMF.length, awayPMF.length); i++) {
    drawProb += homePMF[i] * awayPMF[i];
  }

  // Home win: home score > away score
  for (let i = 0; i < homePMF.length; i++) {
    for (let j = 0; j < i && j < awayPMF.length; j++) {
      homeWinProb += homePMF[i] * awayPMF[j];
    }
  }

  // Away win: away score > home score
  for (let j = 0; j < awayPMF.length; j++) {
    for (let i = 0; i < j && i < homePMF.length; i++) {
      awayWinProb += homePMF[i] * awayPMF[j];
    }
  }

  // Render canvas
  drawXGPlot(
    document.getElementById('canvas-xgplot'),
    homeName,
    awayName,
    homeShots,
    awayShots,
    matchDuration
  );

  // Render summary
  renderXGSummary(
    'xgplot-summary',
    homeName,
    awayName,
    homeGoals,
    awayGoals,
    homeXG,
    awayXG,
    homeShots.length,
    awayShots.length,
    homeWinProb,
    drawProb,
    awayWinProb
  );
}

// ── Global random match (entire database) ──────────────────────────
async function loadRandomFromEntireDB() {
  const btn = document.getElementById('btn-random-global');
  btn.disabled = true;
  btn.textContent = '⏳ Loading…';

  try {
    // 1. Make sure competitions are loaded
    if (!state.competitions.length) {
      state.competitions = await fetchJSON(`${BASE}/competitions.json`);
    }

    // 2. Pick a random competition+season row
    const comp = state.competitions[Math.floor(Math.random() * state.competitions.length)];
    state.selectedComp = {
      competition_id:   comp.competition_id,
      season_id:        comp.season_id,
      competition_name: comp.competition_name,
      season_name:      comp.season_name,
    };

    // 3. Fetch that season's matches
    const matches = await fetchJSON(
      `${BASE}/matches/${comp.competition_id}/${comp.season_id}.json`
    );
    state.matches = matches;

    if (!matches.length) {
      toast('No matches found for that season — retrying…');
      btn.disabled = false;
      btn.textContent = '🎲 Random Match';
      return loadRandomFromEntireDB();  // try again
    }

    // 4. Pick a random match and go straight to detail
    const match = matches[Math.floor(Math.random() * matches.length)];
    const homeName = match.home_team.home_team_name ?? match.home_team;
    const awayName = match.away_team.away_team_name ?? match.away_team;
    toast(`🎲 ${comp.competition_name} ${comp.season_name}: ${homeName} vs ${awayName}`, 4000);
    await loadMatchDetail(match);

  } catch (err) {
    toast(`Error: ${err.message}`, 5000);
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = '🎲 Random Match';
  }
}

document.getElementById('btn-random-global').addEventListener('click', loadRandomFromEntireDB);

// ── Boot ─────────────────────────────────────────────────────────────
loadCompetitions();
