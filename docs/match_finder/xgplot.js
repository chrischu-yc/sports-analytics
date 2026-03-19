/**
 * xgplot.js — renders a cumulative xG line chart on a canvas.
 *
 * Shows xG progression over the match with goal markers and player labels.
 */

function drawXGPlot(canvasEl, homeTeam, awayTeam, homeTeamShots, awayTeamShots, matchDuration) {
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

  const w = cssW, h = cssH;
  const margin = { top: 40, right: 40, bottom: 60, left: 60 };
  const chartW = w - margin.left - margin.right;
  const chartH = h - margin.top - margin.bottom;

  // Background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  // Grid: use stronger major lines and lighter minor lines for readability
  const drawGridLine = (x1, y1, x2, y2, isMajor) => {
    ctx.beginPath();
    ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.16)';
    ctx.lineWidth = isMajor ? 1.25 : 0.9;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  // Vertical grid lines (every 10 minutes, emphasize every 30)
  for (let m = 0; m <= matchDuration; m += 10) {
    const x = margin.left + (m / matchDuration) * chartW;
    drawGridLine(x, margin.top, x, margin.top + chartH, m % 30 === 0);
  }

  // Calculate max xG for scaling
  const homeMaxXG = homeTeamShots.length > 0 
    ? homeTeamShots.map(s => s.cumXG).reduce((a, b) => Math.max(a, b), 0)
    : 1;
  const awayMaxXG = awayTeamShots.length > 0
    ? awayTeamShots.map(s => s.cumXG).reduce((a, b) => Math.max(a, b), 0)
    : 1;
  const maxXG = Math.max(homeMaxXG, awayMaxXG, 1);
  const yMax = Math.ceil(maxXG + 0.5);

  // Horizontal grid lines (every 0.5 xG, emphasize whole-number ticks)
  for (let xg = 0; xg <= yMax; xg += 0.5) {
    const y = margin.top + chartH - (xg / yMax) * chartH;
    const isMajor = Number.isInteger(xg);
    drawGridLine(margin.left, y, margin.left + chartW, y, isMajor);
  }

  // Axes
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + chartH);
  ctx.lineTo(margin.left + chartW, margin.top + chartH);
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = '#aaa';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';

  // X-axis (minutes)
  for (let m = 0; m <= matchDuration; m += 10) {
    const x = margin.left + (m / matchDuration) * chartW;
    ctx.fillText(m + "'", x, margin.top + chartH + 20);
  }

  // Y-axis label
  ctx.save();
  ctx.translate(20, margin.top + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('Cumulative xG', 0, 0);
  ctx.restore();

  // Y-axis ticks  
  ctx.textAlign = 'right';
  for (let xg = 0; xg <= yMax; xg += 1) {
    const y = margin.top + chartH - (xg / yMax) * chartH;
    ctx.fillText(xg.toFixed(1), margin.left - 10, y + 4);
  }

  // Helper to scale coordinates
  const scaleX = (minute) => margin.left + (minute / matchDuration) * chartW;
  const scaleY = (xg) => margin.top + chartH - (xg / yMax) * chartH;

  // Draw step curves for each team
  const colors = { home: '#60a5fa', away: '#ef4444' };
  const hits = [];

  const drawTeamCurve = (shots, color) => {
    if (shots.length === 0) return;

    // Build step data: start at (0,0), then each shot minute
    const stepX = [0, ...shots.map(s => s.minute), matchDuration];
    const stepY = [0, ...shots.map(s => s.cumXG), shots[shots.length - 1].cumXG];

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(scaleX(stepX[0]), scaleY(stepY[0]));

    for (let i = 1; i < stepX.length; i++) {
      // Horizontal line to next shot
      ctx.lineTo(scaleX(stepX[i]), scaleY(stepY[i - 1]));
      // Vertical line up to new cumulative xG
      ctx.lineTo(scaleX(stepX[i]), scaleY(stepY[i]));
    }
    ctx.stroke();
  };

  drawTeamCurve(homeTeamShots, colors.home);
  drawTeamCurve(awayTeamShots, colors.away);

  // Draw goal markers (stars) with labels
  const drawGoalMarker = (shots, color) => {
    for (const shot of shots) {
      if (!shot.isGoal) continue;

      const x = scaleX(shot.minute);
      const y = scaleY(shot.cumXG);
      hits.push({ cx: x, cy: y, r: 10, shot });

      // Draw star
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      _drawStar(ctx, x, y, 8);

      // Label: extract last name (same format as pass network)
      const displayName = shot.playerDisplay || shot.player;
      const parts = displayName.split(' ');
      const lastname = parts.length <= 1 ? parts[0] : parts.slice(1).join(' ');
      const ogTag = shot.isOwnGoal ? 'OG ' : '';
      const label = `${Math.floor(shot.minute)}' ${ogTag}${lastname}`;

      // Always place labels top-left of the goal marker for both teams.
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 3;
      ctx.strokeText(label, x - 10, y - 10);
      ctx.fillStyle = color;
      ctx.fillText(label, x - 10, y - 10);
    }
  };

  drawGoalMarker(homeTeamShots, colors.home);
  drawGoalMarker(awayTeamShots, colors.away);

  return { hits };
}

// Helper function to draw a 5-pointed star
function _drawStar(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Renders xG summary info and probabilities
 * @param {string} summaryId - ID of summary container
 * @param {string} homeName - home team name
 * @param {string} awayName - away team name
 * @param {number} homeGoals - goals scored by home team
 * @param {number} awayGoals - goals scored by away team
 * @param {number} homeXG - total xG for home team
 * @param {number} awayXG - total xG for away team
 * @param {number} homeShots - number of shots by home team
 * @param {number} awayShots - number of shots by away team
 * @param {number} homeWinProb - probability of home win
 * @param {number} drawProb - probability of draw
 * @param {number} awayWinProb - probability of away win
 */
function renderXGSummary(summaryId, homeName, awayName, homeGoals, awayGoals, homeXG, awayXG, homeShots, awayShots, homeWinProb, drawProb, awayWinProb) {
  const html = `
    <div class="xg-summary">
      <div class="xg-score">
        <div class="xg-team xg-home">
          <div class="xg-team-name">${homeName}</div>
          <div class="xg-goals">${homeGoals}</div>
          <div class="xg-stat"><strong>${homeXG.toFixed(2)}</strong> xG · <strong>${homeShots}</strong> shots</div>
        </div>
        <div class="xg-divider">vs</div>
        <div class="xg-team xg-away">
          <div class="xg-team-name">${awayName}</div>
          <div class="xg-goals">${awayGoals}</div>
          <div class="xg-stat"><strong>${awayXG.toFixed(2)}</strong> xG · <strong>${awayShots}</strong> shots</div>
        </div>
      </div>
      <div class="xg-probs">
        <span class="xg-prob xg-home-prob"><strong>${(homeWinProb * 100).toFixed(2)}%</strong> Home Win</span>
        <span class="xg-prob xg-draw-prob"><strong>${(drawProb * 100).toFixed(2)}%</strong> Draw</span>
        <span class="xg-prob xg-away-prob"><strong>${(awayWinProb * 100).toFixed(2)}%</strong> Away Win</span>
      </div>
    </div>
  `;
  document.getElementById(summaryId).innerHTML = html;
}
