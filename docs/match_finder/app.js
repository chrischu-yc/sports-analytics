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
  setBreadcrumb([{ label: 'Competitions' }]);

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
    { label: 'Competitions', onclick: loadCompetitions },
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
    { label: 'Competitions', onclick: loadCompetitions },
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
  ['canvas-home', 'canvas-away', 'canvas-shotmap-home', 'canvas-shotmap-away'].forEach(id => {
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

const TEAM_COLORS  = ['#e53e3e', '#2b6cb0'];   // home=red, away=blue
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

    const panel = document.createElement('div');
    panel.className = 'bench-panel';
    panel.innerHTML = `<h4>${team} — Substitutes</h4>`;

    if (!bench.length) {
      panel.innerHTML += '<p style="color:var(--muted);font-size:.85rem">No data</p>';
    } else {
      for (const p of bench) {
        const subbedOn  = typeof p.start_reason === 'string' && p.start_reason.includes('Substitution');
        const subbedOff = typeof p.end_reason   === 'string' && p.end_reason.includes('Substitution');
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

// ── Shot map ─────────────────────────────────────────────────────────
function renderShotmap() {
  const homeName = state.selectedMatch.home_team.home_team_name ?? state.selectedMatch.home_team;
  const awayName = state.selectedMatch.away_team.away_team_name ?? state.selectedMatch.away_team;

  const getShots = teamName => state.events.filter(
    e => e.team?.name === teamName && e.type?.id === 16
  ).map(e => ({
    location:          e.location,
    shot_outcome:      e.shot?.outcome?.name,
    shot_statsbomb_xg: e.shot?.statsbomb_xg,
    player:            e.player?.name,
    minute:            e.minute,
  }));

  const legendEntries = drawShotmap(document.getElementById('canvas-shotmap-home'), getShots(homeName));
  drawShotmap(document.getElementById('canvas-shotmap-away'), getShots(awayName));

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

// ── Tab switching ────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

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
