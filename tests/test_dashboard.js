const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
class Element {
  constructor(id) { this.id=id; this.value=''; this.children=[]; this.listeners={}; this.style={}; this.textContent=''; }
  addEventListener(type, fn) { this.listeners[type]=fn; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children=[]; }
}
const elements = {};
const document = { getElementById: id => elements[id] ||= new Element(id), createElement: () => new Element() };
for (const [id,value] of Object.entries({preset:'history',volatility:'2.8',prior:'20',adjustment:'0',skill:'1', 'player-volatility':'1',runs:'1000',show:'10'})) document.getElementById(id).value=value;
const model=JSON.parse(fs.readFileSync('site/data/model.json','utf8'));
const context={document,fetch:async()=>({ok:true,json:async()=>model}),setTimeout:fn=>fn(),console,Math};
vm.runInNewContext(fs.readFileSync('site/app.js','utf8'),context);
setImmediate(()=>{
  assert.equal(elements['chart'].children.length,10);
  assert.equal(elements['event-name'].textContent,'The RSM Classic');
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
  console.log('Dashboard loads, runs a simulation, changes chart size, and updates assumptions.');
  console.log('Strokes-gained presets, stat weights, and custom fields update the model.');
});
