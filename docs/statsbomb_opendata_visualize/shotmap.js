/**
 * shotmap.js — draws a half-pitch shot map on a <canvas>.
 * Only the attacking half is shown (pitch x: 60→120), rotated so the goal is at top.
 *
 * Coordinate mapping:
 *   canvas x = pitch y * (cw / 80)   — left sideline → right sideline
 *   canvas y = (120 - pitch x) * (ch / 60) — goal (x=120) → top, centre (x=60) → bottom
 */

const SM_LEN      = 120;  // full pitch length
const SM_WID      = 80;   // pitch width
const SM_HALF_X   = 60;   // length of the half shown

function drawShotmapPitch(ctx, cw, ch) {
  // sx: pitch y-units → canvas x-pixels
  // sy: pitch x-units from centre → canvas y-pixels
  const sx = cw / SM_WID;
  const sy = ch / SM_HALF_X;

  // helpers
  const cpx = py => py * sx;              // pitch y  → canvas x
  const cpy = px => (SM_LEN - px) * sy;  // pitch x  → canvas y (goal at top)

  // Background
  ctx.fillStyle = '#2d5a27';
  ctx.fillRect(0, 0, cw, ch);

  // Alternating horizontal stripes (goal → centre line)
  for (let i = 0; i < 4; i++) {
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.fillRect(0, i * ch / 4, cw, ch / 4);
    }
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.5;

  // Border (all 4 sides; bottom edge = centre line)
  ctx.strokeRect(0, 0, cw, ch);

  // Penalty area (x: 102→120, y: 18→62)
  smRect(ctx, cpx(18), cpy(120), cpx(62) - cpx(18), cpy(102) - cpy(120));
  // 6-yard box (x: 114→120, y: 30→50)
  smRect(ctx, cpx(30), cpy(120), cpx(50) - cpx(30), cpy(114) - cpy(120));

  // Penalty spot
  drawDot(ctx, cpx(40), cpy(108), 3, 'white');

  // Penalty arc — show only the part outside the penalty area
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, cpy(102), cw, ch - cpy(102));
  ctx.clip();
  ctx.beginPath();
  ctx.arc(cpx(40), cpy(108), 10 * sx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Centre arc — show only the top sliver visible at the bottom of canvas
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cw, ch);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(cpx(40), cpy(60), 10 * sx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Goal (extends above top edge: x=120, y: 36→44)
  const goalX1 = cpx(36), goalX2 = cpx(44);
  const goalDepth = Math.round(5 * sx);
  ctx.fillStyle = 'rgba(120,120,120,0.45)';
  ctx.fillRect(goalX1, -goalDepth, goalX2 - goalX1, goalDepth);
  smRect(ctx,  goalX1, -goalDepth, goalX2 - goalX1, goalDepth);
}

function smRect(ctx, x, y, w, h) {
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.stroke();
}

function drawDot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

/**
 * drawShotmap(canvasEl, shots)
 * shots: array of { location: [x, y], shot_outcome, shot_statsbomb_xg, player, minute }
 *   Each shot is drawn from the LEFT side (normalised so both teams attack right→left
 *   for simplicity — the raw data already gives coordinates).
 */
function drawShotmap(canvasEl, shots) {
  const dpr = window.devicePixelRatio || 1;
  // Cache original CSS size on first call; canvasEl.clientWidth is 0 when hidden
  // (display:none tab), and canvasEl.width would already be dpr-scaled on 2nd+ calls.
  if (!canvasEl.dataset.cssW) {
    canvasEl.dataset.cssW = canvasEl.clientWidth || canvasEl.width;
    canvasEl.dataset.cssH = canvasEl.clientHeight || canvasEl.height;
  }
  const cssW = +canvasEl.dataset.cssW;
  const cssH = +canvasEl.dataset.cssH;

  canvasEl.width  = cssW * dpr;
  canvasEl.height = cssH * dpr;
  canvasEl.style.width  = cssW + 'px';
  canvasEl.style.height = cssH + 'px';

  const ctx = canvasEl.getContext('2d');
  ctx.scale(dpr, dpr);

  const cw = cssW;
  const ch = cssH;
  const sx = cw / SM_WID;       // pitch y → canvas x
  const sy = ch / SM_HALF_X;   // pitch x (from centre) → canvas y

  ctx.clearRect(0, 0, cw, ch);
  drawShotmapPitch(ctx, cw, ch);

  const hits = [];  // hit-test records: { cx, cy, r, shot }

  // Legend categories
  const categories = {
    'Goal':       { color: '#facc15', stroke: '#fff' },
    'Own Goal':   { color: '#a855f7', stroke: '#e9d5ff' },
    'Saved':      { color: '#3b82f6', stroke: '#93c5fd' },
    'Off Target': { color: '#ef4444', stroke: '#fca5a5' },
    'Blocked':    { color: '#94a3b8', stroke: '#cbd5e1' },
    'Post':       { color: '#fb923c', stroke: '#fdba74' },
  };

  const getCategory = outcome => {
    if (!outcome) return 'Off Target';
    if (outcome === 'Goal') return 'Goal';
    if (outcome === 'Own Goal') return 'Own Goal';
    if (outcome === 'Saved') return 'Saved';
    if (outcome === 'Blocked') return 'Blocked';
    if (outcome === 'Post' || outcome === 'Wayward') return 'Off Target';
    return 'Off Target';
  };

  for (const shot of shots) {
    if (!shot.location) continue;
    const [lx, ly] = shot.location;
    // Map pitch coords to rotated half-pitch canvas coords
    const cx = ly * sx;              // pitch y  → canvas x
    const cy = (SM_LEN - lx) * sy;  // pitch x  → canvas y (goal=top)
    const xg = shot.shot_statsbomb_xg || 0;
    const r = Math.max(5, Math.min(18, 5 + xg * 30));
    const cat = getCategory(shot.shot_outcome);
    const style = categories[cat] || categories['Off Target'];

    // Circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = style.color + 'bb';
    ctx.fill();
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Goal: star marker
    if (cat === 'Goal' || cat === 'Own Goal') {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${r + 2}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', cx, cy);
    }

    hits.push({ cx, cy, r, shot });
  }

  return { legendEntries: Object.entries(categories), hits };
}
