/**
 * playercard.js — mini vertical pitch drawings for player performance cards.
 */

function _perfSetupCanvas(canvasEl) {
  const dpr = window.devicePixelRatio || 1;
  if (!canvasEl.dataset.cssW) {
    canvasEl.dataset.cssW = canvasEl.clientWidth || canvasEl.width;
    canvasEl.dataset.cssH = canvasEl.clientHeight || canvasEl.height;
  }
  const cssW = +canvasEl.dataset.cssW;
  const cssH = +canvasEl.dataset.cssH;

  canvasEl.width = cssW * dpr;
  canvasEl.height = cssH * dpr;
  canvasEl.style.width = cssW + 'px';
  canvasEl.style.height = cssH + 'px';

  const ctx = canvasEl.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, cw: cssW, ch: cssH };
}

function _perfTransform(cw, ch) {
  const ux = cw / 80;
  const uy = ch / 120;
  const unit = Math.min(ux, uy);

  return {
    px: y => y * ux,
    py: x => ch - x * uy,
    unit,
  };
}

function _perfDrawVerticalPitch(ctx, cw, ch) {
  ctx.fillStyle = '#f5f6f8';
  ctx.fillRect(0, 0, cw, ch);

  const { px, py, unit } = _perfTransform(cw, ch);

  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 1.8;

  // Outline
  ctx.strokeRect(0, 0, cw, ch);

  // Halfway line (x=60)
  ctx.beginPath();
  ctx.moveTo(0, py(60));
  ctx.lineTo(cw, py(60));
  ctx.stroke();

  // Center circle + spot
  ctx.beginPath();
  ctx.arc(px(40), py(60), 10 * unit, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(px(40), py(60), 1.1 * unit, 0, Math.PI * 2);
  ctx.fillStyle = '#1f2937';
  ctx.fill();

  // Bottom penalty areas (own goal side)
  ctx.strokeRect(px(18), py(18), px(62) - px(18), py(0) - py(18));
  ctx.strokeRect(px(30), py(6), px(50) - px(30), py(0) - py(6));
  ctx.beginPath();
  ctx.arc(px(40), py(12), 1.1 * unit, 0, Math.PI * 2);
  ctx.fill();

  // Top penalty areas (opponent goal side)
  ctx.strokeRect(px(18), py(120), px(62) - px(18), py(102) - py(120));
  ctx.strokeRect(px(30), py(120), px(50) - px(30), py(114) - py(120));
  ctx.beginPath();
  ctx.arc(px(40), py(108), 1.1 * unit, 0, Math.PI * 2);
  ctx.fill();

  // Goals
  ctx.strokeRect(px(36), py(0), px(44) - px(36), py(-2) - py(0));
  ctx.strokeRect(px(36), py(122), px(44) - px(36), py(120) - py(122));
}

function _perfArrow(ctx, x1, y1, x2, y2, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return;

  const angle = Math.atan2(dy, dx);
  const headLen = Math.min(7, len * 0.34);
  const tx = x2 - Math.cos(angle) * headLen * 0.6;
  const ty = y2 - Math.sin(angle) * headLen * 0.6;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(tx, ty);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawPerformanceReceivingMap(canvasEl, passReceptions, recoveries) {
  const { ctx, cw, ch } = _perfSetupCanvas(canvasEl);
  ctx.clearRect(0, 0, cw, ch);
  _perfDrawVerticalPitch(ctx, cw, ch);

  const { px, py } = _perfTransform(cw, ch);

  for (const p of passReceptions) {
    if (!Array.isArray(p) || p.length < 2) continue;
    ctx.beginPath();
    ctx.arc(px(p[1]), py(p[0]), 4.1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(220, 56, 56, 0.88)';
    ctx.fill();
  }

  for (const r of recoveries) {
    if (!Array.isArray(r) || r.length < 2) continue;
    ctx.beginPath();
    ctx.arc(px(r[1]), py(r[0]), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(29, 78, 216, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(17, 24, 39, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawPerformancePassingMap(canvasEl, passSegments) {
  const { ctx, cw, ch } = _perfSetupCanvas(canvasEl);
  ctx.clearRect(0, 0, cw, ch);
  _perfDrawVerticalPitch(ctx, cw, ch);

  const { px, py } = _perfTransform(cw, ch);

  for (const seg of passSegments) {
    if (!seg || !Array.isArray(seg.start) || !Array.isArray(seg.end)) continue;
    const [sx, sy] = seg.start;
    const [ex, ey] = seg.end;
    _perfArrow(ctx, px(sy), py(sx), px(ey), py(ex), 'rgba(37, 99, 235, 0.74)');
  }

  for (const seg of passSegments) {
    if (!seg || !Array.isArray(seg.start)) continue;
    const [sx, sy] = seg.start;
    ctx.beginPath();
    ctx.arc(px(sy), py(sx), 3.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(37, 99, 235, 0.33)';
    ctx.fill();
  }
}
