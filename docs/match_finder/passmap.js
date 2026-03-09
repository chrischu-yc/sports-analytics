/**
 * passmap.js — draws a full-pitch pass map on a <canvas>.
 * Pitch: 120 × 80 units, drawn landscape (same orientation as the Python reference).
 *
 * Successful passes  → team colour (semi-transparent)
 * Unsuccessful passes → dark grey
 */

function drawPassmapPitch(ctx, cw, ch) {
  const sx = cw / 120;
  const sy = ch / 80;
  const px = v => v * sx;
  const py = v => v * sy;

  // Background
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

  // Halfway line
  ctx.beginPath(); ctx.moveTo(px(60), 0); ctx.lineTo(px(60), ch); ctx.stroke();

  // Centre circle & spot
  ctx.beginPath(); ctx.arc(px(60), py(40), 10 * sy, 0, Math.PI * 2); ctx.stroke();
  _pmDot(ctx, px(60), py(40), 3, 'white');

  // Left penalty area
  _pmRect(ctx, px(0), py(18), px(18), py(62) - py(18));
  _pmRect(ctx, px(0), py(30), px(6),  py(50) - py(30));
  _pmDot(ctx, px(12), py(40), 3, 'white');
  ctx.save();
  ctx.beginPath(); ctx.rect(px(18), 0, cw, ch); ctx.clip();
  ctx.beginPath(); ctx.arc(px(12), py(40), 10 * sy, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // Right penalty area
  _pmRect(ctx, px(102), py(18), px(18), py(62) - py(18));
  _pmRect(ctx, px(114), py(30), px(6),  py(50) - py(30));
  _pmDot(ctx, px(108), py(40), 3, 'white');
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, px(102), ch); ctx.clip();
  ctx.beginPath(); ctx.arc(px(108), py(40), 10 * sy, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // Goals
  _pmRect(ctx, px(-2), py(36), px(2),  py(44) - py(36));
  _pmRect(ctx, px(120), py(36), px(2), py(44) - py(36));
}

function _pmRect(ctx, x, y, w, h) {
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.stroke();
}

function _pmDot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function _pmArrow(ctx, x1, y1, x2, y2, color) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return;

  const angle   = Math.atan2(dy, dx);
  const headLen = Math.min(7, len * 0.35);

  // Shaft — stop slightly before tip so arrowhead looks clean
  const tx = x2 - Math.cos(angle) * headLen * 0.6;
  const ty = y2 - Math.sin(angle) * headLen * 0.6;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(tx, ty);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6),
             y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6),
             y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * drawPassmap(canvasEl, passes, teamColor)
 *   passes: [{ location:[x,y], end_location:[x,y], outcome: string|null }]
 *   teamColor: CSS hex for successful passes (e.g. '#e53e3e')
 */
function drawPassmap(canvasEl, passes, teamColor) {
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

  // Parse teamColor into an rgba for the origin dot (alpha 0.2)
  // teamColor is a 6-digit hex like '#e53e3e'
  const hexR = parseInt(teamColor.slice(1, 3), 16);
  const hexG = parseInt(teamColor.slice(3, 5), 16);
  const hexB = parseInt(teamColor.slice(5, 7), 16);
  const dotColor       = `rgba(${hexR},${hexG},${hexB},0.45)`;
  const dotColorFail   = 'rgba(160,160,160,0.35)';

  // Draw unsuccessful passes first (under successful)
  for (const pass of passes) {
    if (!pass.location || !pass.end_location) continue;
    if (!pass.outcome) continue; // skip successful for now
    const [x1, y1] = pass.location;
    const [x2, y2] = pass.end_location;
    _pmArrow(ctx, x1 * sx, y1 * sy, x2 * sx, y2 * sy, 'rgba(160,160,160,0.55)');
  }
  // Draw successful passes on top
  for (const pass of passes) {
    if (!pass.location || !pass.end_location) continue;
    if (pass.outcome) continue; // skip unsuccessful
    const [x1, y1] = pass.location;
    const [x2, y2] = pass.end_location;
    _pmArrow(ctx, x1 * sx, y1 * sy, x2 * sx, y2 * sy, teamColor + 'cc');
  }
  // Draw origin dots on top of all arrows
  for (const pass of passes) {
    if (!pass.location) continue;
    const [x1, y1] = pass.location;
    const color = pass.outcome ? dotColorFail : dotColor;
    ctx.beginPath();
    ctx.arc(x1 * sx, y1 * sy, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}
