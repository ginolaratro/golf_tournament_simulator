'use strict';
(() => {
  const el = id => document.getElementById(id);
  let forecast, ranking;
  const pct = value => (100 * value).toFixed(2) + '%';
  const format = number => Number(number).toLocaleString();
  const input = id => Number(el(id).value);
  function assumption(id) { return forecast.players.find(p => p.id === id); }
  function estimate(player) {
    const n = player.prior_rounds;
    const denominator = n + input('prior');
    return input('skill') * (denominator ? player.round_sum / denominator : 0) + (player.id === el('player').value ? input('adjustment') : 0);
  }
  function detail() {
    const p = assumption(el('player').value); if (!p) return;
    const mean = estimate(p);
    el('player-detail').textContent = `${p.name} has ${format(p.prior_rounds)} recorded prior rounds. The sum of their scores relative to their round fields is ${p.round_sum.toFixed(1)} strokes.`;
    el('formula').textContent = `${input('skill').toFixed(1)} × ${p.round_sum.toFixed(1)} ÷ (${p.prior_rounds} historical + ${input('prior')} prior rounds) + ${input('adjustment').toFixed(1)} adjustment = ${mean.toFixed(2)} strokes per round relative to the field. Negative is better.`;
    if (p.prior_rounds + input('prior') === 0) el('formula').textContent = `No prior rounds: model starts at field average, then applies your ${input('adjustment').toFixed(1)} stroke adjustment.`;
  }
  function draw() {
    const chart = el('chart'); chart.replaceChildren();
    const displayed = ranking.slice(0, input('show'));
    const maximum = displayed[0]?.probability || 1;
    displayed.forEach(p => {
      const row=document.createElement('div'); row.className='bar-row';
      const name=document.createElement('span'); name.className='player-name'; name.textContent=p.name; name.title=p.name;
      const track=document.createElement('div'); track.className='track';
      const bar=document.createElement('div'); bar.className='bar'; bar.style.width=(100*p.probability/maximum)+'%'; track.append(bar);
      const value=document.createElement('span'); value.className='prob'; value.textContent=pct(p.probability);
      row.append(name,track,value); chart.append(row);
    });
  }
  function run() {
    const count=input('runs'), volatility=input('volatility'), players=forecast.players;
    const means=players.map(p=>4*estimate(p));
    const sigmas=players.map(p=>2*volatility*(p.id===el('player').value?input('player-volatility'):1));
    const wins=new Array(players.length).fill(0), recent=[];
    let completed=0;
    el('settings').disabled=true;el('reset').disabled=true;
    function batch() {
      const target=Math.min(count, completed + Math.max(25, Math.ceil(count/50)));
      // Each winner comes from a full independent tournament draw.
      while(completed<target) { let best=Infinity, winner=0;
        for(let i=0;i<players.length;i++) {const u=1-Math.random(),v=Math.random(); const z=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);const score=means[i]+sigmas[i]*z;if(score<best){best=score;winner=i;}}
        wins[winner]++;completed++;
        recent.push(players[winner].name);if(recent.length>4)recent.shift();
      }
      ranking=players.map((p,i)=>({name:p.name,probability:wins[i]/completed})).sort((a,b)=>b.probability-a.probability||a.name.localeCompare(b.name));
      draw();el('progress-bar').style.width=(100*completed/count)+'%';
      el('progress-label').textContent=`${format(completed)} / ${format(count)} tournaments`;
      const chips=el('recent-winners');chips.replaceChildren();
      recent.slice().reverse().forEach(name=>{const chip=document.createElement('span');chip.textContent=name;chips.append(chip)});
      el('result-summary').textContent=`Your experiment · ${format(completed)} of ${format(count)} tournaments${completed<count?' · in progress':''}`;
      if(completed<count) {setTimeout(batch,30);return;}
      el('status').textContent='Simulation complete. Adjust and run again to compare.';
      el('settings').disabled=false;el('reset').disabled=false;el('run').disabled=false;
    }
    batch();
  }
  ['volatility','prior','skill','adjustment','player-volatility'].forEach(id=>el(id).addEventListener('input',()=>{el(id+'-value').textContent=id==='prior'?input(id):input(id).toFixed(1);detail();el('status').textContent='Assumptions changed. Run the simulation to update results.';}));
  el('player').addEventListener('change',()=>{detail();el('status').textContent='Player changed. Run the simulation to update results.'});
  el('show').addEventListener('change',draw);
  el('run').addEventListener('click',()=>{el('run').disabled=true;el('status').textContent='Simulating…';setTimeout(run,20)});
  el('reset').addEventListener('click',()=>{el('volatility').value=2.8;el('prior').value=20;el('adjustment').value=0;el('skill').value=1;el('player-volatility').value=1;el('runs').value=5000;['volatility','prior','skill','adjustment','player-volatility'].forEach(id=>el(id+'-value').textContent=id==='prior'?input(id):input(id).toFixed(1));detail();el('status').textContent='Defaults restored. Run the simulation to update results.'});
  fetch('data/model.json').then(response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json()}).then(data=>{
    forecast=data; ranking=data.players.map(p=>({name:p.name,probability:p.win_probability}));
    el('event-name').textContent=data.event;el('event-date').textContent=`${data.event_start.slice(0,10)} · ${data.players.length} players · saved ${data.created_at.slice(0,10)}`;
    const sorted=[...data.players].sort((a,b)=>a.name.localeCompare(b.name));for(const p of sorted){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;el('player').append(option)}
    el('player').value=data.players[0].id;el('result-summary').textContent=`Original saved forecast · ${format(data.simulations)} simulated tournaments`;detail();draw();el('run').disabled=false;el('status').textContent='Ready to explore.';
  }).catch(error=>{el('chart').textContent='Could not load model data. Please refresh the page.';el('status').textContent=`Could not load data: ${error.message}`;el('run').disabled=true;});
})();
