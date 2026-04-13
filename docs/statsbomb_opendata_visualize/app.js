/**
 * app.js — StatsBomb Open Data Match Explorer
 *
 * Fetches JSON directly from the StatsBomb open-data GitHub repo (raw.githubusercontent.com)
 */

const BASE = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data';
const TEAM_SEASON_CACHE = new Map();
let compSearchToken = 0;
let compSearchDebounceTimer = null;
const THEME_STORAGE_KEY = 'sb_match_explorer_theme';

// ── State ────────────────────────────────────────────────────────────
let state = {
  competitions: [],        // all competition+season rows
  matches: [],             // matches for selected comp+season
  events: [],              // events for selected match
  eventsFull: [],          // full event list including period 5 (if present)
  shootoutEvents: [],      // period-5 events only
  hasShootout: false,
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

function applyTheme(theme) {
  const isLight = theme === 'light';
  document.body.classList.toggle('theme-light', isLight);

  const btn = document.getElementById('btn-theme-toggle');
  if (!btn) return;
  btn.textContent = isLight ? 'Use Dark Mode' : 'Use Light Mode';
  btn.setAttribute('aria-pressed', isLight ? 'true' : 'false');
}

function toggleTheme() {
  const nextTheme = document.body.classList.contains('theme-light') ? 'dark' : 'light';
  try {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch (_) {
    // Ignore storage issues and still toggle for this session.
  }
  applyTheme(nextTheme);
}

function initThemePreference() {
  let saved = 'dark';
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark') saved = value;
  } catch (_) {
    saved = 'dark';
  }
  applyTheme(saved);
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function extractMatchTeamName(match, side) {
  if (side === 'home') return match.home_team?.home_team_name ?? match.home_team ?? '';
  return match.away_team?.away_team_name ?? match.away_team ?? '';
}

function seasonCacheKey(competitionId, seasonId) {
  return `${competitionId}-${seasonId}`;
}

async function getSeasonTeamSet(competitionId, seasonId) {
  const key = seasonCacheKey(competitionId, seasonId);
  if (TEAM_SEASON_CACHE.has(key)) return TEAM_SEASON_CACHE.get(key);

  const matches = await fetchJSON(`${BASE}/matches/${competitionId}/${seasonId}.json`);
  const teams = new Set();
  for (const m of matches) {
    teams.add(normalizeSearchText(extractMatchTeamName(m, 'home')));
    teams.add(normalizeSearchText(extractMatchTeamName(m, 'away')));
  }
  TEAM_SEASON_CACHE.set(key, teams);
  return teams;
}

async function filterCompetitionsByTeamName(rawQuery) {
  const grid = document.getElementById('comp-grid');
  const statusEl = document.getElementById('comp-search-status');
  const cards = Array.from(grid.querySelectorAll('.comp-card'));
  const pills = Array.from(grid.querySelectorAll('.season-pill'));
  const query = normalizeSearchText(rawQuery);
  const token = ++compSearchToken;

  if (!query) {
    for (const card of cards) {
      card.style.display = '';
      for (const pill of card.querySelectorAll('.season-pill')) pill.style.display = '';
    }
    if (statusEl) statusEl.textContent = '';
    return;
  }

  if (statusEl) statusEl.textContent = 'Searching seasons for team...';

  const batchSize = 8;
  for (let i = 0; i < pills.length; i += batchSize) {
    const batch = pills.slice(i, i + batchSize);

    await Promise.all(batch.map(async (pill) => {
      const cid = Number(pill.dataset.cid);
      const sid = Number(pill.dataset.sid);
      let matched = false;
      try {
        const teamSet = await getSeasonTeamSet(cid, sid);
        for (const teamName of teamSet) {
          if (teamName.includes(query)) {
            matched = true;
            break;
          }
        }
      } catch (_) {
        matched = false;
      }
      pill.dataset.teamMatch = matched ? '1' : '0';
    }));

    if (token !== compSearchToken) return;
  }

  if (token !== compSearchToken) return;

  let matchedSeasons = 0;
  let matchedCompetitions = 0;
  for (const card of cards) {
    let hasVisibleSeason = false;
    const seasonPills = Array.from(card.querySelectorAll('.season-pill'));
    for (const pill of seasonPills) {
      const show = pill.dataset.teamMatch === '1';
      pill.style.display = show ? '' : 'none';
      if (show) {
        hasVisibleSeason = true;
        matchedSeasons++;
      }
    }
    card.style.display = hasVisibleSeason ? '' : 'none';
    if (hasVisibleSeason) matchedCompetitions++;
  }

  if (!statusEl) return;
  if (!matchedSeasons) {
    statusEl.textContent = 'No competitions/seasons found for that team.';
  } else {
    statusEl.textContent = `Found ${matchedSeasons} season(s) across ${matchedCompetitions} competition(s).`;
  }
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

function getShootoutScore(events, homeName, awayName) {
  const kicks = (events ?? []).filter(e => e.period === 5 && e.type?.id === 16);
  let homePK = 0;
  let awayPK = 0;
  for (const e of kicks) {
    if (e.shot?.outcome?.name !== 'Goal') continue;
    const team = e.team?.name;
    if (team === homeName) homePK++;
    if (team === awayName) awayPK++;
  }
  return { homePK, awayPK };
}

function renderMatchHeader(match, homeName, awayName, competitionName, seasonName, extraLabel = '') {
  const extraHtml = extraLabel
    ? ` <span style="color:var(--muted);font-size:1rem;font-weight:700">(${extraLabel})</span>`
    : '';

  document.getElementById('match-header').innerHTML = `
    <div class="teams">${homeName} <span style="color:var(--muted);font-size:1rem">vs</span> ${awayName}</div>
    <div class="score-big">${match.home_score} – ${match.away_score}${extraHtml}</div>
    <div class="info">${match.match_date} · ${competitionName} · ${seasonName}
      · ${match.competition_stage?.name ?? ''} · Stadium: ${match.stadium?.name ?? 'Unknown'}</div>`;
}

function formatFormation(f) {
  if (!f) return '?';
  return String(f).split('').join('-');
}

function classifyShotZone(location, shotType) {
  if (shotType === 'Penalty') return 'Penalty';
  if (!Array.isArray(location) || location.length < 2) return 'Unknown';
  let [x, y] = location;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Unknown';

  // Normalize to attacking half for consistent zone labels.
  if (x < 60) x = 120 - x;

  const inSixYard = x >= 114 && y >= 30 && y <= 50;
  if (inSixYard) return 'In 6-yard box';

  const inPenaltyBox = x >= 102 && y >= 18 && y <= 62;
  return inPenaltyBox ? 'Inside the box' : 'Outside the box';
}

function isOwnGoalAgainstEvent(e) {
  const t = (e?.type?.name ?? '').trim().toLowerCase();
  return t === 'own goal against';
}

function normalizeOwnGoalLocation(location) {
  if (!Array.isArray(location) || location.length < 2) return null;
  let [x, y] = location;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 60) x = 120 - x;
  return [Math.max(0, Math.min(120, x)), Math.max(0, Math.min(80, y))];
}

function getOwnGoalAgainstAttribution(e, homeName, awayName) {
  const concedingTeam = e?.team?.name;
  if (!concedingTeam) return null;
  const scoringTeam = concedingTeam === homeName
    ? awayName
    : (concedingTeam === awayName ? homeName : null);
  if (!scoringTeam) return null;
  return { scoringTeam, concedingTeam };
}

// ── Step 1: Load competitions ────────────────────────────────────────
async function loadCompetitions() {
  showView('view-picker');
  setBreadcrumb([{ label: 'Home' }]);

  const grid = document.getElementById('comp-grid');
  const searchInput = document.getElementById('comp-search');
  const statusEl = document.getElementById('comp-search-status');
  grid.innerHTML = '<div class="loading-spinner"></div>';

  if (searchInput) searchInput.value = '';
  if (statusEl) statusEl.textContent = '';

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
      card.dataset.compName = normalizeSearchText(comp.name);
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

    if (!grid.dataset.boundSeasonClick) {
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
      grid.dataset.boundSeasonClick = '1';
    }
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
  const sortedMatches = [...matches].sort((a, b) => {
    const aTs = Date.parse(a.match_date || '') || 0;
    const bTs = Date.parse(b.match_date || '') || 0;
    if (bTs !== aTs) return bTs - aTs; // newer matches first

    const aId = Number(a.match_id) || 0;
    const bId = Number(b.match_id) || 0;
    return bId - aId;
  });

  for (const m of sortedMatches) {
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

  // Header (initial; enriched after events load if AET/PK applies)
  renderMatchHeader(match, homeName, awayName, competition_name, season_name);

  // Update shotmap labels
  document.getElementById('label-shotmap-home').textContent = homeName;
  document.getElementById('label-shotmap-away').textContent = awayName;
  document.getElementById('home-team-title').textContent = homeName;
  document.getElementById('away-team-title').textContent = awayName;

  // Reset shootout visibility until we know this match has period-5 events.
  setShootoutTabVisible(false);
  document.getElementById('shootout-content').innerHTML = '';

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

    state.eventsFull = eventsData;
    state.hasShootout = eventsData.some(e => e.period === 5);
    state.shootoutEvents = state.hasShootout
      ? eventsData.filter(e => e.period === 5)
      : [];
    // For all existing analysis tabs, ignore period 5 and use only up to period 4.
    state.events = state.hasShootout
      ? eventsData.filter(e => (e.period ?? 0) < 5)
      : eventsData;

    const hasAET = eventsData.some(e => e.period === 3 || e.period === 4);
    const { homePK, awayPK } = getShootoutScore(eventsData, homeName, awayName);
    const flags = [];
    if (hasAET) flags.push('AET');
    if (state.hasShootout) flags.push(`PK ${homePK}-${awayPK}`);
    renderMatchHeader(match, homeName, awayName, competition_name, season_name, flags.join(', '));

    state.lineups = buildLineups(lineupsData);
    setShootoutTabVisible(state.hasShootout);

    renderFormations(homeName, awayName);
    renderBench(homeName, awayName);
    renderStats(homeName, awayName);
    renderShotmap();
    initPassmapDropdowns(homeName, awayName);
    renderPassmap();
    initCarrymapDropdowns(homeName, awayName);
    renderCarrymap();
    initPlayerCardDropdowns(homeName, awayName);
    renderPlayerCards();
    renderPassNetworks(homeName, awayName);
    renderXGPlot();
    if (state.hasShootout) renderShootoutTab(homeName, awayName);



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

function getTeamStarterRatingInfo(teamName) {
  const lineup = state.lineups[teamName] ?? [];
  const starters = lineup.filter(p => p.start_reason === 'Starting XI');
  const ratings = {};
  const ratingColors = {};

  if (!starters.length) {
    return { ratings, ratingColors, average: null };
  }

  const eventsByPlayer = new Map();
  for (const e of state.events) {
    if (e.team?.name !== teamName) continue;
    const playerName = e.player?.name;
    if (!playerName) continue;
    if (!eventsByPlayer.has(playerName)) eventsByPlayer.set(playerName, []);
    eventsByPlayer.get(playerName).push(e);
  }

  const ratingValues = [];
  for (const starter of starters) {
    const playerEvents = eventsByPlayer.get(starter.real_name) ?? [];
    const rating = perfComputeEventBasedRating(playerEvents, starter.position).eventRating;
    if (!Number.isFinite(rating)) continue;
    const gradeColor = inferPlayerCardGrade(rating).color;

    ratings[starter.real_name] = rating;
    ratings[starter.player_name] = rating;
    ratingColors[starter.real_name] = gradeColor;
    ratingColors[starter.player_name] = gradeColor;
    ratingValues.push(rating);
  }

  const average = ratingValues.length
    ? ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length
    : null;

  return { ratings, ratingColors, average };
}

function formatRatingDisplay(value) {
  return Number.isFinite(value) ? value.toFixed(2) : 'N/A';
}

function renderFormationAverageRatings(homeName, awayName, homeAverage, awayAverage) {
  const summaryEl = document.getElementById('formation-rating-summary');
  if (!summaryEl) return;
  const homeAvgColor = Number.isFinite(homeAverage) ? inferPlayerCardGrade(homeAverage).color : 'var(--muted)';
  const awayAvgColor = Number.isFinite(awayAverage) ? inferPlayerCardGrade(awayAverage).color : 'var(--muted)';

  summaryEl.innerHTML = `
    <div class="formation-rating-chip">
      <span class="formation-rating-team"><span class="formation-rating-dot" style="background:${TEAM_COLORS[0]}"></span>${homeName}</span>
      <span class="formation-rating-value">Starting XI Avg:
        <strong style="color:${homeAvgColor};font-weight:800">${formatRatingDisplay(homeAverage)}</strong>
      </span>
    </div>
    <div class="formation-rating-chip">
      <span class="formation-rating-team"><span class="formation-rating-dot" style="background:${TEAM_COLORS[1]}"></span>${awayName}</span>
      <span class="formation-rating-value">Starting XI Avg:
        <strong style="color:${awayAvgColor};font-weight:800">${formatRatingDisplay(awayAverage)}</strong>
      </span>
    </div>`;
}

function renderFormations(homeName, awayName) {
  const teams = [homeName, awayName];
  const canvases = ['canvas-home', 'canvas-away'];
  const teamRatingInfos = teams.map(team => getTeamStarterRatingInfo(team));

  teams.forEach((team, i) => {
    const lineup   = state.lineups[team] ?? [];
    const formation = getFormation(team);
    drawFormation(
      document.getElementById(canvases[i]),
      lineup,
      formation,
      TEAM_COLORS[i],
      GK_COLORS[i],
      teamRatingInfos[i].ratings,
      teamRatingInfos[i].ratingColors
    );
  });

  renderFormationAverageRatings(
    homeName,
    awayName,
    teamRatingInfos[0]?.average ?? null,
    teamRatingInfos[1]?.average ?? null
  );
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
  const ownGoalAgainstEvents = ev.filter(isOwnGoalAgainstEvent);

  const count = (team, type) =>
    ev.filter(e => e.team?.name === team && e.type?.id === type).length;
  const countOutcome = (team, type, outcome) =>
    ev.filter(e => e.team?.name === team && e.type?.id === type &&
                   e[type === 16 ? 'shot' : 'pass']?.outcome?.name === outcome).length;
  const shots   = team => ev.filter(e => e.team?.name === team && e.type?.id === 16);
  const ownGoalsAgainst = team => ownGoalAgainstEvents
    .map(e => getOwnGoalAgainstAttribution(e, homeName, awayName))
    .filter(a => a && a.concedingTeam === team)
    .length;
  const xg      = team => shots(team).reduce((s, e) => s + (e.shot?.statsbomb_xg ?? 0), 0);
  const goals   = team => shots(team).filter(e => e.shot?.outcome?.name === 'Goal').length;
  const passes  = team => ev.filter(e => e.team?.name === team && e.type?.id === 30);
  const pAcc    = team => { const p = passes(team); return p.length ? p.filter(e => e.pass?.outcome === undefined || e.pass?.outcome === null).length / p.length * 100 : 0; };

  const rows = [
    ['Goals',         goals(homeName),                   goals(awayName)],
    ['Own Goals', ownGoalsAgainst(homeName),   ownGoalsAgainst(awayName)],
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
  const ownGoalAgainstEvents = state.events.filter(isOwnGoalAgainstEvent);

  const nicknames = buildNicknameLookup();

  const getShots = teamName => {
    const regularShots = state.events
      .filter(e => e.team?.name === teamName && e.type?.id === 16)
      .map(e => {
        const shotType = e.shot?.type?.name ?? 'Unknown';
        const location = Array.isArray(e.location) ? e.location : null;
        return {
          location,
          shot_outcome:      e.shot?.outcome?.name,
          shot_statsbomb_xg: e.shot?.statsbomb_xg,
          player:            nicknames[e.player?.name] ?? e.player?.name,
          minute:            e.minute,
          shot_zone:         classifyShotZone(location, shotType),
          is_own_goal:       false,
          _second:           e.second ?? 0,
          _index:            e.index ?? 0,
        };
      });

    const ownGoalEvents = ownGoalAgainstEvents
      .map(e => {
        const attrib = getOwnGoalAgainstAttribution(e, homeName, awayName);
        if (!attrib || attrib.scoringTeam !== teamName) return null;
        const location = normalizeOwnGoalLocation(e.location);
        return {
          location,
          shot_outcome:      'Own Goal',
          shot_statsbomb_xg: 0,
          player:            nicknames[e.player?.name] ?? e.player?.name ?? 'Unknown',
          minute:            e.minute,
          shot_zone:         classifyShotZone(location, 'Own Goal'),
          is_own_goal:       true,
          _second:           e.second ?? 0,
          _index:            e.index ?? 0,
        };
      })
      .filter(Boolean);

    return [...regularShots, ...ownGoalEvents]
      .sort((a, b) => (a.minute - b.minute) || (a._second - b._second) || (a._index - b._index));
  };

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
    const minute = Number.isFinite(s.minute) ? Math.floor(s.minute) : s.minute;
    const outcome = s.shot_outcome ? ` · ${s.shot_outcome}` : '';
    const xg = (s.shot_statsbomb_xg ?? 0) > 0 ? ` · xG ${s.shot_statsbomb_xg.toFixed(2)}` : '';
    const og = s.is_own_goal ? ' (OG)' : '';
    tooltip.textContent = `${s.player}${og}, ${minute}'${outcome}${xg}`;

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

// ── xG goal tooltip ───────────────────────────────────────────────
(function setupXGGoalTooltip() {
  const tooltip = document.getElementById('xg-tooltip');
  const canvas = document.getElementById('canvas-xgplot');
  if (!tooltip || !canvas) return;

  canvas.addEventListener('click', (e) => {
    const hits = canvas._xgGoalHits;
    if (!hits || !hits.length) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let hit = null;
    for (const h of hits) {
      const dist = Math.sqrt((mx - h.cx) ** 2 + (my - h.cy) ** 2);
      if (dist <= h.r + 2 && (!hit || h.r < hit.r)) hit = h;
    }

    if (!hit) { tooltip.classList.remove('visible'); return; }

    const s = hit.shot;
    const minute = Number.isFinite(s.minute) ? String(Math.floor(s.minute)) : 'Unknown';
    const xg = Number.isFinite(s.xg) ? s.xg.toFixed(3) : 'Unknown';

    tooltip.innerHTML =
      `<strong>${s.playerDisplay ?? s.player ?? 'Unknown'}</strong>` +
      `<div class="xg-tooltip-sub">${s.team ?? 'Unknown Team'}</div>` +
      `<div>${minute}' &middot; ${s.outcome ?? 'Unknown'}</div>` +
      `<div>Phase: <strong>${s.phase ?? 'Unknown'}</strong></div>` +
      `<div>Play pattern: ${s.playPattern ?? 'Unknown'}</div>` +
      `<div>Shot type: ${s.shotType ?? 'Unknown'}</div>` +
      `<div>Shot zone: ${s.shotZone ?? 'Unknown'}</div>` +
      `<div>xG: ${xg}</div>`;

    tooltip.style.left = (e.clientX + window.scrollX + 14) + 'px';
    tooltip.style.top = (e.clientY + window.scrollY - 20) + 'px';
    tooltip.classList.add('visible');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#canvas-xgplot')) tooltip.classList.remove('visible');
  });
})();

// ── Tab switching ────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});
// ── Logo → Home ──────────────────────────────────────────────────────
document.getElementById('logo').addEventListener('click', loadCompetitions);
// ── Team search on home page ───────────────────────────────────────────────
document.getElementById('comp-search').addEventListener('input', e => {
  const value = e.target.value;
  if (compSearchDebounceTimer) clearTimeout(compSearchDebounceTimer);
  compSearchDebounceTimer = setTimeout(() => {
    filterCompetitionsByTeamName(value);
  }, 220);
});
// ── Help modal ───────────────────────────────────────────────────────
(function setupHelpModal() {
  const modal = document.getElementById('help-modal');
  const themeBtn = document.getElementById('btn-theme-toggle');
  document.getElementById('btn-help').addEventListener('click', () => modal.classList.add('open'));
  document.getElementById('modal-close').addEventListener('click', () => modal.classList.remove('open'));
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
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

// ── Player performance cards ────────────────────────────────────────
const PERF_SUCCESS_DUEL_OUTCOMES = new Set(['Won', 'Success', 'Success In Play', 'Success Out']);

function inferPlayerCardGrade(rating) {
  if (rating >= 8.5) return { grade: 'A+', color: '#0b851b' };
  if (rating >= 8.0) return { grade: 'A',  color: '#3eba4e' };
  if (rating >= 7.5) return { grade: 'B+', color: '#baf72b' };
  if (rating >= 7.0) return { grade: 'B',  color: '#d8f72b' };
  if (rating >= 6.5) return { grade: 'C+', color: '#fcef40' };
  if (rating >= 6.0) return { grade: 'C',  color: '#f7e62b' };
  if (rating >= 5.5) return { grade: 'D+', color: '#f7c72b' };
  if (rating >= 5.0) return { grade: 'D',  color: '#f78e2b' };
  return { grade: 'F', color: '#f72b2b' };
}

function getMatchDurationMinute() {
  const regulationEvents = state.events.filter(e => Number(e.period ?? 0) !== 5);
  return Math.max(...regulationEvents.map(e => e.minute || 0), 90);
}

function computePassLength(passEvent) {
  const loc = passEvent.location;
  const end = passEvent.pass?.end_location;
  if (!Array.isArray(loc) || !Array.isArray(end)) return 0;
  const dx = end[0] - loc[0];
  const dy = end[1] - loc[1];
  return Math.sqrt(dx * dx + dy * dy);
}

const PERF_LONG_PASS_THRESHOLD = 30.0;
const PERF_SWITCH_LATERAL_THRESHOLD = 24.0;
const PERF_PASS_POSITIVE_WEIGHTS = {
  shot_assist: 0.40,
  goal_assist: 1.20,
  into_final_third: 0.12,
  into_penalty_area: 0.05,
  long_pass: 0.07,
  switch_long_pass: 0.03,
  under_pressure: 0.03,
};
const PERF_PASS_MISPLACED_PENALTY_BY_START_AREA = {
  own_box: 0.40,
  own_third: 0.10,
  middle_third: 0.07,
  final_third: 0.02,
  opposition_box: 0.02,
  anywhere: 0.20,
};
const PERF_SHOT_OUTCOME_GROUPS = {
  goal: new Set(['Goal']),
  saved: new Set(['Saved', 'Saved To Post', 'Saved Off T', 'Saved to Post']),
  blocked_or_off_target: new Set(['Blocked', 'Off T', 'Post']),
  wayward: new Set(['Wayward']),
};
const PERF_BY_AREA_GAIN_BACK_HEAVY = {
  own_box: 0.40,
  own_third: 0.27,
  middle_third: 0.15,
  final_third: 0.05,
  opposition_box: 0.05,
  anywhere: 0.10,
};
const PERF_CLEARANCE_REWARD_BY_AREA = { own_box: 0.10, own_third: 0.04 };
const PERF_BLOCK_REWARD_BY_AREA = {
  own_box: 0.15,
  own_third: 0.08,
  middle_third: 0.04,
  final_third: 0.01,
};
const PERF_BY_AREA_GAIN_FRONT_HEAVY = {
  own_box: 0.01,
  own_third: 0.03,
  middle_third: 0.05,
  final_third: 0.10,
  opposition_box: 0.40,
  anywhere: 0.10,
};
const PERF_TACKLE_AREA_MULTIPLIER = {
  opposition_box: 1.2,
  final_third: 1.2,
  middle_third: 1.0,
  own_third: 1.2,
  own_box: 1.4,
  anywhere: 1.0,
};

function perfClassifyPitchArea(location) {
  if (!Array.isArray(location) || location.length < 2) return 'anywhere';
  const [x, y] = location;
  if (x <= 18 && y >= 18 && y <= 62) return 'own_box';
  if (x >= 102 && y >= 18 && y <= 62) return 'opposition_box';
  if (x < 40) return 'own_third';
  if (x < 80) return 'middle_third';
  return 'final_third';
}

function perfClassifyGoalkeepingActionArea(location) {
  if (!Array.isArray(location) || location.length < 2) return 'anywhere';
  const [x, y] = location;
  if (x <= 6 && y >= 30 && y <= 50) return 'six_yard_box';
  if (x <= 18 && y >= 18 && y <= 62) return 'box';
  return 'outside_box';
}

function perfIsInPenaltyArea(location) {
  if (!Array.isArray(location) || location.length < 2) return false;
  const [x, y] = location;
  return x >= 102 && y >= 18 && y <= 62;
}

function perfToFloatXG(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0.0;
}

function perfGetPassLength(eventRow) {
  const rawLength = eventRow.pass?.length;
  if (Number.isFinite(rawLength)) return rawLength;

  const start = eventRow.location;
  const end = eventRow.pass?.end_location;
  if (Array.isArray(start) && Array.isArray(end) && start.length >= 2 && end.length >= 2) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    return Math.sqrt(dx * dx + dy * dy);
  }
  return 0.0;
}

function perfComputePassImpact(eventRow) {
  const startLoc = eventRow.location;
  const endLoc = eventRow.pass?.end_location;
  const startArea = perfClassifyPitchArea(startLoc);
  const endArea = perfClassifyPitchArea(endLoc);
  const passLength = perfGetPassLength(eventRow);

  const passOutcome = eventRow.pass?.outcome?.name;
  const complete = !passOutcome;
  const incomplete = passOutcome === 'Incomplete';
  const outPass = passOutcome === 'Out';

  if (incomplete || outPass) {
    const penalty = PERF_PASS_MISPLACED_PENALTY_BY_START_AREA[startArea] ?? PERF_PASS_MISPLACED_PENALTY_BY_START_AREA.anywhere;
    const outcomeLabel = outPass ? 'out' : 'incomplete';
    return { impact: -penalty, areaLabel: `${startArea}->${endArea}`, outcomeLabel };
  }

  if (!complete) return { impact: 0.0, areaLabel: `${startArea}->${endArea}`, outcomeLabel: 'pass_other' };

  let impact = 0.0;
  const components = [];
  const isShotAssist = eventRow.pass?.shot_assist === true;
  const isGoalAssist = eventRow.pass?.goal_assist === true;

  if (isShotAssist && !isGoalAssist) {
    components.push('shot_assist');
    impact += PERF_PASS_POSITIVE_WEIGHTS.shot_assist;
  }
  if (isGoalAssist) {
    components.push('goal_assist');
    impact += PERF_PASS_POSITIVE_WEIGHTS.goal_assist;
  }

  const intoFinalThird =
    (endArea === 'final_third' || endArea === 'opposition_box') &&
    !(startArea === 'final_third' || startArea === 'opposition_box');
  if (intoFinalThird) {
    components.push('into_final_third');
    impact += PERF_PASS_POSITIVE_WEIGHTS.into_final_third;
  }

  const intoPenaltyArea = perfIsInPenaltyArea(endLoc) && !perfIsInPenaltyArea(startLoc);
  if (intoPenaltyArea) {
    components.push('into_penalty_area');
    impact += PERF_PASS_POSITIVE_WEIGHTS.into_penalty_area;
  }

  let passProgressX = null;
  let passProgressY = null;
  if (Array.isArray(startLoc) && Array.isArray(endLoc)) {
    passProgressX = endLoc[0] - startLoc[0];
    passProgressY = endLoc[1] - startLoc[1];
  }

  if (passLength >= PERF_LONG_PASS_THRESHOLD) {
    const endsInFinalZone = endArea === 'final_third' || endArea === 'opposition_box';
    const isForwardOrSideways = passProgressX === null || passProgressX >= 0;
    if (endsInFinalZone || isForwardOrSideways) {
      components.push('long_pass');
      impact += PERF_PASS_POSITIVE_WEIGHTS.long_pass;
    }

    const isSwitch = passProgressY !== null && Math.abs(passProgressY) >= PERF_SWITCH_LATERAL_THRESHOLD;
    if (isSwitch) {
      components.push('switch_long_pass');
      impact += PERF_PASS_POSITIVE_WEIGHTS.switch_long_pass;
    }
  }

  if (eventRow.under_pressure === true) {
    components.push('under_pressure');
    impact += PERF_PASS_POSITIVE_WEIGHTS.under_pressure;
  }

  const outcomeLabel = impact === 0 ? 'complete_neutral' : `complete_${components.join('+')}`;
  return { impact, areaLabel: `${startArea}->${endArea}`, outcomeLabel };
}

function perfComputeGoalkeeperPassImpact(eventRow) {
  const startArea = perfClassifyPitchArea(eventRow.location);
  const endArea = perfClassifyPitchArea(eventRow.pass?.end_location);

  const passOutcome = eventRow.pass?.outcome?.name;
  const complete = !passOutcome;
  const incomplete = passOutcome === 'Incomplete';
  const outPass = passOutcome === 'Out';
  const isGoalKick = eventRow.pass?.type?.name === 'Goal Kick';

  let impact = 0.0;
  if (eventRow.pass?.shot_assist === true) impact += PERF_PASS_POSITIVE_WEIGHTS.shot_assist;
  if (eventRow.pass?.goal_assist === true) impact += PERF_PASS_POSITIVE_WEIGHTS.goal_assist;

  const resolveByEndArea = (prefix) => {
    if (endArea === 'final_third' || endArea === 'opposition_box') {
      if (complete) return { impact: impact + 0.08, label: `${prefix}_long_complete` };
      if (incomplete || outPass) return { impact: impact - 0.005, label: `${prefix}_long_incomplete` };
      return { impact, label: `${prefix}_long_neutral` };
    }
    if (endArea === 'middle_third') {
      if (complete) return { impact: impact + 0.04, label: `${prefix}_mid_complete` };
      if (incomplete || outPass) return { impact: impact - 0.01, label: `${prefix}_mid_incomplete` };
      return { impact, label: `${prefix}_mid_neutral` };
    }
    if (endArea === 'own_third' || endArea === 'own_box') {
      if (complete) return { impact: impact + 0.005, label: `${prefix}_short_complete` };
      if (incomplete || outPass) return { impact: impact - 0.02, label: `${prefix}_short_incomplete` };
      return { impact, label: `${prefix}_short_neutral` };
    }
    return { impact, label: `${prefix}_neutral` };
  };

  const resolved = resolveByEndArea(isGoalKick ? 'goalkick' : 'pass');
  return { impact: resolved.impact, areaLabel: `${startArea}->${endArea}`, outcomeLabel: resolved.label };
}

function perfClassifyShotOutcome(shotOutcome) {
  if (PERF_SHOT_OUTCOME_GROUPS.goal.has(shotOutcome)) return 'goal';
  if (PERF_SHOT_OUTCOME_GROUPS.saved.has(shotOutcome)) return 'saved';
  if (PERF_SHOT_OUTCOME_GROUPS.blocked_or_off_target.has(shotOutcome)) return 'blocked_or_off_target';
  if (PERF_SHOT_OUTCOME_GROUPS.wayward.has(shotOutcome)) return 'wayward';
  return 'blocked_or_off_target';
}

function perfComputeShotImpact(eventRow) {
  const shotOutcome = eventRow.shot?.outcome?.name;
  const shotType = eventRow.shot?.type?.name;
  const shotTypeLabel = String(shotType ?? 'unspecified').trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  const xg = Math.max(0.0, Math.min(perfToFloatXG(eventRow.shot?.statsbomb_xg), 1.5));
  const isOpenGoal = eventRow.shot?.open_goal === true;
  const outcomeGroup = perfClassifyShotOutcome(shotOutcome);

  if (outcomeGroup === 'goal') {
    const lowXgBoost = Math.max(0.0, 0.7 - xg) * 0.9;
    const openGoalAdj = isOpenGoal ? -0.50 : 0.10;
    return { impact: 1.2 + lowXgBoost + openGoalAdj, areaLabel: 'anywhere', outcomeLabel: `goal__${shotTypeLabel}` };
  }
  if (shotType === 'Penalty') {
    return { impact: -1.20, areaLabel: 'anywhere', outcomeLabel: `missed_penalty__${shotTypeLabel}` };
  }
  if (isOpenGoal) {
    return { impact: -(0.70 * xg), areaLabel: 'anywhere', outcomeLabel: `open_goal_miss__${shotTypeLabel}` };
  }
  if (outcomeGroup === 'saved') {
    return { impact: 0.05 + 0.50 * xg, areaLabel: 'anywhere', outcomeLabel: `saved__${shotTypeLabel}` };
  }
  if (outcomeGroup === 'blocked_or_off_target') {
    return { impact: Math.max(0.05, 0.30 - 0.20 * xg), areaLabel: 'anywhere', outcomeLabel: `blocked_or_off_target__${shotTypeLabel}` };
  }
  return { impact: -(0.15 + 0.30 * xg), areaLabel: 'anywhere', outcomeLabel: `wayward__${shotTypeLabel}` };
}

function perfComputePressureImpact(eventRow) {
  const isCounterpress = eventRow.counterpress === true;
  return { impact: isCounterpress ? 0.06 : 0.03, areaLabel: 'anywhere', outcomeLabel: isCounterpress ? 'pressure_counterpress' : 'pressure' };
}

function perfComputeTurnoverAreaPenalty(location, label) {
  const area = perfClassifyPitchArea(location);
  let penalty = PERF_BY_AREA_GAIN_BACK_HEAVY[area] ?? PERF_BY_AREA_GAIN_BACK_HEAVY.anywhere;
  if (label === 'error') penalty *= 1.20;
  if (label === 'dribbled_past') penalty *= 0.80;
  return { impact: -penalty, areaLabel: area, outcomeLabel: label };
}

function perfComputeMiscontrolImpact(eventRow) {
  const aerialWon = eventRow.miscontrol?.aerial_won === true;
  const area = perfClassifyPitchArea(eventRow.location);
  if (aerialWon) return { impact: 0.0, areaLabel: area, outcomeLabel: 'miscontrol_after_aerial_win_neutral' };
  return perfComputeTurnoverAreaPenalty(eventRow.location, 'miscontrol');
}

function perfComputeClearanceImpact(eventRow) {
  const area = perfClassifyPitchArea(eventRow.location);
  const reward = PERF_CLEARANCE_REWARD_BY_AREA[area] ?? 0.0;
  if (reward === 0.0) return { impact: 0.0, areaLabel: area, outcomeLabel: 'clearance_no_impact' };
  return { impact: reward, areaLabel: area, outcomeLabel: 'clearance' };
}

function perfComputeBlockImpact(eventRow) {
  if (eventRow.block?.deflection === true || eventRow.block?.offensive === true) {
    return { impact: 0.0, areaLabel: perfClassifyPitchArea(eventRow.location), outcomeLabel: 'block_no_impact' };
  }
  const area = perfClassifyPitchArea(eventRow.location);
  let reward = PERF_BLOCK_REWARD_BY_AREA[area] ?? 0.0;
  if (eventRow.block?.save_block === true) reward *= 1.25;
  if (eventRow.block?.counterpress === true) reward += 0.04;
  return { impact: reward, areaLabel: area, outcomeLabel: 'block' };
}

function perfComputeFoulCommittedImpact(eventRow) {
  const asMinute = value => {
    const minute = Number(value);
    if (!Number.isFinite(minute)) return 90.0;
    return Math.max(1.0, Math.min(90.0, minute));
  };
  const timeScaled = (earlyPenalty, latePenalty, minute) => {
    const earlyFactor = (90.0 - minute) / 89.0;
    return latePenalty + (earlyPenalty - latePenalty) * earlyFactor;
  };

  const minute = asMinute(eventRow.minute);
  const card = String(eventRow.foul_committed?.card?.name || '').trim();
  const leadsToPenalty = eventRow.foul_committed?.penalty === true;

  let penalty;
  let label;
  if (card === 'Red Card') {
    penalty = timeScaled(4.0, 2.0, minute);
    label = 'straight_red_card';
  } else if (card === 'Second Yellow' || card === 'Second Yellow Card') {
    penalty = timeScaled(2.6, 1.3, minute);
    label = 'second_yellow_card';
  } else if (card === 'Yellow Card') {
    penalty = timeScaled(1.1, 0.5, minute);
    label = 'first_yellow_card';
  } else if (leadsToPenalty) {
    penalty = 1.0;
    label = 'penalty_conceded';
  } else {
    const area = perfClassifyPitchArea(eventRow.location);
    if (area === 'own_third') return { impact: -0.07, areaLabel: area, outcomeLabel: 'dangerous_freekick_foul' };
    return { impact: 0.0, areaLabel: 'anywhere', outcomeLabel: 'foul_no_impact' };
  }

  if (leadsToPenalty && label !== 'penalty_conceded') {
    penalty = Math.max(penalty, 1.8);
    label = `${label}+penalty_conceded`;
  }
  return { impact: -penalty, areaLabel: 'anywhere', outcomeLabel: label };
}

function perfComputeFoulWonImpact(eventRow) {
  const area = perfClassifyPitchArea(eventRow.location);
  const leadsToPenalty = eventRow.foul_won?.penalty === true;
  if (leadsToPenalty) return { impact: 1.0, areaLabel: area, outcomeLabel: 'penalty_won' };
  const reward = PERF_BY_AREA_GAIN_FRONT_HEAVY[area] ?? PERF_BY_AREA_GAIN_FRONT_HEAVY.anywhere;
  if (reward === 0.0) return { impact: 0.0, areaLabel: area, outcomeLabel: 'foul_won_no_impact' };
  return { impact: reward, areaLabel: area, outcomeLabel: 'foul_won' };
}

function perfComputeBadBehaviourImpact(eventRow) {
  const card = String(eventRow.bad_behaviour?.card?.name || '').trim();
  if (card === 'Red Card') return { impact: -3.0, areaLabel: 'anywhere', outcomeLabel: 'bad_behaviour_red_card' };
  if (card === 'Yellow Card' || card === 'Second Yellow' || card === 'Second Yellow Card') {
    return { impact: -1.5, areaLabel: 'anywhere', outcomeLabel: 'bad_behaviour_yellow_card' };
  }
  return { impact: 0.0, areaLabel: 'anywhere', outcomeLabel: 'bad_behaviour_no_impact' };
}

function perfComputeBallRecoveryImpact(eventRow) {
  const failed = eventRow.ball_recovery?.recovery_failure === true;
  const area = perfClassifyPitchArea(eventRow.location);
  if (failed) return { impact: -0.10, areaLabel: area, outcomeLabel: 'ball_recovery_failed' };
  return { impact: 0.05, areaLabel: area, outcomeLabel: 'ball_recovery' };
}

function perfComputeBallReceiptImpact(eventRow) {
  const outcome = eventRow.ball_receipt?.outcome?.name;
  const area = perfClassifyPitchArea(eventRow.location);
  if (outcome === 'Incomplete') return { impact: -0.03, areaLabel: area, outcomeLabel: 'ball_receipt_incomplete' };
  if (area === 'own_box' || area === 'own_third') return { impact: 0.005, areaLabel: area, outcomeLabel: 'ball_receipt_own_third' };
  if (area === 'middle_third') return { impact: 0.01, areaLabel: area, outcomeLabel: 'ball_receipt_middle_third' };
  if (area === 'final_third') return { impact: 0.02, areaLabel: area, outcomeLabel: 'ball_receipt_final_third' };
  if (area === 'opposition_box') return { impact: 0.04, areaLabel: area, outcomeLabel: 'ball_receipt_opposition_box' };
  return { impact: 0.0, areaLabel: area, outcomeLabel: 'ball_receipt_other_area' };
}

function perfComputeCarryImpact(eventRow) {
  const start = eventRow.location;
  const end = eventRow.carry?.end_location;
  const startArea = perfClassifyPitchArea(start);
  const endArea = perfClassifyPitchArea(end);

  const progressX = Array.isArray(start) && Array.isArray(end) ? end[0] - start[0] : 0;
  const progressY = Array.isArray(start) && Array.isArray(end) ? end[1] - start[1] : 0;
  const carryLength = Math.sqrt(progressX * progressX + progressY * progressY);
  if (carryLength < 3.0) return { impact: 0.0, areaLabel: endArea, outcomeLabel: 'carry_no_impact' };

  const labels = [];
  let impact = 0.0;
  if (progressX >= 10) {
    impact += 0.08;
    labels.push('progressive_carry');
  }
  if ((endArea === 'final_third' || endArea === 'opposition_box') && !(startArea === 'final_third' || startArea === 'opposition_box')) {
    impact += 0.03;
    labels.push('carry_into_final_third');
  }
  if (eventRow.under_pressure === true) {
    impact += 0.02;
    labels.push('carry_under_pressure');
  }
  if (carryLength >= PERF_LONG_PASS_THRESHOLD) {
    impact += 0.05;
    labels.push('long_carry');
  }

  return {
    impact,
    areaLabel: endArea,
    outcomeLabel: labels.length ? `carry_${labels.join('_')}` : 'carry_no_impact',
  };
}

function perfComputeDuelImpact(eventRow) {
  const area = perfClassifyPitchArea(eventRow.location);
  const duelType = eventRow.duel?.type?.name;

  if (duelType === 'Aerial Lost' || duelType === 'Ariel Lost') {
    if (area === 'final_third' || area === 'opposition_box') return { impact: -0.02, areaLabel: area, outcomeLabel: 'aerial_duel_lost_in_attacking_area' };
    if (area === 'middle_third') return { impact: -0.03, areaLabel: area, outcomeLabel: 'aerial_duel_lost_in_middle_third' };
    if (area === 'own_third') return { impact: -0.05, areaLabel: area, outcomeLabel: 'aerial_duel_lost_in_defensive_third' };
    if (area === 'own_box') return { impact: -0.07, areaLabel: area, outcomeLabel: 'aerial_duel_lost_in_own_box' };
    return { impact: -0.03, areaLabel: area, outcomeLabel: 'aerial_duel_lost' };
  }

  if (duelType === 'Tackle') {
    const outcome = eventRow.duel?.outcome?.name;
    const multiplier = PERF_TACKLE_AREA_MULTIPLIER[area] ?? PERF_TACKLE_AREA_MULTIPLIER.anywhere;
    if (outcome === 'Won') return { impact: 0.15 * multiplier, areaLabel: area, outcomeLabel: 'tackle_won' };
    if (outcome === 'Success' || outcome === 'Success In Play' || outcome === 'Success Out') {
      return { impact: 0.12 * multiplier, areaLabel: area, outcomeLabel: 'tackle_success' };
    }
    if (outcome === 'Lost In Play' || outcome === 'Lost Out') {
      return { impact: -0.06 * multiplier, areaLabel: area, outcomeLabel: 'tackle_lost' };
    }
    return { impact: 0.0, areaLabel: area, outcomeLabel: 'tackle_no_impact' };
  }

  return { impact: 0.0, areaLabel: area, outcomeLabel: 'duel_other' };
}

function perfComputeDribbleImpact(eventRow) {
  const area = perfClassifyPitchArea(eventRow.location);
  const outcome = eventRow.dribble?.outcome?.name;

  if (outcome === 'Complete') {
    if (area === 'final_third' || area === 'opposition_box') return { impact: 0.20, areaLabel: area, outcomeLabel: 'successful_dribble_in_attacking_area' };
    if (area === 'middle_third') return { impact: 0.10, areaLabel: area, outcomeLabel: 'successful_dribble_in_middle_third' };
    if (area === 'own_third' || area === 'own_box') return { impact: 0.05, areaLabel: area, outcomeLabel: 'successful_dribble_in_defensive_area' };
    return { impact: 0.08, areaLabel: area, outcomeLabel: 'successful_dribble' };
  }

  if (outcome === 'Incomplete') {
    if (area === 'final_third' || area === 'opposition_box') return { impact: -0.04, areaLabel: area, outcomeLabel: 'failed_dribble_in_attacking_area' };
    if (area === 'middle_third') return { impact: -0.07, areaLabel: area, outcomeLabel: 'failed_dribble_in_middle_third' };
    if (area === 'own_third' || area === 'own_box') return { impact: -0.13, areaLabel: area, outcomeLabel: 'failed_dribble_in_defensive_area' };
    return { impact: -0.05, areaLabel: area, outcomeLabel: 'failed_dribble' };
  }

  return { impact: 0.0, areaLabel: area, outcomeLabel: 'dribble_no_impact' };
}

function perfComputeInterceptionImpact(eventRow) {
  const area = perfClassifyPitchArea(eventRow.location);
  const outcome = eventRow.interception?.outcome?.name;
  const multiplier = PERF_TACKLE_AREA_MULTIPLIER[area] ?? PERF_TACKLE_AREA_MULTIPLIER.anywhere;
  if (outcome === 'Won' || outcome === 'Success' || outcome === 'Success In Play' || outcome === 'Success Out') {
    return { impact: 0.10 * multiplier, areaLabel: area, outcomeLabel: 'interception_success' };
  }
  if (outcome === 'Lost' || outcome === 'Lost In Play' || outcome === 'Lost Out') {
    return { impact: -0.05 * multiplier, areaLabel: area, outcomeLabel: 'interception_lost' };
  }
  return { impact: 0.0, areaLabel: area, outcomeLabel: 'interception_no_impact' };
}

function perfCompute5050Impact(eventRow) {
  const area = perfClassifyPitchArea(eventRow.location);
  const outcome = eventRow['50_50']?.outcome?.name;
  if (outcome === 'Won' || outcome === 'Success To Team') return { impact: 0.10, areaLabel: area, outcomeLabel: '50/50_won' };
  if (outcome === 'Lost' || outcome === 'Success To Opposition') return { impact: -0.05, areaLabel: area, outcomeLabel: '50/50_lost' };
  return { impact: 0.0, areaLabel: area, outcomeLabel: '50/50_no_impact' };
}

function perfFindPriorShotXG(goalkeepingEvent) {
  const eventMinute = goalkeepingEvent.minute ?? 0;
  const eventSecond = goalkeepingEvent.second ?? 0;

  const priorShots = state.events.filter(e => {
    if (e.type?.name !== 'Shot') return false;
    if ((e.minute ?? 0) < eventMinute) return true;
    return (e.minute ?? 0) === eventMinute && (e.second ?? 0) < eventSecond;
  });
  if (!priorShots.length) return null;
  const lastShot = priorShots[priorShots.length - 1];
  const shotXG = perfToFloatXG(lastShot.shot?.statsbomb_xg);
  return Number.isFinite(shotXG) ? shotXG : null;
}

function perfComputeGoalkeepingImpact(eventRow) {
  const actionType = eventRow.goalkeeper?.type?.name;
  const outcome = eventRow.goalkeeper?.outcome?.name;
  const area = perfClassifyGoalkeepingActionArea(eventRow.location);

  if (actionType === 'Collected') {
    if (outcome === 'Fail') return { impact: -0.10, areaLabel: area, outcomeLabel: 'goalkeeping_failed_collection' };
    return { impact: 0.02, areaLabel: area, outcomeLabel: 'goalkeeping_successful_collection' };
  }
  if (actionType === 'Keeper Sweeper') {
    if (outcome === 'Won' || outcome === 'Claim') return { impact: 0.05, areaLabel: area, outcomeLabel: 'goalkeeping_sweeper_retain' };
    return { impact: 0.01, areaLabel: area, outcomeLabel: 'goalkeeping_sweeper_clear' };
  }
  if (actionType === 'Punch') {
    if (outcome === 'Success' || outcome === 'In Play Safe' || outcome === 'Punched Out') {
      return { impact: 0.03, areaLabel: area, outcomeLabel: 'goalkeeping_successful_punch' };
    }
    return { impact: -0.05, areaLabel: area, outcomeLabel: 'goalkeeping_failed_punch' };
  }
  if (actionType === 'Goal Conceded') {
    const shotXG = perfFindPriorShotXG(eventRow);
    if (shotXG !== null) {
      const xgFactor = Math.min((1 - shotXG) * 2, 0.5);
      return { impact: -0.50 * xgFactor, areaLabel: area, outcomeLabel: 'goal_conceded_with_xg_factor' };
    }
    return { impact: -0.50, areaLabel: area, outcomeLabel: 'goal_conceded' };
  }
  if (actionType === 'Penalty Conceded') return { impact: -0.20, areaLabel: area, outcomeLabel: 'penalty_conceded' };
  if (actionType === 'Penalty Saved' || actionType === 'Penalty Saved To Post') {
    return { impact: 1.5, areaLabel: area, outcomeLabel: 'penalty_saved' };
  }
  if (actionType === 'Smother') {
    if (outcome === 'Won' || outcome === 'Success') return { impact: 0.10, areaLabel: area, outcomeLabel: 'goalkeeping_successful_smother' };
    return { impact: -0.50, areaLabel: area, outcomeLabel: 'goalkeeping_failed_smother' };
  }
  if (actionType === 'Shot Saved' || actionType === 'Shot Saved To Post') {
    let impact = 0.10;
    const shotXG = perfFindPriorShotXG(eventRow);
    if (shotXG !== null) impact += 0.50 * shotXG;
    if (outcome === 'In Play Danger') impact -= 0.05;
    return { impact, areaLabel: area, outcomeLabel: 'shot_saved' };
  }
  if (actionType === 'Shot Saved Off T') {
    let impact = 0.05;
    const shotXG = perfFindPriorShotXG(eventRow);
    if (shotXG !== null) impact += 0.20 * shotXG;
    if (outcome === 'Touched Out') impact -= 0.05;
    return { impact, areaLabel: area, outcomeLabel: 'off_target_shot_saved' };
  }
  if (actionType === 'Save' || actionType === 'Saved To Post') {
    if (outcome === 'In Play Danger') return { impact: 0.01, areaLabel: area, outcomeLabel: 'save_in_play_danger' };
    return { impact: 0.03, areaLabel: area, outcomeLabel: 'save' };
  }
  return { impact: 0.0, areaLabel: area, outcomeLabel: 'goalkeeping_other' };
}

function perfComputeEventBasedRating(playerEvents, positionName) {
  const isGoalkeeper = String(positionName ?? '').toLowerCase() === 'goalkeeper';
  // Defensive guard: ensure shootout events never influence match ratings.
  const orderedEvents = [...playerEvents]
    .filter(e => Number(e.period ?? 0) !== 5)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const startingRating = 6.0;
  let totalScore = 0.0;
  const records = [];

  for (const e of orderedEvents) {
    const eventType = e.type?.name;
    if (!eventType) continue;

    let result = { impact: 0.0, areaLabel: 'anywhere', outcomeLabel: 'other' };

    if (eventType === 'Pass') {
      result = isGoalkeeper ? perfComputeGoalkeeperPassImpact(e) : perfComputePassImpact(e);
    } else if (eventType === 'Shot') {
      result = perfComputeShotImpact(e);
    } else if (eventType === 'Pressure') {
      result = perfComputePressureImpact(e);
    } else if (eventType === 'Clearance') {
      result = perfComputeClearanceImpact(e);
    } else if (eventType === 'Block') {
      result = perfComputeBlockImpact(e);
    } else if (eventType === 'Miscontrol') {
      result = perfComputeMiscontrolImpact(e);
    } else if (eventType === 'Error') {
      result = perfComputeTurnoverAreaPenalty(e.location, 'error');
    } else if (eventType === 'Dispossessed') {
      result = perfComputeTurnoverAreaPenalty(e.location, 'dispossessed');
    } else if (eventType === 'Dribbled Past') {
      result = perfComputeTurnoverAreaPenalty(e.location, 'dribbled_past');
    } else if (eventType === 'Foul Committed') {
      result = perfComputeFoulCommittedImpact(e);
    } else if (eventType === 'Foul Won') {
      result = perfComputeFoulWonImpact(e);
    } else if (eventType === 'Bad Behaviour') {
      result = perfComputeBadBehaviourImpact(e);
    } else if (eventType === 'Offside') {
      result = { impact: -0.20, areaLabel: 'anywhere', outcomeLabel: 'offside' };
    } else if (eventType === 'Ball Recovery') {
      result = perfComputeBallRecoveryImpact(e);
    } else if (eventType === 'Ball Receipt*') {
      result = perfComputeBallReceiptImpact(e);
    } else if (eventType === 'Carry') {
      result = perfComputeCarryImpact(e);
    } else if (eventType === 'Duel') {
      result = perfComputeDuelImpact(e);
    } else if (eventType === 'Dribble') {
      result = perfComputeDribbleImpact(e);
    } else if (eventType === 'Interception') {
      result = perfComputeInterceptionImpact(e);
    } else if (eventType === '50/50') {
      result = perfCompute5050Impact(e);
    } else if (eventType === 'Own Goal Against') {
      result = { impact: -1.5, areaLabel: perfClassifyPitchArea(e.location), outcomeLabel: 'own_goal' };
    } else if (eventType === 'Goal Keeper') {
      result = perfComputeGoalkeepingImpact(e);
    }

    totalScore += result.impact;
    records.push({
      type: eventType,
      area: result.areaLabel,
      outcome: result.outcomeLabel,
      impact: result.impact,
    });
  }

  const eventCount = records.filter(r => r.impact !== 0).length;
  const minutes = orderedEvents.map(e => e.minute).filter(Number.isFinite);
  const startingMinute = minutes.length ? Math.min(...minutes) : 1.0;
  const endMinute = minutes.length ? Math.max(...minutes) : 90.0;
  const onPitchLength = Math.max(1.0, endMinute - startingMinute);
  const adjustmentFactor = Math.min(Math.max(1.0, (onPitchLength + 30) / 30), 3.0);

  const scoreAdjustment = totalScore / adjustmentFactor;
  const eventRating = Math.max(0.0, Math.min(10.0, startingRating + scoreAdjustment));
  const gradeInfo = inferPlayerCardGrade(eventRating);

  return {
    eventRating,
    eventScoreRaw: totalScore,
    eventCount,
    grade: gradeInfo.grade,
    gradeColor: gradeInfo.color,
  };
}

function getPlayerOnPitchWindow(teamName, playerRealName, matchDuration) {
  const lineupPlayer = (state.lineups[teamName] ?? []).find(p => p.real_name === playerRealName);
  let startMinute = lineupPlayer?.start_reason === 'Starting XI' ? 0 : null;
  let endMinute = matchDuration;

  const subs = state.events
    .filter(e => e.type?.id === 19 && e.team?.name === teamName)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  for (const e of subs) {
    const minute = e.minute ?? 0;
    if (e.substitution?.replacement?.name === playerRealName && startMinute === null) {
      startMinute = minute;
    }
    if (e.player?.name === playerRealName) {
      endMinute = minute;
    }
  }

  if (startMinute === null) startMinute = 0;
  if (endMinute < startMinute) endMinute = matchDuration;

  return {
    start: Math.max(0, Math.floor(startMinute)),
    end: Math.max(0, Math.floor(endMinute)),
  };
}

function getPlayerCardSymbols(playerEvents) {
  const cards = [];
  for (const e of playerEvents) {
    const foulCard = e.foul_committed?.card?.name;
    const badCard = e.bad_behaviour?.card?.name;
    const card = foulCard || badCard;
    if (!card) continue;
    if (card === 'Yellow Card') cards.push('One Yellow');
    if (card === 'Red Card') cards.push('Red');
    if (card === 'Second Yellow') cards.push('Double Yellow');
  }
  return [...new Set(cards)];
}

function getPlayerCardColor(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return 'var(--muted)';
  if (cards.includes('Red')) return '#ef4444';
  if (cards.includes('Double Yellow')) return '#f59e0b';
  if (cards.includes('One Yellow')) return '#facc15';
  return 'var(--muted)';
}

function buildPlayerCardModel(teamName, playerRealName) {
  const homeName = state.selectedMatch.home_team.home_team_name ?? state.selectedMatch.home_team;
  const awayName = state.selectedMatch.away_team.away_team_name ?? state.selectedMatch.away_team;
  const lineupPlayer = (state.lineups[teamName] ?? []).find(p => p.real_name === playerRealName);
  const displayName = lineupPlayer?.player_name ?? playerRealName;
  const position = lineupPlayer?.position ?? 'Unknown Position';

  const teamEvents = state.events.filter(e => e.team?.name === teamName);
  const playerEvents = teamEvents.filter(e => e.player?.name === playerRealName);

  const passes = playerEvents.filter(e => e.type?.id === 30);
  const successfulPasses = passes.filter(e => !e.pass?.outcome);
  const longPasses = passes.filter(e => computePassLength(e) > 30);
  const successfulLongPasses = longPasses.filter(e => !e.pass?.outcome);
  const finalThirdPasses = passes.filter(e => {
    const start = e.location;
    const end = e.pass?.end_location;
    if (!Array.isArray(start) || !Array.isArray(end)) return false;
    return start[0] < 80 && end[0] > 80;
  });
  const successfulFinalThirdPasses = finalThirdPasses.filter(e => !e.pass?.outcome);
  const keyPasses = passes.filter(e => e.pass?.shot_assist === true || e.pass?.goal_assist === true);
  const assists = passes.filter(e => e.pass?.goal_assist === true);

  const dribbles = playerEvents.filter(e => e.type?.id === 14);
  const successfulDribbles = dribbles.filter(e => e.dribble?.outcome?.name === 'Complete');

  const carries = playerEvents.filter(e => e.type?.id === 43);
  const progressiveCarries = carries.filter(e => {
    const start = e.location;
    const end = e.carry?.end_location;
    return Array.isArray(start) && Array.isArray(end) && (end[0] - start[0]) >= 10;
  });

  const shots = playerEvents.filter(e => e.type?.id === 16);
  const goals = shots.filter(e => e.shot?.outcome?.name === 'Goal');
  const xg = shots.reduce((sum, e) => sum + (e.shot?.statsbomb_xg ?? 0), 0);

  const pressures = playerEvents.filter(e => e.type?.id === 17);
  const tackles = playerEvents.filter(e => e.type?.name === 'Duel' && e.duel?.type?.name === 'Tackle');
  const successfulTackles = tackles.filter(e => PERF_SUCCESS_DUEL_OUTCOMES.has(e.duel?.outcome?.name ?? ''));
  const clearances = playerEvents.filter(e => e.type?.name === 'Clearance');
  const blocks = playerEvents.filter(e => e.type?.name === 'Block' && !e.block?.deflection && !e.block?.offensive);
  const recoveries = playerEvents.filter(e => e.type?.name === 'Ball Recovery' && !e.ball_recovery?.recovery_failure);
  const interceptions = playerEvents.filter(e => e.type?.name === 'Interception');

  const foulsCommitted = playerEvents.filter(e => e.type?.name === 'Foul Committed');
  const wasFouled = playerEvents.filter(e => e.type?.name === 'Foul Won');
  const dispossessed = playerEvents.filter(e => e.type?.name === 'Dispossessed');
  const dribbledPast = playerEvents.filter(e => e.type?.name === 'Dribbled Past');
  const miscontrol = playerEvents.filter(e => e.type?.name === 'Miscontrol');

  const passReceptions = state.events
    .filter(e => e.type?.id === 30 && e.team?.name === teamName && e.pass?.recipient?.name === playerRealName)
    .map(e => e.pass?.end_location)
    .filter(loc => Array.isArray(loc) && loc.length >= 2);

  const passSegments = passes
    .filter(e => !e.pass?.type?.name && Array.isArray(e.location) && Array.isArray(e.pass?.end_location))
    .map(e => ({
      start: e.location,
      end: e.pass.end_location,
    }));

  const matchDuration = getMatchDurationMinute();
  const onPitch = getPlayerOnPitchWindow(teamName, playerRealName, matchDuration);
  const playedMinutes = Math.max(0, onPitch.end - onPitch.start);

  const ratingResult = perfComputeEventBasedRating(playerEvents, position);
  const rating = ratingResult.eventRating;
  const gradeInfo = { grade: ratingResult.grade, color: ratingResult.gradeColor };

  const competitionName = state.selectedComp?.competition_name ?? 'Competition';
  const matchLine = `${competitionName} · ${homeName} ${state.selectedMatch.home_score} - ${state.selectedMatch.away_score} ${awayName} · ${state.selectedMatch.match_date}`;

  return {
    displayName,
    position,
    onPitch,
    playedMinutes,
    matchLine,
    cards: getPlayerCardSymbols(playerEvents),
    rating,
    grade: gradeInfo.grade,
    gradeColor: gradeInfo.color,
    metrics: {
      shots: shots.length,
      goals: goals.length,
      xg,
      passesCompleted: successfulPasses.length,
      passesTotal: passes.length,
      finalThirdCompleted: successfulFinalThirdPasses.length,
      finalThirdTotal: finalThirdPasses.length,
      longPassCompleted: successfulLongPasses.length,
      longPassTotal: longPasses.length,
      keyPasses: keyPasses.length,
      dribblesCompleted: successfulDribbles.length,
      dribblesTotal: dribbles.length,
      progressiveCarries: progressiveCarries.length,
      foulsCommitted: foulsCommitted.length,
      wasFouled: wasFouled.length,
      dispossessed: dispossessed.length,
      dribbledPast: dribbledPast.length,
      miscontrol: miscontrol.length,
      pressures: pressures.length,
      tacklesWon: successfulTackles.length,
      tacklesTotal: tackles.length,
      clearances: clearances.length,
      blocks: blocks.length,
    },
    maps: {
      passReceptions,
      recoveries: recoveries.map(e => e.location).filter(loc => Array.isArray(loc) && loc.length >= 2),
      passSegments,
    },
  };
}

function initPlayerCardDropdowns(homeName, awayName) {
  document.getElementById('label-perf-home').textContent = homeName;
  document.getElementById('label-perf-away').textContent = awayName;

  const populate = (selectId, teamName) => {
    const sel = document.getElementById(selectId);
    if (!sel) return;

    const eventPlayerSet = new Set(
      state.events
        .filter(e => e.team?.name === teamName && e.player?.name)
        .map(e => e.player.name)
    );

    let players = (state.lineups[teamName] ?? []).filter(p => eventPlayerSet.has(p.real_name));
    if (!players.length) players = state.lineups[teamName] ?? [];
    players.sort((a, b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999));

    const teamEvents = state.events.filter(e => e.team?.name === teamName);
    const eventsByPlayer = new Map();
    for (const e of teamEvents) {
      const playerName = e.player?.name;
      if (!playerName) continue;
      if (!eventsByPlayer.has(playerName)) eventsByPlayer.set(playerName, []);
      eventsByPlayer.get(playerName).push(e);
    }
    const matchDuration = getMatchDurationMinute();

    sel.innerHTML = '';
    if (!players.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No players available';
      sel.appendChild(opt);
      return;
    }

    for (const p of players) {
      const playerEvents = eventsByPlayer.get(p.real_name) ?? [];
      const onPitch = getPlayerOnPitchWindow(teamName, p.real_name, matchDuration);
      const playedMinutes = Math.max(0, onPitch.end - onPitch.start);
      const rating = perfComputeEventBasedRating(playerEvents, p.position).eventRating;
      const ratingLabel = playedMinutes > 10 && Number.isFinite(rating) ? rating.toFixed(1) : 'N/A';

      const opt = document.createElement('option');
      opt.value = p.real_name;
      opt.textContent = `${p.jersey_number}. ${p.player_name} · ${ratingLabel}`;
      sel.appendChild(opt);
    }

    sel.selectedIndex = 0;
  };

  populate('select-perf-home', homeName);
  populate('select-perf-away', awayName);
}

function renderPlayerCards() {
  const homeName = state.selectedMatch.home_team.home_team_name ?? state.selectedMatch.home_team;
  const awayName = state.selectedMatch.away_team.away_team_name ?? state.selectedMatch.away_team;

  const slugifyForFilename = value => String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  const renderOne = (teamName, selectId, wrapId, side) => {
    const sel = document.getElementById(selectId);
    const wrap = document.getElementById(wrapId);
    if (!sel || !wrap) return;

    let playerRealName = sel.value;
    if (!playerRealName && sel.options.length > 0) {
      playerRealName = sel.options[0].value;
      sel.value = playerRealName;
    }

    if (!playerRealName) {
      wrap.innerHTML = '<div class="perf-card-empty">No player data available.</div>';
      return;
    }

    const model = buildPlayerCardModel(teamName, playerRealName);
    const m = model.metrics;
    const cardText = model.cards.length ? model.cards.join(' ') : 'None';
    const cardColor = getPlayerCardColor(model.cards);
    const ratingText = model.playedMinutes > 10 ? model.rating.toFixed(1) : 'N/A';
    const gradeText = model.playedMinutes > 10 ? model.grade : 'N/A';
    const gradeColor = model.playedMinutes > 10 ? model.gradeColor : 'var(--muted)';

    const fileName = [
      slugifyForFilename(teamName),
      slugifyForFilename(model.displayName),
      `match-${state.selectedMatch?.match_id ?? 'unknown'}`,
      'player-card.png',
    ].filter(Boolean).join('-');

    wrap.innerHTML = `
      <div class="perf-card" data-export-filename="${fileName}">
        <div class="perf-card-header">
          <div class="perf-card-match">${model.matchLine}</div>
          <div class="perf-card-head-row">
            <div>
              <div class="perf-card-name">${model.displayName}</div>
              <div class="perf-card-role">${model.position} · ${model.onPitch.start}'-${model.onPitch.end}'</div>
            </div>
            <div class="perf-rating" style="border-color:${gradeColor}">
              <div class="perf-rating-label" style="color:${gradeColor}">Rating</div>
              <div class="perf-rating-value" style="color:${gradeColor}">${ratingText}</div>
              <div class="perf-rating-grade" style="color:${gradeColor}">${gradeText}</div>
            </div>
          </div>
        </div>

        <div class="perf-box perf-box-shots">Shots: ${m.shots} &nbsp;&middot;&nbsp; Goal: ${m.goals} &nbsp;&middot;&nbsp; xG: ${m.xg.toFixed(2)}</div>

        <div class="perf-metric-grid">
          <div class="perf-box perf-box-pass">
            <div>Passing: ${m.passesCompleted}/${m.passesTotal}</div>
            <div>Final-third pass: ${m.finalThirdCompleted}/${m.finalThirdTotal}</div>
            <div>Long pass: ${m.longPassCompleted}/${m.longPassTotal}</div>
            <div>Key pass: ${m.keyPasses}</div>
          </div>
          <div class="perf-box perf-box-defense">
            <div>Pressure: ${m.pressures}</div>
            <div>Tackle: ${m.tacklesWon}/${m.tacklesTotal}</div>
            <div>Clearance: ${m.clearances}</div>
            <div>Block: ${m.blocks}</div>
          </div>
          <div class="perf-box perf-box-dribble">
            <div>Dribble: ${m.dribblesCompleted}/${m.dribblesTotal}</div>
            <div>Progressive carry: ${m.progressiveCarries}</div>
          </div>
          <div class="perf-box perf-box-turnover">
            <div>Dispossessed: ${m.dispossessed}</div>
            <div>Dribbled past: ${m.dribbledPast}</div>
            <div>Miscontrol: ${m.miscontrol}</div>
          </div>
          <div class="perf-box perf-box-foul perf-box-full perf-box-foul-strip">
            Fouls: ${m.foulsCommitted} &nbsp;&middot;&nbsp; Was fouled: ${m.wasFouled} &nbsp;&middot;&nbsp; <span style="color:${cardColor}">Cards: ${cardText}</span>
          </div>
        </div>

        <div class="perf-map-grid">
          <div class="perf-map-panel">
            <div class="perf-map-title">Ball Receiving</div>
            <canvas id="canvas-perf-receive-${side}" class="perf-map-canvas" width="240" height="330"></canvas>
            <div class="perf-map-legend">
              <span><span class="perf-legend-dot perf-red"></span>Pass reception</span>
              <span><span class="perf-legend-dot perf-blue"></span>Recovery</span>
            </div>
          </div>
          <div class="perf-map-panel">
            <div class="perf-map-title">Passing Map</div>
            <canvas id="canvas-perf-pass-${side}" class="perf-map-canvas" width="240" height="330"></canvas>
            <div class="perf-map-legend">
              <span><span class="perf-legend-line"></span>Pass trajectory</span>
              <span><span class="perf-legend-dot perf-blue-soft"></span>Pass start</span>
            </div>
          </div>
        </div>
      </div>`;

    const receiveCanvas = document.getElementById(`canvas-perf-receive-${side}`);
    const passCanvas = document.getElementById(`canvas-perf-pass-${side}`);
    if (receiveCanvas) {
      drawPerformanceReceivingMap(receiveCanvas, model.maps.passReceptions, model.maps.recoveries);
    }
    if (passCanvas) {
      drawPerformancePassingMap(passCanvas, model.maps.passSegments);
    }
  };

  renderOne(homeName, 'select-perf-home', 'perf-card-home', 'home');
  renderOne(awayName, 'select-perf-away', 'perf-card-away', 'away');
}

async function savePerformanceCardAsImage(side) {
  const wrap = document.getElementById(`perf-card-${side}`);
  const btn = document.getElementById(`btn-save-perf-${side}`);
  if (!wrap || !btn) return;

  const card = wrap.querySelector('.perf-card');
  if (!card) {
    toast('No player card available to save yet.');
    return;
  }

  if (typeof window.html2canvas !== 'function') {
    toast('Export library not loaded. Please refresh and try again.');
    return;
  }

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const canvas = await window.html2canvas(card, {
      backgroundColor: null,
      scale: 2,
      useCORS: true,
    });

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = card.dataset.exportFilename || `player-card-${side}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('Player card saved as PNG.');
  } catch (err) {
    console.error(err);
    toast(`Failed to save card: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

document.getElementById('select-perf-home').addEventListener('change', renderPlayerCards);
document.getElementById('select-perf-away').addEventListener('change', renderPlayerCards);
document.getElementById('btn-save-perf-home').addEventListener('click', () => savePerformanceCardAsImage('home'));
document.getElementById('btn-save-perf-away').addEventListener('click', () => savePerformanceCardAsImage('away'));

// ── Penalty shootout tab ───────────────────────────────────────────
function setShootoutTabVisible(visible) {
  const btn = document.getElementById('tab-btn-shootout');
  if (!btn) return;
  btn.classList.toggle('tab-hidden', !visible);
  if (!visible && btn.classList.contains('active')) showTab('formations');
}

function renderShootoutTab(homeName, awayName) {
  const box = document.getElementById('shootout-content');
  const events = (state.shootoutEvents ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  if (!events.length) {
    box.innerHTML = '<p class="shootout-summary">No shootout events were found.</p>';
    return;
  }

  const nicknames = buildNicknameLookup();
  const kicks = events.filter(e => e.type?.id === 16);

  let homePK = 0;
  let awayPK = 0;

  const rows = kicks.map((e, idx) => {
    const team = e.team?.name ?? 'Unknown';
    const isHome = team === homeName;
    const playerReal = e.player?.name ?? 'Unknown';
    const playerDisplay = nicknames[playerReal] ?? playerReal;
    const outcome = e.shot?.outcome?.name ?? 'Unknown';
    const made = outcome === 'Goal';

    if (made) {
      if (isHome) homePK++;
      else if (team === awayName) awayPK++;
    }

    const teamClass = isHome ? 'shootout-team-home' : 'shootout-team-away';
    const outcomeClass = made ? 'shootout-made' : 'shootout-missed';
    const scoreText = `${homePK}-${awayPK}`;

    return `
      <tr>
        <td>${idx + 1}</td>
        <td class="${teamClass}">${team}</td>
        <td>${playerDisplay}</td>
        <td class="${outcomeClass}">${outcome}</td>
        <td>${scoreText}</td>
      </tr>`;
  }).join('');

  const finalPK = getShootoutScore(events, homeName, awayName);

  box.innerHTML = `
    <div class="shootout-headline">Penalty Shootout</div>
    <div class="shootout-summary">
      Final shootout score: <strong>${homeName} ${finalPK.homePK} - ${finalPK.awayPK} ${awayName}</strong>
    </div>
    <table class="shootout-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th>Kicker</th>
          <th>Outcome</th>
          <th>Running Score</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5">No penalty kicks found.</td></tr>'}</tbody>
    </table>`;
}

// ── xG Plot ──────────────────────────────────────────────────────────

function renderXGPlot() {
  const homeName = state.selectedMatch.home_team.home_team_name ?? state.selectedMatch.home_team;
  const awayName = state.selectedMatch.away_team.away_team_name ?? state.selectedMatch.away_team;
  const ownGoalAgainstEvents = state.events.filter(isOwnGoalAgainstEvent);

  // Extract shots + Own Goal Against events in chronological order.
  const regularShots = state.events.filter(e => e.type?.id === 16);
  const shots = [...regularShots, ...ownGoalAgainstEvents].sort((a, b) => {
    if (a.minute !== b.minute) return a.minute - b.minute;
    if ((a.second ?? 0) !== (b.second ?? 0)) return (a.second ?? 0) - (b.second ?? 0);
    return (a.index ?? 0) - (b.index ?? 0);
  });

  // Build player nickname lookup (same as pass network)
  const nicknames = buildNicknameLookup();

  // Build team shot arrays with cumulative xG
  const homeShots = [];
  const awayShots = [];
  let homeXG = 0, awayXG = 0;

  for (const shot of shots) {
    const isOwnGoal = isOwnGoalAgainstEvent(shot);
    const attrib = isOwnGoal ? getOwnGoalAgainstAttribution(shot, homeName, awayName) : null;
    const scoringTeam = isOwnGoal ? attrib?.scoringTeam : shot.team?.name;
    if (!scoringTeam) continue;

    const xg = isOwnGoal ? 0 : (shot.shot?.statsbomb_xg || 0);
    const isGoal = isOwnGoal ? true : shot.shot?.outcome?.id === 97;
    const playerRealName = shot.player?.name || 'Unknown';
    const playerDisplay = nicknames[playerRealName] ?? playerRealName;
    const playPattern = shot.play_pattern?.name ?? 'Unknown';
    const phase = playPattern === 'Regular Play' ? 'Open Play' : 'Set Piece';
    const shotType = isOwnGoal ? 'Own Goal' : (shot.shot?.type?.name ?? 'Unknown');
    const outcome = isOwnGoal ? 'Own Goal' : (shot.shot?.outcome?.name ?? 'Unknown');
    const rawLocation = Array.isArray(shot.location) ? shot.location : null;
    const location = isOwnGoal ? normalizeOwnGoalLocation(rawLocation) : rawLocation;
    const shotZone = classifyShotZone(location, shotType);

    if (scoringTeam === homeName) {
      homeXG += xg;
      homeShots.push({
        minute: shot.minute + (shot.second || 0) / 60,
        cumXG: homeXG,
        xg,
        isGoal,
        isOwnGoal,
        team: homeName,
        player: playerRealName,
        playerDisplay,
        outcome,
        phase,
        playPattern,
        shotType,
        shotZone,
        location,
      });
    } else if (scoringTeam === awayName) {
      awayXG += xg;
      awayShots.push({
        minute: shot.minute + (shot.second || 0) / 60,
        cumXG: awayXG,
        xg,
        isGoal,
        isOwnGoal,
        team: awayName,
        player: playerRealName,
        playerDisplay,
        outcome,
        phase,
        playPattern,
        shotType,
        shotZone,
        location,
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
  const xgCanvas = document.getElementById('canvas-xgplot');
  const xgResult = drawXGPlot(
    xgCanvas,
    homeName,
    awayName,
    homeShots,
    awayShots,
    matchDuration
  );
  xgCanvas._xgGoalHits = xgResult?.hits ?? [];

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
initThemePreference();
loadCompetitions();
