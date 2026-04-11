/**
 * carrymap.js — draws a team carry map on a <canvas>.
 *
 * All carries are drawn in the team colour.
 * Carries shorter than MIN_CARRY_DIST pitch units are skipped.
 *
 * Reuses drawPassmapPitch() from passmap.js — load passmap.js first.
 */

const MIN_CARRY_DIST = 5;   // pitch units

const OUTCOME_COLORS = {
  pass:  { fill: 'rgba(249,115, 22,0.85)', stroke: '#f97316' },
  shot:  { fill: 'rgba(234,179,  8,0.85)', stroke: '#eab308' },
  lost:  { fill: 'rgba(168, 85,247,0.85)', stroke: '#a855f7' },
  other: { fill: 'rgba(156,163,175,0.85)', stroke: '#9ca3af' },
};

function drawCarrymap(canvasEl, carries, teamColor) {
  const dpr = window.devicePixelRatio || 1;
  if (!canvasEl.dataset.cssW) {
    canvasEl.dataset.cssW = canvasEl.clientWidth  || canvasEl.width;
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

  const cw = cssW, ch = cssH;
  const sx = cw / 120, sy = ch / 80;

  ctx.clearRect(0, 0, cw, ch);
  drawPassmapPitch(ctx, cw, ch);

  if (!carries.length) return;

  const hexR = parseInt(teamColor.slice(1, 3), 16);
  const hexG = parseInt(teamColor.slice(3, 5), 16);
  const hexB = parseInt(teamColor.slice(5, 7), 16);
  const arrowColor = `rgba(${hexR},${hexG},${hexB},0.75)`;
  const dotColor   = `rgba(${hexR},${hexG},${hexB},0.45)`;

  // Outcome circles first (under arrows), at carry end location
  for (const c of carries) {
    if (!c.location || !c.end_location) continue;
    const [x1, y1] = c.location;
    const [x2, y2] = c.end_location;
    if (Math.hypot(x2 - x1, y2 - y1) < MIN_CARRY_DIST) continue;
    const oc = OUTCOME_COLORS[c.outcome] || OUTCOME_COLORS.other;
    ctx.beginPath();
    ctx.arc(x2 * sx, y2 * sy, 3, 0, Math.PI * 2);
    ctx.fillStyle = oc.fill;
    ctx.fill();
    ctx.strokeStyle = oc.stroke;
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }

  // Arrows on top of outcome circles
  for (const c of carries) {
    if (!c.location || !c.end_location) continue;
    const [x1, y1] = c.location;
    const [x2, y2] = c.end_location;
    if (Math.hypot(x2 - x1, y2 - y1) < MIN_CARRY_DIST) continue;
    _pmArrow(ctx, x1 * sx, y1 * sy, x2 * sx, y2 * sy, arrowColor);
  }

  // Origin dots on top
  for (const c of carries) {
    if (!c.location || !c.end_location) continue;
    const [x1, y1] = c.location;
    const [x2, y2] = c.end_location;
    if (Math.hypot(x2 - x1, y2 - y1) < MIN_CARRY_DIST) continue;
    ctx.beginPath();
    ctx.arc(x1 * sx, y1 * sy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
  }
}
