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
for (const [id,value] of Object.entries({volatility:'2.8',prior:'20',adjustment:'0',runs:'1000',show:'10'})) document.getElementById(id).value=value;
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
  elements['show'].value='20';elements['show'].listeners.change();
  assert.equal(elements['chart'].children.length,20);
  elements['prior'].value='50';elements['prior'].listeners.input();
  assert(elements['formula'].textContent.includes('50 prior'));
  console.log('Dashboard loads, runs a simulation, changes chart size, and updates assumptions.');
});
