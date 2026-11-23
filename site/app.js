'use strict';
(() => {
  const el = id => document.getElementById(id);
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  let forecast, ranking, fields = [], resultMeta;
  const weights = new Map(), weightInputs = new Map();
  let customFields = [], customCount = 0;
  const pct = value => (100 * value).toFixed(2) + '%';
  const format = number => Number(number).toLocaleString();
  const input = id => Number(el(id).value);
  const signed = value => (value > 0 ? '+' : '') + value.toFixed(2);
  const STORAGE_KEY = 'golf-lab-custom-fields-v1';
  const GROUPS = [
    ['strokes_gained', 'Season strokes gained', 'Multiplier on strokes gained per round relative to this field. 1× counts every stroke gained in full.'],
    ['form', 'Recent form · last 5 starts', 'Multiplier on recent strokes gained per round relative to this field.'],
    ['traditional', 'Traditional stats', 'Strokes per round for a player one standard deviation better than this field.'],
    ['course_fit', 'Course fit', "Strokes per round for one standard deviation better on PGA Tour's course-fit score."],
  ];
  const PRESETS = {
    history: {skill: 1, weights: {}, description: 'Recommended baseline: use saved score history. All extra stats stay at zero to avoid counting the same skill twice.'},
    hard: {skill: 0.5, weights: {sg_app: 0.7, sg_arg: 0.3, sg_ott: 0.4}, description: 'What if the course plays hard? This hypothesis favors approach play, recovery and tee shots. It changes relative player strengths, not scoring relative to par; difficulty alone does not imply more upsets.'},
    birdies: {skill: 0.5, weights: {sg_app: 0.5, sg_putt: 0.3, birdie_average: 0.15}, description: 'What if it becomes a birdie contest? Modestly favor approach play, putting and birdie production. These inputs overlap; treat this as an experiment.'},
    rookie: {skill: 0.5, settings: {prior: 30, adjustment: -0.3, 'player-volatility': 1.2}, weights: {}, description: 'What if a rookie contends? Choose a player you know is a rookie under Player adjustments. Give that player a hypothetical −0.3 strokes per round and 1.2× uncertainty; use 30 prior rounds to temper short histories. The snapshot has no rookie labels. This cannot predict whether a rookie enters or tees off, and low prior rounds do not establish rookie status.'},
    sg: {skill: 0.5, weights: {sg_ott: 0.5, sg_app: 0.5, sg_arg: 0.5, sg_putt: 0.3}},
    ballstriking: {skill: 0.5, weights: {sg_ott: 0.7, sg_app: 0.8, sg_arg: 0.3, sg_putt: 0.1}},
    form: {skill: 0.5, weights: {form_sg_ott: 0.4, form_sg_app: 0.4, form_sg_arg: 0.4, form_sg_putt: 0.2}},
  };

  const STAT_GUIDE = {
    ott: ['Tee-shot performance, including distance and accuracy.', '0.3–0.5× in a blend; try 0.7× for a ball-striking hypothesis.'],
    app: ['Iron and approach-shot performance.', '0.4–0.5× in a blend; try 0.7–0.8× when approach play matters more.'],
    arg: ['Recovery shots around the green, excluding putts.', '0.2–0.3× in a blend.'],
    putt: ['Performance on the greens.', '0.1–0.3× in a blend to limit sensitivity to putting swings.'],
    total: ['All strokes-gained categories combined.', 'Start at 0; try 0.5× instead of individual categories, never on top of them.'],
    t2g: ['Off-the-tee, approach and around-the-green combined.', 'Start at 0; try 0.5× instead of those three categories.'],
    driving_distance: ['Average measured tee-shot distance; higher is better.', 'Start at 0; try 0.1–0.2 strokes/SD for a distance hypothesis.'],
    driving_accuracy: ['Share of measured fairways hit; higher is better.', 'Start at 0; try 0.1–0.2 strokes/SD for a fairway hypothesis.'],
    gir: ['Share of greens reached in regulation; higher is better.', 'Start at 0; try 0.1–0.2 strokes/SD instead of extra approach weight.'],
    scrambling: ['Par-or-better rate after missing a green in regulation; higher is better.', 'Start at 0; try 0.1–0.2 strokes/SD instead of extra recovery weight.'],
    birdie_average: ['Birdies made per round; higher is better.', 'Start at 0; try 0.15 strokes/SD for a birdie contest.'],
    bogey_rate: ['Share of holes ending in bogey; lower is better.', 'Start at 0; try 0.1–0.2 strokes/SD for bogey avoidance.'],
    scoring_average: ['Adjusted scoring average; lower is better.', 'Keep at 0 with score history; try 0.2 strokes/SD only as an alternative.'],
    course_fit: ['PGA Tour’s event-specific fit rating; lower is better.', 'Start at 0; try 0.1–0.2 strokes/SD as a small course-fit overlay.'],
  };
  function statGuide(field) {
    const recent = field.key.startsWith('form_');
    const key = field.key.replace(/^form_sg_|^sg_/, '');
    const guide = STAT_GUIDE[key] || ['Difference from the field average.', 'Start at 0; try a small weight.'];
    return guide[0] + (recent ? ' Measured over the last five starts. Start at 0; try 0.2–0.4× instead of the matching season stat (0.1–0.2× for putting).' : ' Suggested experiment: ' + guide[1]);
  }
  function presetDescription(name) {
    el('preset-help').textContent = PRESETS[name]?.description || ({sg: 'Balanced experiment: reduce score history to 0.5× and add season strokes gained. Category weights are illustrative, not fitted.', ballstriking: 'Favor tee shots and approaches; reduce putting influence. A hypothesis to compare with the baseline.', form: 'Favor the last five starts rather than season stats. Short samples can swing substantially.'}[name]) || 'Custom assumptions. Compare your results with the score-history baseline.';
  }

  function normalizeName(name) {
    return String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/'/g, '')
      .replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w && !['jr', 'sr', 'ii', 'iii', 'iv'].includes(w)).join(' ');
  }
  // Mean and standard deviation over players with a value; missing players are treated as field average.
  function summarize(values) {
    const present = values.filter(v => typeof v === 'number' && Number.isFinite(v));
    if (!present.length) return {mean: 0, sd: 0, count: 0};
    const mean = present.reduce((a, b) => a + b, 0) / present.length;
    const sd = Math.sqrt(present.reduce((a, b) => a + (b - mean) ** 2, 0) / present.length);
    return {mean, sd, count: present.length};
  }
  const perStroke = field => field.unit === 'strokes/round';
  function fieldEffect(field, value, weight) {
    if (!weight || typeof value !== 'number' || !Number.isFinite(value)) return 0;
    const better = (field.higher_is_better ? 1 : -1) * (value - field.mean);
    const strokes = perStroke(field) ? better : (field.sd ? better / field.sd : 0);
    return -weight * strokes; // Negative is a better expected score.
  }
  function statEffects(player) {
    const effects = fields.map(f => ({field: f, value: player.stats?.[f.key], effect: fieldEffect(f, player.stats?.[f.key], weights.get(f.key))}));
    customFields.forEach(f => effects.push({field: f, value: f.values[player.id], effect: fieldEffect(f, f.values[player.id], f.weight), custom: true}));
    return effects;
  }
  function historyEstimate(player) {
    const denominator = player.prior_rounds + input('prior');
    return input('skill') * (denominator ? player.round_sum / denominator : 0);
  }
  function adjustment(player) { return player.id === el('player').value ? input('adjustment') : 0; }
  function estimate(player) {
    return historyEstimate(player) + statEffects(player).reduce((sum, e) => sum + e.effect, 0) + adjustment(player);
  }
  function assumption(id) { return forecast.players.find(p => p.id === id); }
  function formatValue(field, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    if (field.unit === '%' || field.unit === '% of holes') return value.toFixed(1) + '%';
    if (field.unit === 'yards') return value.toFixed(1) + ' yds';
    return perStroke(field) ? signed(value) : value.toFixed(2);
  }

  function detail() {
    const p = assumption(el('player').value); if (!p) return;
    const effects = statEffects(p), history = historyEstimate(p);
    const statTotal = effects.reduce((sum, e) => sum + e.effect, 0), mean = history + statTotal + input('adjustment');
    const rounds = p.stats?.sg_rounds ? ` and ${p.stats.sg_rounds} strokes-gained measured rounds this season` : '';
    el('player-detail').textContent = `${p.name} has ${format(p.prior_rounds)} recorded prior rounds${rounds}. The sum of their scores relative to their round fields is ${p.round_sum.toFixed(1)} strokes.`;
    const historyText = p.prior_rounds + input('prior') === 0
      ? 'No prior rounds, so history starts at field average (0.00)'
      : `History: ${input('skill').toFixed(1)} × ${p.round_sum.toFixed(1)} ÷ (${p.prior_rounds} historical + ${input('prior')} prior rounds) = ${history.toFixed(2)}`;
    el('formula').textContent = `${historyText} · Stats and custom fields: ${signed(statTotal)} · Adjustment: ${signed(input('adjustment'))} → ${mean.toFixed(2)} strokes per round relative to the field. Negative is better.`;
    const table = el('player-stats'); table.replaceChildren();
    const header = make('div', 'stat-row stat-head');
    ['Field', p.name, 'Field avg', 'Effect'].forEach(text => header.append(make('span', '', text)));
    table.append(header);
    effects.forEach(e => {
      const row = make('div', 'stat-row' + (e.effect ? ' weighted' : ''));
      row.append(make('span', '', e.field.label), make('span', '', formatValue(e.field, e.value)),
        make('span', '', e.field.count ? formatValue(e.field, e.field.mean) : '—'), make('span', 'effect', e.effect ? signed(e.effect) : '·'));
      table.append(row);
    });
  }
  // Explain stored result inputs, never the sliders that may have changed since a run.
  function explainResult() {
    if (!resultMeta || !ranking.length) return;
    const top = ranking[0], next = ranking[1], box = el('winner-math');
    box.replaceChildren();
    el('winner-reason').textContent = resultMeta.saved
      ? `${top.name} leads the saved forecast with ${pct(top.probability)} win probability across ${format(resultMeta.count)} simulations.`
      : `${top.name} leads because they won ${format(top.wins)} of ${format(resultMeta.count)} simulated tournaments: ${format(top.wins)} ÷ ${format(resultMeta.count)} × 100 = ${pct(top.probability)}.`;
    if (next) box.append(make('p', '', `Next: ${next.name}, ${pct(next.probability)}. Players are ranked by simulated wins, not by a language model. Equal win counts are ordered alphabetically; they are tied in probability.`));
    box.append(make('h3', '', '1. Estimate expected strokes per round'));
    box.append(make('p', 'math-line', `μ = history influence × score sum ÷ (recorded rounds + prior rounds) + stat effects + player adjustment`));
    box.append(make('p', 'math-line', `${top.name}: ${top.historyWeight.toFixed(2)} × ${top.roundSum.toFixed(4)} ÷ (${top.rounds} + ${top.prior}) = ${signed(top.history)} history strokes/round.`));
    if (!top.rounds && !top.prior) box.append(make('p', '', 'With no recorded or prior rounds, history is defined as zero rather than dividing by zero.'));
    top.terms.forEach(term => box.append(make('p', 'math-line', term)));
    box.append(make('p', 'math-line', `μ = ${signed(top.history)} history + ${signed(top.statTotal)} stats + ${signed(top.adjustment)} adjustment = ${signed(top.skill)} strokes/round relative to the field. Negative is better. Displayed values are rounded; calculations use full precision.`));
    box.append(make('h3', '', '2. Draw a four-round tournament score'));
    box.append(make('p', 'math-line', `Score = 4μ + σZ = ${(4 * top.skill).toFixed(4)} + ${top.sigma.toFixed(4)} × Z; σ = √4 × ${resultMeta.volatility.toFixed(2)} round variation × ${top.multiplier.toFixed(2)} player multiplier.`));
    box.append(make('p', '', 'Z is a fresh standard normal random draw for each player and tournament. Four independent rounds give a total mean of 4μ and a standard deviation of √4 times the round variation. Scores are relative to the field, not to par. The lowest drawn score wins each trial; exact score ties go to the first player in snapshot order.'));
    box.append(make('p', 'math-line', 'Random draw: Z = √(−2 ln U) × cos(2πV), where U = 1 − random() and V = random(). Each player gets independent draws.'));
    box.append(make('h3', '', '3. Count wins across tournaments'));
    box.append(make('p', 'math-line', 'Win probability = simulated wins ÷ completed tournaments. The forecast leader has the highest estimated probability, not a guaranteed victory.'));
    if (resultMeta.sample) {
      const [winner, runner] = resultMeta.sample;
      box.append(make('h3', '', 'Actual final trial from this run'));
      box.append(make('p', 'math-line', `${winner.name}: ${winner.mean.toFixed(4)} + ${winner.sigma.toFixed(4)} × (${winner.z.toFixed(4)}) = ${winner.score.toFixed(4)} strokes.`));
      if (runner) box.append(make('p', '', `Runner-up ${runner.name}: ${runner.score.toFixed(4)} strokes. ${winner.name} won this trial with the lowest score among all ${forecast.players.length} players. A single trial winner can differ from the overall forecast leader.`));
    } else box.append(make('p', '', 'Individual trial draws were not stored in the saved forecast. Run a new simulation to see a real trial example.'));
    box.append(make('p', 'help', 'This explanation is assembled directly from numeric model inputs and simulation counts. No LLM or generated reasoning is used. Random sampling causes small differences between runs; the model does not simulate cuts or playoffs.'));
  }
  function resultInputs(player, saved = false) {
    const historyWeight = saved ? 1 : input('skill'), prior = saved ? 20 : input('prior');
    const history = historyWeight * (player.prior_rounds + prior ? player.round_sum / (player.prior_rounds + prior) : 0);
    const effects = saved ? [] : statEffects(player).filter(e => (e.custom ? e.field.weight : weights.get(e.field.key)));
    const terms = effects.map(e => {
      const f = e.field, weight = e.custom ? f.weight : weights.get(f.key);
      if (typeof e.value !== 'number' || !Number.isFinite(e.value)) return `${f.label}: missing value → 0 effect (field average).`;
      const scale = perStroke(f) ? '' : ` ÷ ${f.sd.toFixed(4)} SD`;
      if (!perStroke(f) && !f.sd) return `${f.label}: no spread in values → 0 effect.`;
      return `${f.label}: −${weight.toFixed(2)} × ${f.higher_is_better ? '1' : '(−1)'} × (${e.value.toFixed(4)} − ${f.mean.toFixed(4)})${scale} = ${signed(e.effect)} strokes/round.`;
    });
    const multiplier = saved ? 1 : (player.id === el('player').value ? input('player-volatility') : 1);
    return {historyWeight, prior, history, rounds: player.prior_rounds, roundSum: player.round_sum, terms,
      statTotal: effects.reduce((sum, e) => sum + e.effect, 0), adjustment: saved ? 0 : adjustment(player),
      multiplier, sigma: 2 * (saved ? 2.8 : input('volatility')) * multiplier};
  }

  function draw() {
    const chart = el('chart'); chart.replaceChildren();
    const displayed = ranking.slice(0, input('show'));
    displayed.forEach((p, index) => {
      const player = forecast.players.find(player => player.name === p.name);
      const row = make('tr', 'forecast-row');
      row.append(make('td', 'rank', String(index + 1)), make('th', 'player-name', p.name),
        make('td', 'numeric', format(player.prior_rounds)),
        make('td', 'numeric', signed(p.skill ?? estimate(player))),
        make('td', 'numeric prob', pct(p.probability)));
      row.children[1].scope = 'row'; chart.append(row);
    });
    explainResult();
  }

  function changed(message) { el('math-status').textContent = 'Settings changed. The explanation still describes the displayed results; run the simulation to update both.'; detail(); el('status').textContent = message || 'Assumptions changed. Run the simulation to update results.'; if (liveData) el('live-status').textContent = 'Settings changed. Live odds use them after the next refresh or simulation run.'; }

  function weightControl(id, label, value, max, onInput, note) {
    const wrap = make('div', 'weight');
    const lab = make('label'); lab.htmlFor = id;
    const out = make('strong', '', value.toFixed(2) + (note ? '' : '×')); out.id = id + '-value';
    lab.append(make('span', '', label), out);
    const range = make('input'); range.type = 'range'; range.id = id; range.min = '0'; range.max = String(max); range.step = '0.05'; range.value = String(value);
    range.addEventListener('input', () => { out.textContent = Number(range.value).toFixed(2) + (note ? '' : '×'); onInput(Number(range.value)); });
    wrap.append(lab, range);
    return {wrap, range, out, note};
  }
  function setWeight(key, value) {
    weights.set(key, value);
    const control = weightInputs.get(key); if (!control) return;
    control.range.value = String(value); control.out.textContent = value.toFixed(2) + (control.note ? '' : '×');
  }
  function buildStatControls() {
    const box = el('stat-weights'); box.replaceChildren();
    if (!fields.length) { box.append(make('p', 'help', 'This snapshot has no strokes-gained data. Re-export it with stats to enable these fields.')); return; }
    GROUPS.forEach(([group, title, help]) => {
      const groupFields = fields.filter(f => f.group === group); if (!groupFields.length) return;
      const section = make('details', 'stat-group'); section.append(make('summary', '', title), make('p', 'help', help));
      groupFields.forEach(f => {
        const note = perStroke(f) ? '' : ' strokes/SD';
        const control = weightControl('w-' + f.key, `${f.label} (${f.count}/${forecast.players.length})`, 0, perStroke(f) ? 1.5 : 1,
          value => { weights.set(f.key, value); el('preset').value = 'custom'; presetDescription('custom'); changed(); }, note);
        if (note) control.wrap.append(make('span', 'unit', 'strokes per round per SD'));
        const guide = make('p', 'help stat-guide', statGuide(f)); guide.id = 'guide-' + f.key;
        control.range.setAttribute('aria-describedby', guide.id);
        control.wrap.append(guide);
        if (f.description) control.wrap.append(make('p', 'help', f.description));
        weightInputs.set(f.key, control); section.append(control.wrap);
      });
      box.append(section);
    });
  }
  function applyPreset(name) {
    const preset = PRESETS[name]; if (!preset) return;
    fields.forEach(f => setWeight(f.key, preset.weights[f.key] || 0));
    const defaults = {volatility: 2.8, prior: 20, adjustment: 0, 'player-volatility': 1};
    Object.entries({...defaults, ...preset.settings}).forEach(([id, value]) => { el(id).value = value; showSlider(id); });
    customFields.forEach(f => { f.weight = 0; }); renderCustomFields(); saveCustomFields();
    presetDescription(name);
    if (name === 'rookie') el('player-adjustments').open = true;
    el('skill').value = preset.skill; el('skill-value').textContent = Number(preset.skill).toFixed(1);
  }

  function parseCustomValues(text) {
    const byName = new Map(forecast.players.map(p => [normalizeName(p.name), p.id]));
    const values = {}, unmatched = [];
    String(text).split(/\r?\n/).forEach(line => {
      const match = line.trim().match(/^(.*?)[,\t;]\s*(-?\d+(?:\.\d+)?)\s*$/); if (!match) return;
      const id = byName.get(normalizeName(match[1]));
      if (id) values[id] = Number(match[2]); else unmatched.push(match[1].trim());
    });
    return {values, unmatched};
  }
  function addCustomField(name, higherIsBetter, values, weight = 0.3) {
    const stats = summarize(Object.values(values));
    const field = {id: 'custom-' + (++customCount), key: 'custom-' + customCount, label: name, unit: 'custom', higher_is_better: higherIsBetter,
      values, weight, mean: stats.mean, sd: stats.sd, count: stats.count};
    customFields.push(field); renderCustomFields(); saveCustomFields();
    return field;
  }
  function renderCustomFields() {
    const list = el('custom-list'); list.replaceChildren();
    customFields.forEach(f => {
      const item = make('div', 'custom-field');
      const control = weightControl('w-' + f.id, `${f.label} (${f.count}/${forecast.players.length}, ${f.higher_is_better ? 'higher' : 'lower'} is better)`, f.weight, 1,
        value => { f.weight = value; saveCustomFields(); changed(); }, ' strokes/SD');
      const remove = make('button', 'secondary small', 'Remove'); remove.type = 'button'; remove.id = 'remove-' + f.id;
      remove.addEventListener('click', () => { customFields = customFields.filter(c => c !== f); renderCustomFields(); saveCustomFields(); changed('Custom field removed. Run the simulation to update results.'); });
      item.append(control.wrap, remove); list.append(item);
    });
  }
  function saveCustomFields() {
    try { localStorage.setItem(STORAGE_KEY + ':' + forecast.event_id, JSON.stringify(customFields.map(f => ({name: f.label, higher: f.higher_is_better, values: f.values, weight: f.weight})))); } catch (_) { /* Storage is optional. */ }
  }
  function loadCustomFields() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY + ':' + forecast.event_id) || '[]');
      const ids = new Set(forecast.players.map(p => p.id));
      saved.forEach(f => addCustomField(String(f.name), !!f.higher, Object.fromEntries(Object.entries(f.values || {}).filter(([id, v]) => ids.has(id) && typeof v === 'number')), Number(f.weight) || 0));
    } catch (_) { /* Ignore missing or corrupt storage. */ }
  }
  function onAddCustom() {
    const name = el('custom-name').value.trim(), message = el('custom-message');
    if (!name) { message.textContent = 'Give the field a name.'; return; }
    const {values, unmatched} = parseCustomValues(el('custom-values').value);
    if (!Object.keys(values).length) { message.textContent = 'No values matched players in this field. Use one "Player name, value" per line.'; return; }
    const field = addCustomField(name, el('custom-direction').value === 'higher', values);
    message.textContent = `Added “${name}” for ${field.count} players.` + (unmatched.length ? ` Not in this field: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? '…' : ''}.` : '') + ' Unlisted players count as field average.';
    el('custom-name').value = ''; el('custom-values').value = '';
    changed();
  }

  function run() {
    const count = input('runs'), volatility = input('volatility'), players = forecast.players;
    const captured = players.map(p => resultInputs(p));
    const means = players.map(p => 4 * estimate(p));
    resultMeta = {count: 0, volatility, saved: false};
    el('math-status').textContent = 'Explanation follows this simulation as it runs.';
    const sigmas = players.map(p => 2 * volatility * (p.id === el('player').value ? input('player-volatility') : 1));
    const wins = new Array(players.length).fill(0), recent = [];
    let completed = 0;
    el('settings').disabled = true; el('reset').disabled = true;
    function batch() {
      const target = Math.min(count, completed + Math.max(25, Math.ceil(count / 50)));
      // Each winner comes from a full independent tournament draw.
      while (completed < target) {
        let best = Infinity, winner = 0;
        const finalTrial = completed === count - 1 ? [] : null;
        for (let i = 0; i < players.length; i++) {
          const u = 1 - Math.random(), v = Math.random();
          const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
          const score = means[i] + sigmas[i] * z;
          if (finalTrial) finalTrial.push({name: players[i].name, mean: means[i], sigma: sigmas[i], z, score});
          if (score < best) { best = score; winner = i; }
        }
        if (finalTrial) resultMeta.sample = finalTrial.sort((a, b) => a.score - b.score).slice(0, 2);
        wins[winner]++; completed++;
        recent.push(players[winner].name); if (recent.length > 4) recent.shift();
      }
      ranking = players.map((p, i) => ({...captured[i], name: p.name, skill: means[i] / 4, wins: wins[i], probability: wins[i] / completed})).sort((a, b) => b.probability - a.probability || a.name.localeCompare(b.name));
      resultMeta.count = completed;
      draw(); el('progress-bar').style.width = (100 * completed / count) + '%';
      el('progress-label').textContent = `${format(completed)} / ${format(count)} tournaments`;
      const chips = el('recent-winners'); chips.replaceChildren();
      recent.slice().reverse().forEach(name => chips.append(make('span', '', name)));
      el('result-summary').textContent = `Your experiment · ${format(completed)} of ${format(count)} tournaments${completed < count ? ' · in progress' : ''}`;
      if (completed < count) { setTimeout(batch, 30); return; }
      el('math-status').textContent = 'Explanation for the completed simulation.';
      el('status').textContent = 'Simulation complete. Adjust and run again to compare.';
      el('settings').disabled = false; el('reset').disabled = false; el('run').disabled = false;
      computeLive();
    }
    batch();
  }

  // ---- Live in-play forecast -------------------------------------------------
  const Live = globalThis.GolfLive;
  const LIVE_POLL_MS = 60000, LIVE_TRIALS = 10000, CHECKPOINT_TRIALS = 2000, SERIES = 5;
  let seriesSlots = new Map(), liveData = null, liveResult = null, liveTimeline = [], liveFetchedAt = null, liveBusy = false;
  const escapeXml = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  // Prefer the cached same-origin proxy (api/live.js); fall back to ESPN directly, e.g. on a static file server.
  async function fetchScoreboard() {
    const dates = forecast.event_start.slice(0, 10).replace(/-/g, '');
    let lastError;
    for (const url of [`/api/live?dates=${dates}`, `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=${dates}`]) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) { lastError = error; }
    }
    throw lastError;
  }
  function livePlayer(id, name) { return assumption(id) || {id, name, prior_rounds: 0, round_sum: 0, win_probability: 0, late: true}; }
  // Model skill with this week's completed rounds added to the player's history.
  function liveSkill(player, state) {
    const learn = el('live-learn').checked !== false;
    const rounds = player.prior_rounds + (learn ? state.weekRounds : 0) + input('prior');
    const sum = player.round_sum + (learn ? state.weekSum : 0);
    return estimate(player) - historyEstimate(player) + input('skill') * (rounds ? sum / rounds : 0);
  }
  function liveInputs(state) {
    const players = state.states.map(s => livePlayer(s.id, s.name));
    const means = players.map((p, i) => liveSkill(p, state.states[i]));
    const sigmas = players.map(p => input('volatility') * (p.id === el('player').value ? input('player-volatility') : 1));
    return {players, means, sigmas};
  }
  function computeLive() {
    if (!liveData || !Live) return;
    const now = Live.stateAt(liveData), {players, means, sigmas} = liveInputs(now);
    const result = Live.simulate(now, means, sigmas, LIVE_TRIALS);
    if (liveData.completed) {
      // Official result: the first-ordered player won, including any playoff.
      const winner = liveData.players.findIndex(p => p.order === 1);
      if (winner >= 0) result.win = result.win.map((_, i) => i === winner ? 1 : 0);
    }
    liveResult = {now, players, means, sigmas, ...result, positions: Live.positions(now)};
    const order = now.states.map((s, i) => i).filter(i => now.states[i].alive)
      .sort((a, b) => liveResult.win[b] - liveResult.win[a] || now.states[a].toPar - now.states[b].toPar || now.states[a].name.localeCompare(now.states[b].name));
    liveResult.order = order;
    const tracked = order.slice(0, SERIES).map(i => now.states[i].id);
    liveTimeline = Live.checkpoints(liveData).map(point => {
      const inputs = liveInputs(point.state);
      const sim = point.state === now ? liveResult : Live.simulate(point.state, inputs.means, inputs.sigmas, CHECKPOINT_TRIALS, Math.random, 0);
      const byId = new Map(point.state.states.map((s, i) => [s.id, sim.win[i]]));
      return {holes: point.holes, now: point.state === now, values: tracked.map(id => byId.get(id) || 0)};
    });
    liveTimeline.tracked = tracked.map(id => now.states.find(s => s.id === id).name);
    // Colors follow the player across refreshes; a newcomer takes a free slot.
    const kept = new Map([...seriesSlots].filter(([id]) => tracked.includes(id)));
    tracked.forEach(id => { if (!kept.has(id)) kept.set(id, [1, 2, 3, 4, 5].find(slot => ![...kept.values()].includes(slot))); });
    seriesSlots = kept;
    liveTimeline.slots = tracked.map(id => seriesSlots.get(id));
    renderLive();
  }
  function thruText(index) {
    const state = liveResult.now.states[index], player = liveData.players[index];
    if (!state.remaining) return 'F';
    const current = player.current;
    if (current && current.thru) return String(current.thru);
    return current?.tee || (current ? 'Not started' : '—');
  }
  function renderLive() {
    const r = liveResult, now = r.now, alive = now.states.filter(s => s.alive);
    const leaderIndex = r.order[0], leader = now.states[leaderIndex];
    const round = liveData.completed ? 'FINAL' : (liveData.detail || `Round ${liveData.period}`).toUpperCase();
    el('live-round').textContent = round;
    el('live-panel').hidden = false;
    el('mode-pill').textContent = liveData.completed ? 'Final' : '● Live';
    el('eyebrow').textContent = liveData.completed ? 'PGA TOUR / FINAL RESULT' : 'PGA TOUR / LIVE';
    el('data-note').textContent = `Live scoring from ESPN, updated ${liveFetchedAt.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}. The model lab below still shows the pre-event snapshot.`;
    const holesLeft = alive.reduce((sum, s) => sum + s.remaining, 0) / Math.max(1, alive.length);
    el('live-summary').textContent = `${alive.length} players still in the field · ${format(LIVE_TRIALS)} simulated finishes · avg ${holesLeft.toFixed(1)} holes left`;
    // Leader callout with the projection math for the favorite.
    const box = el('live-leader'); box.replaceChildren();
    if (leader) {
      const pre = r.players[leaderIndex].win_probability || 0, mean = r.means[leaderIndex], sigma = r.sigmas[leaderIndex];
      const head = liveData.completed
        ? `${leader.name} won at ${Live.formatToPar(leader.toPar)}.`
        : `${leader.name} is the favorite: ${pct(r.win[leaderIndex])} to win, up from ${pct(pre)} before the event.`;
      box.append(make('p', '', head));
      if (!liveData.completed) {
        box.append(make('p', 'muted', `${r.positions[leaderIndex]} at ${Live.formatToPar(leader.toPar)} with ${leader.remaining} holes left. ${r.playoffs ? `${format(r.playoffs)} simulations needed a playoff.` : ''}`));
        box.append(make('p', 'math-line', `Projected finish = ${Live.formatToPar(leader.toPar)} + ${leader.remaining} holes × (${now.fieldHole.toFixed(3)} field avg/hole + ${signed(mean)} skill ÷ 18) = ${Live.formatToPar(r.projected[leaderIndex], 1)}; spread σ = ${sigma.toFixed(2)} × √(${leader.remaining} ÷ 18) = ${(sigma * Math.sqrt(leader.remaining / 18)).toFixed(2)} strokes.`));
      }
    }
    const board = el('live-board'); board.replaceChildren();
    r.order.slice(0, input('live-show')).forEach(i => {
      const s = now.states[i], pre = r.players[i].win_probability || 0, diff = r.win[i] - pre;
      const row = make('tr', 'forecast-row' + (i === leaderIndex ? ' leader-row' : ''));
      const win = make('td', 'numeric prob', pct(r.win[i]));
      win.append(make('span', 'delta', `${diff >= 0 ? '▲' : '▼'} ${(100 * Math.abs(diff)).toFixed(1)} pts`));
      row.append(make('td', 'rank', r.positions[i]), make('th', 'player-name', s.name + (r.players[i].late ? ' *' : '')),
        make('td', 'numeric', Live.formatToPar(s.toPar)), make('td', 'numeric', thruText(i)),
        make('td', 'numeric', Live.formatToPar(r.projected[i], 1)), make('td', 'numeric', pct(pre)), win,
        make('td', 'numeric', pct(r.topProbability[i])));
      row.children[1].scope = 'row'; board.append(row);
    });
    drawLiveChart();
  }
  function drawLiveChart() {
    const svg = el('live-chart'), legend = el('live-legend'), points = liveTimeline, names = points.tracked || [];
    legend.replaceChildren();
    names.forEach((name, k) => { const item = make('span', '', name); const swatch = make('i'); swatch.style.background = `var(--series-${liveTimeline.slots[k]})`; item.prepend(swatch); legend.append(item); });
    if (points.length < 2) { svg.innerHTML = '<text x="320" y="115" text-anchor="middle">The chart fills in as holes are completed.</text>'; return; }
    const W = 640, H = 230, left = 38, right = 150, top = 10, bottom = 28, total = 18 * liveData.rounds;
    const peak = Math.max(0.05, ...points.flatMap(p => p.values));
    const tick = peak <= 0.1 ? 0.025 : peak <= 0.3 ? 0.05 : peak <= 0.6 ? 0.1 : 0.2;
    const yMax = Math.min(1, Math.ceil(peak / tick + 0.0001) * tick);
    const x = holes => left + (W - left - right) * holes / total, y = value => top + (H - top - bottom) * (1 - value / yMax);
    let out = '';
    for (let v = 0; v <= yMax + 1e-9; v += tick) {
      out += `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" stroke="#e6ebe8" stroke-width="1"/><text x="${left - 6}" y="${y(v) + 3}" text-anchor="end">${Number((v * 100).toFixed(1))}%</text>`;
    }
    for (let round = 0; round <= liveData.rounds; round++) {
      const label = round === liveData.rounds ? 'Finish' : `R${round + 1}`;
      out += `<line x1="${x(round * 18)}" x2="${x(round * 18)}" y1="${H - bottom}" y2="${H - bottom + 4}" stroke="#b9c3be"/><text x="${x(round * 18)}" y="${H - 8}" text-anchor="middle">${label}</text>`;
    }
    const ends = [];
    names.forEach((name, k) => {
      const path = points.map((p, j) => `${j ? 'L' : 'M'}${x(p.holes).toFixed(1)},${y(p.values[k]).toFixed(1)}`).join(' ');
      const last = points.at(-1);
      out += `<path d="${path}" fill="none" stroke="var(--series-${liveTimeline.slots[k]})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      out += `<circle cx="${x(last.holes)}" cy="${y(last.values[k])}" r="4" fill="var(--series-${liveTimeline.slots[k]})" stroke="white" stroke-width="2"/>`;
      ends.push({k, name, value: last.values[k], y: y(last.values[k])});
    });
    // Direct labels at the line ends, nudged apart so they never overlap.
    ends.sort((a, b) => a.y - b.y);
    for (let j = 1; j < ends.length; j++) ends[j].y = Math.max(ends[j].y, ends[j - 1].y + 12);
    const lastX = x(points.at(-1).holes) + 9;
    ends.forEach(e => { out += `<text class="end-label" x="${lastX}" y="${e.y + 3}">${escapeXml(e.name.split(' ').slice(-1)[0])} ${(100 * e.value).toFixed(1)}%</text>`; });
    out += `<line id="live-crosshair" x1="0" x2="0" y1="${top}" y2="${H - bottom}" stroke="#9aa6a0" stroke-dasharray="3 3" visibility="hidden"/>`;
    out += `<rect x="${left}" y="${top}" width="${W - left - right}" height="${H - top - bottom}" fill="transparent"/>`;
    svg.innerHTML = out;
    svg.chartGeometry = {x, left, right, W, total};
  }
  function liveHover(event) {
    const svg = el('live-chart'), geo = svg.chartGeometry, tip = el('live-tooltip');
    if (!geo || liveTimeline.length < 2) return;
    const box = svg.getBoundingClientRect(), px = (event.clientX - box.left) * geo.W / box.width;
    const point = liveTimeline.reduce((best, p) => Math.abs(geo.x(p.holes) - px) < Math.abs(geo.x(best.holes) - px) ? p : best, liveTimeline[0]);
    const cross = svg.querySelector('#live-crosshair');
    cross.setAttribute('x1', geo.x(point.holes)); cross.setAttribute('x2', geo.x(point.holes)); cross.setAttribute('visibility', 'visible');
    const round = Math.min(liveData.rounds, Math.floor(point.holes / 18) + 1), hole = point.holes - (round - 1) * 18;
    const title = point.now ? 'Now' : point.holes === 0 ? 'Before round 1' : hole === 0 ? `After round ${round - 1}` : `Round ${round}, thru ${hole}`;
    tip.replaceChildren(make('strong', '', title));
    liveTimeline.tracked.map((name, k) => ({name, k, value: point.values[k]})).sort((a, b) => b.value - a.value).forEach(({name, k, value}) => {
      const line = make('div'), label = make('span', '', name), dot = make('i');
      dot.style.background = `var(--series-${liveTimeline.slots[k]})`; label.prepend(dot); line.append(label, make('span', '', pct(value))); tip.append(line);
    });
    tip.hidden = false;
    const xPx = geo.x(point.holes) * box.width / geo.W;
    tip.style.left = Math.max(0, Math.min(box.width - 170, xPx + 12)) + 'px';
  }
  function hideHover() { el('live-tooltip').hidden = true; el('live-chart').querySelector?.('#live-crosshair')?.setAttribute('visibility', 'hidden'); }
  async function refreshLive(manual) {
    if (liveBusy || !Live) return;
    liveBusy = true; el('live-refresh').disabled = true;
    if (manual) el('live-status').textContent = 'Fetching live scores…';
    try {
      const event = (await fetchScoreboard()).events?.find(e => String(e.id) === String(forecast.event_id));
      if (!event) throw Error('this event is not on the live scoreboard');
      const parsed = Live.parseEvent(event);
      if (parsed.state === 'pre' || !parsed.players.some(p => p.holes.length)) {
        el('data-note').textContent = 'Fixed field and stats. Live odds appear here once the first scores are posted.';
        return;
      }
      liveData = parsed; liveFetchedAt = new Date();
      computeLive();
      el('live-status').textContent = liveData.completed ? 'Tournament complete. Final scores loaded.'
        : `Updated ${liveFetchedAt.toLocaleTimeString()}${el('live-auto').checked ? ' · next refresh in about a minute' : ''}.`;
    } catch (error) {
      if (liveData) el('live-status').textContent = `Live refresh failed (${error.message}); showing scores from ${liveFetchedAt.toLocaleTimeString()}.`;
      else el('data-note').textContent = `Fixed field and stats. Live scoring unavailable (${error.message}).`;
    } finally { liveBusy = false; el('live-refresh').disabled = false; }
  }
  function pollLive() {
    const hidden = typeof document.visibilityState === 'string' && document.visibilityState === 'hidden';
    if (el('live-auto').checked && !hidden && !liveData?.completed) refreshLive(false);
  }
  el('live-refresh').addEventListener('click', () => refreshLive(true));
  el('live-show').addEventListener('change', () => { if (liveResult) renderLive(); });
  el('live-learn').addEventListener('change', computeLive);
  el('live-chart').addEventListener('mousemove', liveHover);
  el('live-chart').addEventListener('mouseleave', hideHover);
  if (typeof setInterval === 'function') setInterval(pollLive, LIVE_POLL_MS);
  document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'visible') pollLive(); });

  const SLIDERS = ['volatility', 'prior', 'skill', 'adjustment', 'player-volatility'];
  const showSlider = id => { el(id + '-value').textContent = id === 'prior' ? input(id) : input(id).toFixed(1); };
  SLIDERS.forEach(id => el(id).addEventListener('input', () => { showSlider(id); el('preset').value = 'custom'; presetDescription('custom'); changed(); }));
  el('player').addEventListener('change', () => changed('Player changed. Run the simulation to update results.'));
  el('preset').addEventListener('change', () => { applyPreset(el('preset').value); changed('Preset applied. Run the simulation to update results.'); });
  el('custom-add').addEventListener('click', onAddCustom);
  el('show').addEventListener('change', draw);
  el('run').addEventListener('click', () => { el('run').disabled = true; el('status').textContent = 'Simulating…'; setTimeout(run, 20); });
  el('reset').addEventListener('click', () => {
    Object.entries({volatility: 2.8, prior: 20, adjustment: 0, skill: 1, 'player-volatility': 1, runs: 5000}).forEach(([id, v]) => { el(id).value = v; });
    SLIDERS.forEach(showSlider); el('preset').value = 'history'; applyPreset('history');
    customFields.forEach(f => { f.weight = 0; }); renderCustomFields(); saveCustomFields();
    changed('Defaults restored. Run the simulation to update results.');
  });
  fetch('data/model.json').then(response => { if (!response.ok) throw Error(`HTTP ${response.status}`); return response.json(); }).then(data => {
    forecast = data; resultMeta = {saved: true, count: data.simulations, volatility: 2.8};
    ranking = data.players.map(p => ({...resultInputs(p, true), name: p.name, skill: p.round_sum / (p.prior_rounds + 20), probability: p.win_probability})).sort((a, b) => b.probability - a.probability || a.name.localeCompare(b.name));
    fields = (data.stats?.fields || []).map(f => ({...f, ...summarize(data.players.map(p => p.stats?.[f.key]))})).filter(f => f.count);
    el('event-name').textContent = data.event; el('event-date').textContent = `${data.event_start.slice(0, 10)} · ${data.players.length} players · saved ${data.created_at.slice(0, 10)}`;
    if (data.stats) el('stats-note').textContent = `PGA Tour ${data.stats.season} stats retrieved ${data.stats.retrieved_at.slice(0, 10)}${data.stats.after_event_start ? ' — after the event started, so they may include its rounds' : ', before the event started'}.`;
    for (const p of [...data.players].sort((a, b) => a.name.localeCompare(b.name))) { const option = make('option', '', p.name); option.value = p.id; el('player').append(option); }
    el('player').value = data.players[0].id;
    buildStatControls(); loadCustomFields(); presetDescription('history');
    el('result-summary').textContent = `Original saved forecast · ${format(data.simulations)} simulated tournaments`; detail(); draw(); el('run').disabled = false; el('status').textContent = 'Ready to explore.';
    refreshLive(false);
  }).catch(error => { el('chart').textContent = 'Could not load model data. Please refresh the page.'; el('status').textContent = `Could not load data: ${error.message}`; el('run').disabled = true; });
})();
