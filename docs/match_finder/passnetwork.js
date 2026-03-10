/**
 * passnetwork.js — draws a team passing network on a <canvas>.
 *
 * Algorithm (mirrors passnetwork.ipynb):
 *   1. Only successful passes before the first substitution are used.
 *   2. Each player's average position = mean of all pass-start + pass-end coords
 *      where they are the passer or the recipient.
 *   3. Node size  ∝ number of passes made by that player.
 *   4. Edge width ∝ pass count between a pair (pairs with < 3 passes hidden).
 *   5. Centralisation index = (n·max − total) / (10 · total)
 *
 * Reuses drawPassmapPitch() from passmap.js (must be loaded first).
 */

/**
 * drawPassNetwork(canvasEl, passes, teamColor, nicknames)
 *
 *   passes   – filtered array of:
 *              { player, recipient, location:[x,y], end_location:[x,y] }
 *   teamColor – 6-digit hex e.g. '#e53e3e'
 *   nicknames – { real_name: display_name } map
 *
 * Returns { centralisationIndex } (null when no data).
 */
function drawPassNetwork(canvasEl, passes, teamColor, nicknames) {
  const dpr = window.devicePixelRatio || 1;
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

  const cw = cssW, ch = cssH;
  const sx = cw / 120, sy = ch / 80;

  ctx.clearRect(0, 0, cw, ch);
  drawPassmapPitch(ctx, cw, ch);   // full-pitch landscape from passmap.js

  if (!passes.length) return { centralisationIndex: null };

  // ── Build node data (average position + pass count) ──────────────
  const nodeMap = {};  // real_name → { sumX, sumY, count, passCount }

  const ensureNode = name => {
    if (!nodeMap[name]) nodeMap[name] = { sumX: 0, sumY: 0, count: 0, passCount: 0 };
  };

  for (const p of passes) {
    if (!p.player || !p.recipient || !p.location || !p.end_location) continue;
    ensureNode(p.player);
    ensureNode(p.recipient);

    const [x1, y1] = p.location;
    const [x2, y2] = p.end_location;

    nodeMap[p.player].sumX    += x1;
    nodeMap[p.player].sumY    += y1;
    nodeMap[p.player].count++;
    nodeMap[p.player].passCount++;

    nodeMap[p.recipient].sumX += x2;
    nodeMap[p.recipient].sumY += y2;
    nodeMap[p.recipient].count++;
  }

  const nodes = {};
  for (const [name, d] of Object.entries(nodeMap)) {
    if (d.count === 0) continue;
    nodes[name] = {
      x: d.sumX / d.count,
      y: d.sumY / d.count,
      passCount: d.passCount,
      display: nicknames[name] ?? name,
    };
  }

  // ── Build edge data ───────────────────────────────────────────────
  const edgeMap = {};  // sorted_key → count
  for (const p of passes) {
    if (!p.player || !p.recipient) continue;
    const key = [p.player, p.recipient].sort().join('||');
    edgeMap[key] = (edgeMap[key] || 0) + 1;
  }

  // ── Scale helpers ─────────────────────────────────────────────────
  const maxPassCount = Math.max(...Object.values(nodes).map(n => n.passCount), 1);
  const maxEdge = Math.max(...Object.values(edgeMap), 1);

  const hexR = parseInt(teamColor.slice(1, 3), 16);
  const hexG = parseInt(teamColor.slice(3, 5), 16);
  const hexB = parseInt(teamColor.slice(5, 7), 16);

  // ── Draw edges ────────────────────────────────────────────────────
  for (const [key, count] of Object.entries(edgeMap)) {
    if (count < 3) continue;
    const [n1, n2] = key.split('||');
    const a = nodes[n1], b = nodes[n2];
    if (!a || !b) continue;

    ctx.beginPath();
    ctx.moveTo(a.x * sx, a.y * sy);
    ctx.lineTo(b.x * sx, b.y * sy);
    ctx.strokeStyle = `rgba(${hexR},${hexG},${hexB},0.45)`;
    ctx.lineWidth = Math.max(1.5, (count / maxEdge) * 9);
    ctx.stroke();
  }

  // ── Draw nodes ────────────────────────────────────────────────────
  const hits = [];
  for (const [name, node] of Object.entries(nodes)) {
    const cx = node.x * sx;
    const cy = node.y * sy;
    const r  = Math.max(12, Math.min(24, 12 + (node.passCount / maxPassCount) * 12));
    hits.push({ cx, cy, r, name });

    // Node circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${hexR},${hexG},${hexB},0.88)`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Label: mirrors player_name_split() from passnetwork.ipynb
    // 1 word  → show it; 2 words → last name; 3+ words → everything after first name
    const parts = node.display.split(' ');
    const label = parts.length <= 1
      ? parts[0]
      : parts.slice(1).join(' ');
    const fontSize = Math.max(8, Math.round(r * 0.62));
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy, r * 1.8);  // maxWidth keeps long names in bounds
  }

  // ── Centralisation index (matches notebook formula) ───────────────
  const passCounts = Object.values(nodes).map(n => n.passCount);
  const totalPasses = passCounts.reduce((s, v) => s + v, 0);
  const maxPasses   = Math.max(...passCounts);
  const nominator   = passCounts.reduce((s, v) => s + (maxPasses - v), 0);
  const denominator = 10 * totalPasses;
  const centralisationIndex = denominator > 0 ? nominator / denominator : null;

  return { centralisationIndex, nodes, edgeMap, hits };
}
