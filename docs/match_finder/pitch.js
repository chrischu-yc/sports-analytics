/**
 * pitch.js — draws a football formation on a <canvas>.
 *
 * Coordinate system mirrors the Python version:
 *   pitch 120 × 80 units, (0,0) = top-left, x→right, y→down.
 * The canvas is drawn in portrait so the pitch runs top→bottom.
 */

/* ── Position id → [x, y] in pitch coords ── */
const POSITION_COORDS = {
  1:  [8,  40],   // GK
  2:  [20, 75],   // RB
  3:  [20, 55],   // RCB
  4:  [20, 40],   // CB
  5:  [20, 25],   // LCB
  6:  [20, 5],    // LB
  7:  [35, 75],   // RWB
  8:  [35, 5],    // LWB
  9:  [45, 55],   // RDM
  10: [45, 40],   // CDM
  11: [45, 25],   // LDM
  12: [60, 75],   // RM
  13: [60, 55],   // RCM
  14: [60, 40],   // CM
  15: [60, 25],   // LCM
  16: [60, 5],    // LM
  17: [90, 75],   // RW
  18: [80, 55],   // RAM
  19: [80, 40],   // CAM
  20: [80, 25],   // LAM
  21: [90, 5],    // LW
  22: [105, 55],  // RCF
  23: [110, 40],  // ST
  24: [105, 25],  // LCF
  25: [98, 40],   // SS
};

const PITCH_LEN = 120;
const PITCH_WID = 80;

/**
 * Draw the pitch lines on ctx.
 * Canvas is portrait: pitch x → canvas y, pitch y → canvas x.
 * cw = canvas width, ch = canvas height (pitch area only).
 */
function drawPitchLines(ctx, cw, ch) {
  const sx = cw / PITCH_WID;          // scale pitch-y → canvas-x
  const sy = ch / PITCH_LEN;          // scale pitch-x → canvas-y

  const cpx = (v) => v * sx;          // pitch-y → canvas-x
  const cpy = (v) => ch - v * sy;     // pitch-x → canvas-y (flipped: GK at bottom)

  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;

  // Outline
  ctx.strokeRect(0, 0, cw, ch);

  // Halfway line (pitch-x=60 → canvas centre)
  ctx.beginPath(); ctx.moveTo(0, cpy(60)); ctx.lineTo(cw, cpy(60)); ctx.stroke();

  // Centre circle (radius 10)
  ctx.beginPath();
  ctx.arc(cpx(40), cpy(60), 10 * sx, 0, Math.PI * 2);
  ctx.stroke();
  dot(ctx, cpx(40), cpy(60), 3, 'white');

  // Bottom penalty area (GK end, pitch-x 0→18, pitch-y 18→62)
  rect(ctx, cpx(18), cpy(18), cpx(44), ch - cpy(18));
  // Bottom 6-yard box (pitch-x 0→6, pitch-y 30→50)
  rect(ctx, cpx(30), cpy(6), cpx(20), ch - cpy(6));
  // Penalty spot
  // dot(ctx, cpx(40), cpy(12), 3, 'white');
  // D-arc: show only the part outside the box (above the penalty line, canvas-y < cpy(18))
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cw, cpy(18));
  ctx.clip();
  ctx.beginPath();
  ctx.arc(cpx(40), cpy(12), 10 * sx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Top penalty area (attacking end, pitch-x 102→120, pitch-y 18→62)
  rect(ctx, cpx(18), 0, cpx(44), cpy(102));
  // Top 6-yard box (pitch-x 114→120, pitch-y 30→50)
  rect(ctx, cpx(30), 0, cpx(20), cpy(114));
  // Penalty spot
  // dot(ctx, cpx(40), cpy(108), 3, 'white');
  // D-arc: show only the part outside the box (below the penalty line, canvas-y > cpy(102))
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, cpy(102), cw, ch - cpy(102));
  ctx.clip();
  ctx.beginPath();
  ctx.arc(cpx(40), cpy(108), 10 * sx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function rect(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.stroke();
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

/**
 * drawFormation(canvasEl, lineup, formation, teamColor, gkColor)
 *
 * lineup: array of { player_name, jersey_number, position_id, start_reason, end_reason }
 * formation: string like "4-3-3"
 * teamColor: hex or css color for outfield players
 * gkColor:   hex or css color for goalkeeper
 */
function drawFormation(canvasEl, lineup, formation, teamColor, gkColor) {
  const dpr = window.devicePixelRatio || 1;
  if (!canvasEl.dataset.cssW) {
    canvasEl.dataset.cssW = canvasEl.clientWidth || canvasEl.width;
    canvasEl.dataset.cssH = canvasEl.clientHeight || canvasEl.height;
  }
  const cssW = +canvasEl.dataset.cssW;
  const cssH = +canvasEl.dataset.cssH;

  // Scale internal canvas resolution to physical pixels
  canvasEl.width  = cssW * dpr;
  canvasEl.height = cssH * dpr;
  // Lock CSS display size so the element doesn't grow with the buffer
  canvasEl.style.width  = cssW + 'px';
  canvasEl.style.height = cssH + 'px';

  const ctx = canvasEl.getContext('2d');
  ctx.scale(dpr, dpr);   // all drawing coordinates stay in CSS pixels

  // All layout maths use logical (CSS) dimensions
  const lw = cssW;
  const lh = cssH;

  // Pitch background
  ctx.clearRect(0, 0, lw, lh);
  ctx.fillStyle = '#2d7a3a';
  ctx.fillRect(0, 0, lw, lh);

  // Subtle alternating stripes
  for (let band = 0; band < 6; band++) {
    if (band % 2 === 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.fillRect(0, band * lh / 6, lw, lh / 6);
    }
  }

  drawPitchLines(ctx, lw, lh);

  const sx = lw / PITCH_WID;
  const sy = lh / PITCH_LEN;

  const starting = lineup.filter(p => p.start_reason === 'Starting XI');

  for (const player of starting) {
    const coords = POSITION_COORDS[player.position_id];
    if (!coords) continue;
    const [pitchX, pitchY] = coords;
    // portrait: pitch-x → canvas-y (flipped, GK at bottom), pitch-y → canvas-x
    // Shift all players 5 units toward the attacking end (up the canvas)
    const cx = pitchY * sx;
    const cy = lh - (pitchX + 1.5) * sy;
    const isGK = player.position_id === 1;
    const r = isGK ? 14 : 13;
    const color = isGK ? gkColor : teamColor;

    // Player circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Jersey number
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${isGK ? 11 : 10}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.jersey_number, cx, cy);

    // Name: first name (small) + last name (bold), each squished to fit
    const nameParts = (player.player_name || '').split(' ');
    const firstName  = nameParts[0] ?? '';
    const lastName   = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
    const maxNameW   = sx * 22;   // ≈ 22 pitch-y units wide

    // For long names near a sideline, anchor text to the player's inner edge
    // so it grows toward the centre of the pitch instead of off the canvas.
    const nameLen = Math.max(firstName.length, lastName.length);
    const isLongName       = nameLen >= 10;
    const nearLeftSideline  = pitchY <= 10;   // LB, LWB, LW (pitch-y ≈ 5)
    const nearRightSideline = pitchY >= 70;   // RB, RWB, RW (pitch-y ≈ 75)

    let nameAlign, textX;
    if (isLongName && nearLeftSideline) {
      nameAlign = 'left';
      textX = cx - r;   // text starts at the inner edge of the circle
    } else if (isLongName && nearRightSideline) {
      nameAlign = 'right';
      textX = cx + r;   // text ends at the inner edge of the circle
    } else {
      nameAlign = 'center';
      textX = cx;
    }

    ctx.textAlign = nameAlign;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    if (lastName) {
      ctx.font = `8px 'Segoe UI', sans-serif`;
      ctx.fillText(firstName, textX, cy + r + 8, maxNameW);
      ctx.font = `bold 9px 'Segoe UI', sans-serif`;
      ctx.fillText(lastName, textX, cy + r + 18, maxNameW);
    } else {
      ctx.font = `bold 9px 'Segoe UI', sans-serif`;
      ctx.fillText(firstName, textX, cy + r + 13, maxNameW);
    }
    ctx.textAlign = 'center';  // reset for anything drawn after

    // Sub-off arrow
    if (typeof player.end_reason === 'string' && player.end_reason.includes('Substitution')) {
      drawArrow(ctx, cx + r - 2, cy - r + 2, 'down', '#ef4444');
    }
  }

  // Formation label in corner
  if (formation) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(4, 4, 64, 20);
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(formation, 8, 7);
  }
}

function drawArrow(ctx, x, y, dir, color) {
  const size = 8;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  if (dir === 'down') {
    ctx.moveTo(x, y); ctx.lineTo(x - size / 2, y - size); ctx.lineTo(x + size / 2, y - size);
  } else {
    ctx.moveTo(x, y); ctx.lineTo(x - size / 2, y + size); ctx.lineTo(x + size / 2, y + size);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
