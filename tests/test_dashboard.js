const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
class Element {
  constructor(id) { this.id=id; this.value=''; this.children=[]; this.listeners={}; this.style={}; this.textContent=''; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, fn) { this.listeners[type]=fn; }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  querySelector() { return null; }
  replaceChildren() { this.children=[]; }
}
const elements = {};
const document = { getElementById: id => elements[id] ||= new Element(id), createElement: () => new Element() };
for (const [id,value] of Object.entries({preset:'history',volatility:'2.8',prior:'20',adjustment:'0',skill:'1', 'player-volatility':'1',runs:'1000',show:'10','live-show':'20'})) document.getElementById(id).value=value;
const model=JSON.parse(fs.readFileSync('site/data/model.json','utf8'));
const liveFixture=JSON.parse(fs.readFileSync('tests/fixtures/espn-live-rsm-r3.json','utf8'));
const fetched=[];
const context={document,fetch:async url=>{fetched.push(url);return {ok:true,json:async()=>url.includes('dates=')?liveFixture:model};},setTimeout:fn=>fn(),console,Math:Object.assign(Object.create(Math), {random: () => 0.5})};
vm.createContext(context);
vm.runInContext(fs.readFileSync('site/live.js','utf8'),context);
vm.runInContext(fs.readFileSync('site/app.js','utf8'),context);
setImmediate(()=>{
  assert.equal(elements['chart'].children.length,10);
  assert.equal(elements['event-name'].textContent,'The RSM Classic');
  const firstRow = elements['chart'].children[0];
  assert.equal(firstRow.children.length, 5);
  assert.equal(firstRow.children[0].textContent, '1');
  assert.equal(firstRow.children[1].textContent, model.players[0].name);
  assert.equal(firstRow.children[1].scope, 'row');
  const flatten = node => node.textContent + node.children.map(flatten).join(' ');
  assert(elements['winner-reason'].textContent.includes('saved forecast'));
  assert(flatten(elements['winner-math']).includes('Individual trial draws were not stored'));
  const savedExplanation = flatten(elements['winner-math']);
  const savedSkill = firstRow.children[3].textContent;
  elements['skill'].value='2'; elements['skill'].listeners.input();
  elements['show'].listeners.change();
  assert.equal(elements['chart'].children[0].children[3].textContent, savedSkill,
    'Displayed skill stays tied to the forecast until the simulation runs');
  assert.equal(flatten(elements['winner-math']), savedExplanation);
  assert(elements['math-status'].textContent.includes('Settings changed'));
  elements['skill'].value='1'; elements['skill'].listeners.input();
  assert(elements['formula'].textContent.includes('historical'));
  elements['run'].listeners.click();
  assert.equal(elements['chart'].children.length,10);
  assert(elements['result-summary'].textContent.includes('1,000'));
  assert.equal(elements['run'].disabled,false);
  assert.equal(elements['progress-label'].textContent,'1,000 / 1,000 tournaments');
  assert.equal(elements['progress-bar'].style.width,'100%');
  assert.equal(elements['recent-winners'].children.length,4);
  assert.equal(elements['settings'].disabled,false);
  elements['show'].value='20';elements['show'].listeners.change();
  assert.equal(elements['chart'].children.length,20);
  elements['prior'].value='50';elements['prior'].listeners.input();
  assert(elements['formula'].textContent.includes('50 prior'));
  // Strokes-gained controls are generated from the exported field definitions.
  const find = (node, id) => node.id === id ? node : node.children.reduce((hit, child) => hit || (child.children ? find(child, id) : null), null);
  const weights = elements['stat-weights'];
  for (const key of ['sg_ott','sg_app','sg_arg','sg_putt','form_sg_total','driving_distance','course_fit']) assert(find(weights, 'w-' + key), key);
  const formulaBefore = elements['formula'].textContent;
  assert(formulaBefore.includes('Stats and custom fields: 0.00'));
  elements['preset'].value='sg'; elements['preset'].listeners.change();
  assert.equal(find(weights,'w-sg_app').value,'0.5');
  assert.equal(elements['skill'].value,0.5);
  assert.notEqual(elements['formula'].textContent, formulaBefore);
  const approach = find(weights,'w-sg_app'); approach.value='1'; approach.listeners.input();
  assert.equal(elements['preset'].value,'custom');
  assert(elements['player-stats'].children.length > 10);
  // Scenario changes are complete and repeatable, including targeted rookie assumptions.
  elements['preset'].value='rookie'; elements['preset'].listeners.change();
  assert.equal(elements['adjustment'].value, -0.3);
  assert.equal(elements['player-volatility'].value, 1.2);
  assert.equal(elements['prior'].value, 30);
  assert.equal(elements['player-adjustments'].open, true);
  assert(elements['preset-help'].textContent.includes('cannot predict'));
  const rookieFormula = elements['formula'].textContent;
  assert(rookieFormula.includes('Adjustment: -0.30'));
  elements['preset'].value='hard'; elements['preset'].listeners.change();
  assert.equal(elements['adjustment'].value, 0);
  assert.equal(elements['player-volatility'].value, 1);
  assert.equal(elements['prior'].value, 20);
  assert.equal(find(weights,'w-sg_app').value, '0.7');
  assert.equal(find(weights,'w-sg_total').value, '0');
  assert(elements['preset-help'].textContent.includes('not scoring relative to par'));
  for (const field of model.stats.fields) {
    const slider = find(weights, 'w-' + field.key);
    assert(slider['aria-describedby']);
    assert(find(weights, slider['aria-describedby']).textContent.length > 40);
  }
  elements['volatility'].value='3.5'; elements['volatility'].listeners.input();
  assert.equal(elements['preset'].value,'custom');
  elements['preset'].value='birdies'; elements['preset'].listeners.change();
  assert.equal(find(weights,'w-birdie_average').value,'0.15');
  elements['preset'].value='history'; elements['preset'].listeners.change();
  assert.equal(elements['volatility'].value,2.8);
  assert.equal(find(weights,'w-birdie_average').value,'0');
  // Custom fields: paste values, match names (accents and case ignored), and weight them.
  const first = model.players[0];
  elements['player'].value = first.id; elements['player'].listeners.change();
  document.getElementById('custom-name').value='Course history'; document.getElementById('custom-direction').value='higher';
  document.getElementById('custom-values').value=`${first.name.toUpperCase()}, 3\n${model.players[1].name}\t-1\nNot A Player, 2\nbad line`;
  elements['custom-add'].listeners.click();
  assert(elements['custom-message'].textContent.includes('2 players'), elements['custom-message'].textContent);
  assert(elements['custom-message'].textContent.includes('Not A Player'));
  assert.equal(elements['custom-list'].children.length,1);
  const rows = elements['player-stats'].children;
  const customRow = rows[rows.length-1];
  assert.equal(customRow.children[0].textContent,'Course history');
  assert.equal(customRow.children[3].textContent,'-0.30'); // One SD better at the default 0.3 weight.
  elements['run'].listeners.click();
  assert.equal(elements['progress-label'].textContent,'1,000 / 1,000 tournaments');
  elements['reset'].listeners.click();
  assert.equal(elements['preset'].value,'history');
  assert.equal(find(weights,'w-sg_app').value,'0');
  assert(elements['formula'].textContent.includes('Stats and custom fields: 0.00'));
  find(elements['custom-list'],'remove-custom-1').listeners.click();
  assert.equal(elements['custom-list'].children.length,0);
  // Deterministic random draws make the exact winner and win count auditable.
  elements['reset'].listeners.click();
  elements['skill'].value='0'; elements['skill'].listeners.input();
  elements['player'].value=first.id; elements['player'].listeners.change();
  elements['adjustment'].value='-1'; elements['adjustment'].listeners.input();
  elements['runs'].value='1000';
  elements['run'].listeners.click();
  assert(elements['winner-reason'].textContent.includes(first.name));
  assert(elements['winner-reason'].textContent.includes('1,000 ÷ 1,000 × 100 = 100.00%'));
  const explanation = flatten(elements['winner-math']);
  assert(explanation.includes('−1') || explanation.includes('-1.00 adjustment'));
  assert(explanation.includes('Actual final trial from this run'));
  assert(explanation.includes('σ = √4 × 2.80'));
  assert(explanation.includes('No LLM'));
  const expectedScore = -4 + 5.6 * Math.sqrt(-2 * Math.log(0.5)) * Math.cos(Math.PI);
  assert(explanation.includes(expectedScore.toFixed(4)));
  elements['adjustment'].value='1'; elements['adjustment'].listeners.input();
  elements['show'].listeners.change();
  assert.equal(flatten(elements['winner-math']), explanation, 'Result explanation retains captured inputs');
  // Live scoring: the panel loads ESPN scores for this event and simulates only the remaining holes.
  assert(fetched.some(url => url === '/api/live?dates=20261119'), fetched.join(','));
  assert.equal(elements['live-panel'].hidden, false);
  assert.equal(elements['mode-pill'].textContent, '● Live');
  assert(elements['live-round'].textContent.includes('ROUND 3'));
  assert(elements['live-summary'].textContent.startsWith('66 players still in the field'));
  const board = elements['live-board'].children;
  assert.equal(board.length, 20);
  const leaders = board.slice(0, 2).map(row => row.children[1].textContent);
  assert(leaders.every(name => ['Rasmus Højgaard', 'Michael Thorbjornsen', 'Max Greyserman'].includes(name)), leaders.join());
  assert(board.every(row => !['CUT', 'WD'].includes(row.children[0].textContent)));
  assert.equal(board.find(row => row.children[1].textContent === 'Rasmus Højgaard').children[2].textContent, '-13');
  assert(flatten(elements['live-leader']).includes('Projected finish'));
  assert(elements['live-chart'].innerHTML.includes('<path'), 'Win probability chart is drawn');
  assert.equal(elements['live-legend'].children.length, 5);
  elements['live-show'].value='10'; elements['live-show'].listeners.change();
  assert.equal(elements['live-board'].children.length, 10);
  console.log('Live panel loads ESPN scores, excludes cut players, and charts win probability.');
  console.log('Winner explanation shows exact counts, numeric draws, and captured assumptions.');
  console.log('Dashboard loads, runs a simulation, changes chart size, and updates assumptions.');
  console.log('Strokes-gained presets, stat weights, and custom fields update the model.');
});
