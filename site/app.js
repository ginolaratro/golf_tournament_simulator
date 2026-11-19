'use strict';
(() => {
  const el = id => document.getElementById(id);
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  let forecast, ranking, fields = [];
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
    history: {skill: 1, weights: {}},
    sg: {skill: 0.5, weights: {sg_ott: 0.5, sg_app: 0.5, sg_arg: 0.5, sg_putt: 0.3}},
    ballstriking: {skill: 0.5, weights: {sg_ott: 0.7, sg_app: 0.8, sg_arg: 0.3, sg_putt: 0.1}},
    form: {skill: 0.5, weights: {form_sg_ott: 0.4, form_sg_app: 0.4, form_sg_arg: 0.4, form_sg_putt: 0.2}},
  };

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
  }

  function changed(message) { detail(); el('status').textContent = message || 'Assumptions changed. Run the simulation to update results.'; }

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
      const section = make('div', 'stat-group'); section.append(make('h3', '', title), make('p', 'help', help));
      groupFields.forEach(f => {
        const note = perStroke(f) ? '' : ' strokes/SD';
        const control = weightControl('w-' + f.key, `${f.label} (${f.count}/${forecast.players.length})`, 0, perStroke(f) ? 1.5 : 1,
          value => { weights.set(f.key, value); el('preset').value = 'custom'; changed(); }, note);
        if (note) control.wrap.append(make('span', 'unit', 'strokes per round per SD'));
        if (f.description) control.wrap.title = f.description;
        weightInputs.set(f.key, control); section.append(control.wrap);
      });
      box.append(section);
    });
  }
  function applyPreset(name) {
    const preset = PRESETS[name]; if (!preset) return;
    fields.forEach(f => setWeight(f.key, preset.weights[f.key] || 0));
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
    const means = players.map(p => 4 * estimate(p));
    const sigmas = players.map(p => 2 * volatility * (p.id === el('player').value ? input('player-volatility') : 1));
    const wins = new Array(players.length).fill(0), recent = [];
    let completed = 0;
    el('settings').disabled = true; el('reset').disabled = true;
    function batch() {
      const target = Math.min(count, completed + Math.max(25, Math.ceil(count / 50)));
      // Each winner comes from a full independent tournament draw.
      while (completed < target) {
        let best = Infinity, winner = 0;
        for (let i = 0; i < players.length; i++) {
          const u = 1 - Math.random(), v = Math.random();
          const score = means[i] + sigmas[i] * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
          if (score < best) { best = score; winner = i; }
        }
        wins[winner]++; completed++;
        recent.push(players[winner].name); if (recent.length > 4) recent.shift();
      }
      ranking = players.map((p, i) => ({name: p.name, skill: means[i] / 4, probability: wins[i] / completed})).sort((a, b) => b.probability - a.probability || a.name.localeCompare(b.name));
      draw(); el('progress-bar').style.width = (100 * completed / count) + '%';
      el('progress-label').textContent = `${format(completed)} / ${format(count)} tournaments`;
      const chips = el('recent-winners'); chips.replaceChildren();
      recent.slice().reverse().forEach(name => chips.append(make('span', '', name)));
      el('result-summary').textContent = `Your experiment · ${format(completed)} of ${format(count)} tournaments${completed < count ? ' · in progress' : ''}`;
      if (completed < count) { setTimeout(batch, 30); return; }
      el('status').textContent = 'Simulation complete. Adjust and run again to compare.';
      el('settings').disabled = false; el('reset').disabled = false; el('run').disabled = false;
    }
    batch();
  }

  const SLIDERS = ['volatility', 'prior', 'skill', 'adjustment', 'player-volatility'];
  const showSlider = id => { el(id + '-value').textContent = id === 'prior' ? input(id) : input(id).toFixed(1); };
  SLIDERS.forEach(id => el(id).addEventListener('input', () => { showSlider(id); if (id === 'skill') el('preset').value = 'custom'; changed(); }));
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
    forecast = data; ranking = data.players.map(p => ({name: p.name, skill: p.round_sum / (p.prior_rounds + 20), probability: p.win_probability}));
    fields = (data.stats?.fields || []).map(f => ({...f, ...summarize(data.players.map(p => p.stats?.[f.key]))})).filter(f => f.count);
    el('event-name').textContent = data.event; el('event-date').textContent = `${data.event_start.slice(0, 10)} · ${data.players.length} players · saved ${data.created_at.slice(0, 10)}`;
    if (data.stats) el('stats-note').textContent = `PGA Tour ${data.stats.season} stats retrieved ${data.stats.retrieved_at.slice(0, 10)}${data.stats.after_event_start ? ' — after the event started, so they may include its rounds' : ', before the event started'}.`;
    for (const p of [...data.players].sort((a, b) => a.name.localeCompare(b.name))) { const option = make('option', '', p.name); option.value = p.id; el('player').append(option); }
    el('player').value = data.players[0].id;
    buildStatControls(); loadCustomFields();
    el('result-summary').textContent = `Original saved forecast · ${format(data.simulations)} simulated tournaments`; detail(); draw(); el('run').disabled = false; el('status').textContent = 'Ready to explore.';
  }).catch(error => { el('chart').textContent = 'Could not load model data. Please refresh the page.'; el('status').textContent = `Could not load data: ${error.message}`; el('run').disabled = true; });
})();
