'use strict';
// In-play tournament model: parse ESPN live scoring, then simulate only the holes
// each player still has to play. Pure functions, shared by the dashboard and tests.
(root => {
  const HOLES = 18;
  const toPar = text => {
    if (text === 'E') return 0;
    const value = Number(String(text ?? '').replace('+', ''));
    return Number.isFinite(value) ? value : null;
  };

  function teeTime(round) {
    const stats = round.statistics?.categories?.[0]?.stats || [];
    const text = stats.length ? stats[stats.length - 1].displayValue : '';
    const match = /(\d{1,2}):(\d{2}):\d{2} ([A-Z]{2,4})/.exec(text || '');
    if (!match) return '';
    const hour = Number(match[1]);
    return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'} ${match[3]}`;
  }

  // Each player's holes in play order, as strokes relative to par.
  function parseEvent(event, rounds = 4) {
    const competition = event.competitions?.[0] || {};
    const players = (competition.competitors || []).filter(c => c.id && c.athlete?.displayName).map(c => {
      const entries = (c.linescores || []).filter(r => r.period >= 1 && r.period <= rounds).sort((a, b) => a.period - b.period);
      const holes = [], roundEnds = [];
      let current = null;
      for (const r of entries) {
        const played = (r.linescores || []).filter(h => typeof h.value === 'number');
        const parsed = played.map(h => toPar(h.scoreType?.displayValue));
        if (played.length && parsed.every(v => v !== null)) holes.push(...parsed);
        else if (typeof r.value === 'number' && toPar(r.displayValue) !== null) {
          // Completed round without hole detail: spread its score evenly.
          for (let i = 0; i < HOLES; i++) holes.push(toPar(r.displayValue) / HOLES);
        }
        if (holes.length - (roundEnds.at(-1)?.hole || 0) >= HOLES) roundEnds.push({hole: holes.length, round: r.period});
        else current = {round: r.period, thru: holes.length - (roundEnds.at(-1)?.hole || 0), tee: teeTime(r)};
      }
      return {id: String(c.id), name: c.athlete.displayName, order: c.order, official: toPar(c.score),
        holes, roundEnds, lastRound: entries.length ? entries.at(-1).period : 0, current};
    });
    const status = event.status?.type || {};
    return {id: String(event.id), name: event.name, rounds, players, state: status.state, completed: !!status.completed,
      detail: competition.status?.type?.detail || status.detail || status.description || '',
      period: competition.status?.period || 0, maxRound: Math.max(0, ...players.map(p => p.lastRound))};
  }

  // Tournament state after `upTo` holes per player (Infinity = live now).
  function stateAt(parsed, upTo = Infinity) {
    const total = HOLES * parsed.rounds;
    const states = parsed.players.map(p => {
      const played = Math.min(upTo, p.holes.length);
      let score = 0;
      for (let i = 0; i < played; i++) score += p.holes[i];
      if (upTo === Infinity && p.official !== null && p.holes.length) score = p.official;
      // Players with an entry for the latest round are still playing; others missed the cut or withdrew.
      const alive = p.lastRound === parsed.maxRound || p.lastRound * HOLES > upTo;
      const rounds = [];
      let start = 0;
      for (const end of p.roundEnds) {
        if (end.hole > played) break;
        rounds.push({round: end.round, toPar: p.holes.slice(start, end.hole).reduce((a, b) => a + b, 0)});
        start = end.hole;
      }
      return {id: p.id, name: p.name, toPar: score, played, alive, remaining: alive ? Math.max(0, total - played) : 0, rounds};
    });
    // Center completed rounds on that round's field so this week's play can update skill.
    const byRound = new Map();
    states.forEach(s => s.rounds.forEach(r => byRound.set(r.round, [...(byRound.get(r.round) || []), r.toPar])));
    const roundMean = new Map([...byRound].map(([round, values]) => [round, values.reduce((a, b) => a + b, 0) / values.length]));
    const holesPlayed = states.reduce((sum, s) => sum + s.played, 0);
    const strokes = states.reduce((sum, s) => sum + (s.played ? s.toPar : 0), 0);
    states.forEach(s => {
      s.weekRounds = s.rounds.length;
      s.weekSum = s.rounds.reduce((sum, r) => sum + r.toPar - roundMean.get(r.round), 0);
    });
    return {states, fieldHole: holesPlayed ? strokes / holesPlayed : 0, upTo};
  }

  function gauss(random) {
    const u = 1 - random(), v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // means: expected strokes per round relative to the field; sigmas: round standard deviation.
  function simulate(state, means, sigmas, count, random = Math.random, topN = 10) {
    const live = state.states.map((s, i) => i).filter(i => state.states[i].alive);
    const wins = new Array(state.states.length).fill(0), top = new Array(state.states.length).fill(0);
    const projected = state.states.map((s, i) => s.alive ? s.toPar + s.remaining * (state.fieldHole + means[i] / HOLES) : null);
    const spread = state.states.map((s, i) => sigmas[i] * Math.sqrt(s.remaining / HOLES));
    const scores = new Float64Array(state.states.length);
    let playoffs = 0;
    for (let t = 0; t < count && live.length; t++) {
      let best = Infinity;
      for (const i of live) { scores[i] = projected[i] + spread[i] * gauss(random); if (scores[i] < best) best = scores[i]; }
      let tied = live.filter(i => scores[i] - best < 1e-9);
      if (tied.length > 1) {
        playoffs++;
        // Sudden death: replay single holes until one player is lowest.
        for (let hole = 0; tied.length > 1 && hole < 20; hole++) {
          const strokes = tied.map(i => means[i] / HOLES + sigmas[i] / Math.sqrt(HOLES) * gauss(random));
          const low = Math.min(...strokes);
          tied = tied.filter((i, k) => strokes[k] === low);
        }
        // Identical players after 20 holes: pick one uniformly.
        if (tied.length > 1) tied = [tied[Math.min(tied.length - 1, Math.floor(random() * tied.length))]];
      }
      wins[tied[0]]++;
      if (topN) {
        const sorted = live.map(i => scores[i]).sort((a, b) => a - b);
        const cutoff = sorted[Math.min(topN, sorted.length) - 1];
        for (const i of live) if (scores[i] <= cutoff + 1e-9) top[i]++;
      }
    }
    return {count, wins, top, projected, playoffs,
      win: wins.map(w => count ? w / count : 0), topProbability: top.map(w => count ? w / count : 0)};
  }

  // Positions by score to par, with ties shown as T3.
  function positions(state) {
    const scores = state.states.filter(s => s.alive).map(s => s.toPar);
    return state.states.map(s => {
      if (!s.alive) return s.played < HOLES * 2 ? 'WD' : 'CUT';
      const ahead = scores.filter(v => v < s.toPar).length, same = scores.filter(v => v === s.toPar).length;
      return (same > 1 ? 'T' : '') + (ahead + 1);
    });
  }

  // Checkpoints every `step` holes that every remaining player has reached, plus now.
  function checkpoints(parsed, step = 6) {
    const now = stateAt(parsed);
    const alive = now.states.filter(s => s.alive);
    if (!alive.length) return [];
    const floor = Math.min(...alive.map(s => s.played));
    const points = [];
    for (let h = 0; h <= floor; h += step) points.push(h);
    const average = alive.reduce((sum, s) => sum + s.played, 0) / alive.length;
    if (average > points.at(-1)) points.push(Infinity);
    return points.map(h => ({holes: h === Infinity ? average : h, state: h === Infinity ? now : stateAt(parsed, h)}));
  }

  // Score to par: whole strokes by default, or fixed decimals for projections.
  const formatToPar = (value, digits = 0) => {
    if (value === null || value === undefined) return '—';
    const text = Math.abs(value).toFixed(digits);
    return Number(text) === 0 ? 'E' : (value > 0 ? '+' : '-') + text;
  };
  root.GolfLive = {HOLES, toPar, parseEvent, stateAt, simulate, positions, checkpoints, formatToPar, gauss};
})(typeof globalThis !== 'undefined' ? globalThis : this);
