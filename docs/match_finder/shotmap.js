/**
 * shotmap.js — draws a horizontal shot map on a <canvas>.
 * Pitch: 120 × 80 units, drawn landscape.
 */

const SM_LEN = 120;
const SM_WID = 80;

function drawShotmapPitch(ctx, cw, ch) {
  const sx = cw / SM_LEN;
  const sy = ch / SM_WID;
  const px = v => v * sx;
  const py = v => v * sy;

  ctx.fillStyle = '#2d5a27';
  ctx.fillRect(0, 0, cw, ch);

  // Alternating stripes
  for (let i = 0; i < 6; i++) {
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.fillRect(i * cw / 6, 0, cw / 6, ch);
    }
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.5;

  // Outline
  ctx.strokeRect(0, 0, cw, ch);

  // Halfway
  ctx.beginPath(); ctx.moveTo(px(60), 0); ctx.lineTo(px(60), ch); ctx.stroke();

  // Centre circle
  ctx.beginPath();
  ctx.arc(px(60), py(40), 10 * sy, 0, Math.PI * 2);
  ctx.stroke();
  drawDot(ctx, px(60), py(40), 3, 'white');

  // Left penalty area
  smRect(ctx, px(0), py(18), px(18), py(62) - py(18));
  smRect(ctx, px(0), py(30), px(6), py(50) - py(30));
  drawDot(ctx, px(12), py(40), 3, 'white');
  // Left D
  ctx.save();
  ctx.beginPath(); ctx.rect(px(18), 0, cw, ch); ctx.clip();
  ctx.beginPath(); ctx.arc(px(12), py(40), 10 * sy, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // Right penalty area
  smRect(ctx, px(102), py(18), px(120) - px(102), py(62) - py(18));
  smRect(ctx, px(114), py(30), px(120) - px(114), py(50) - py(30));
  drawDot(ctx, px(108), py(40), 3, 'white');
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, px(102), ch); ctx.clip();
  ctx.beginPath(); ctx.arc(px(108), py(40), 10 * sy, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // Goals
  smRect(ctx, px(-2), py(36), px(2) - px(-2), py(44) - py(36));
  smRect(ctx, px(120), py(36), px(2), py(44) - py(36));
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
  const sx = cw / SM_LEN;
  const sy = ch / SM_WID;

  ctx.clearRect(0, 0, cw, ch);
  drawShotmapPitch(ctx, cw, ch);

  // Legend categories
  const categories = {
    'Goal':          { color: '#facc15', stroke: '#fff' },
    'Saved':    { color: '#3b82f6', stroke: '#93c5fd' },
    'Off Target':    { color: '#ef4444', stroke: '#fca5a5' },
    'Blocked':       { color: '#94a3b8', stroke: '#cbd5e1' },
    'Post':          { color: '#fb923c', stroke: '#fdba74' },
  };

  const getCategory = outcome => {
    if (!outcome) return 'Off Target';
    if (outcome === 'Goal') return 'Goal';
    if (outcome === 'Saved') return 'Saved';
    if (outcome === 'Blocked') return 'Blocked';
    if (outcome === 'Post' || outcome === 'Wayward') return 'Off Target';
    return 'Off Target';
  };

  for (const shot of shots) {
    if (!shot.location) continue;
    const [lx, ly] = shot.location;
    const cx = lx * sx;
    const cy = ly * sy;
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
    if (cat === 'Goal') {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${r + 2}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', cx, cy);
    }
  }

  return Object.entries(categories);
}
