"""Build a self-contained visual report from a saved forecast snapshot."""
import argparse
import html
import json
from pathlib import Path


def render_report(forecast, result=None):
    players = forecast['players']
    if not players or forecast['simulations'] < 1:
        raise ValueError('Forecast must contain players and a positive simulation count')
    # Escape HTML-sensitive characters in embedded JSON, including closing script tags.
    data = json.dumps({'forecast': forecast, 'result': result}).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    title = html.escape(forecast['event'])
    template = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__ · Forecast</title><style>
:root{color-scheme:light;--ink:#182e25;--muted:#5d7066;--green:#16714c;--light:#e1f0e6}*{box-sizing:border-box}body{margin:0;background:#f4f7f2;color:var(--ink);font:16px/1.5 system-ui,sans-serif}main{max-width:1050px;margin:auto;padding:40px 22px 70px}h1{font-size:clamp(2rem,5vw,3.6rem);line-height:1.05;margin:.2em 0}h2{font-size:1.45rem;margin:0 0 .3em}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:.75rem;font-weight:700;color:var(--green)}.intro{color:var(--muted);max-width:680px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:26px 0}.card,section{background:white;border:1px solid #dce6dd;border-radius:14px;padding:22px}.card strong{display:block;font-size:1.7rem}.card span,.note{font-size:.88rem;color:var(--muted)}section{margin:16px 0}.bar-row{display:grid;grid-template-columns:minmax(120px,190px) 1fr 60px;align-items:center;gap:12px;margin:10px 0;font-size:.9rem}.track{background:#edf3ed;border-radius:5px;height:24px}.bar{background:var(--green);height:100%;border-radius:5px}.value{text-align:right;font-weight:700}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}.step{padding:15px;background:#f3f8f3;border-radius:10px}.step b{display:block;margin-bottom:5px}.step p{font-size:.9rem;margin:0;color:var(--muted)}select{padding:8px;border:1px solid #bdccc0;border-radius:7px;background:white}.topline{display:flex;justify-content:space-between;align-items:center;gap:12px}.formula{background:var(--light);padding:16px;border-radius:10px;font-size:1.05rem;margin-top:15px}.result{margin-top:14px;color:var(--green);font-weight:700}@media(max-width:650px){.cards{grid-template-columns:1fr 1fr}.steps{grid-template-columns:1fr 1fr}.bar-row{grid-template-columns:115px 1fr 52px;gap:7px;font-size:.8rem}.topline{align-items:flex-start;flex-direction:column}}
</style></head><body><main>
<p class="eyebrow">PGA Tour · Monte Carlo forecast</p><h1 id="event"></h1><p class="intro">A snapshot of the field and model estimates saved before play. Explore the leading win probabilities and see how the simulation creates them.</p>
<div class="cards"><div class="card"><strong id="sims"></strong><span>simulated tournaments</span></div><div class="card"><strong id="field"></strong><span>players in saved field</span></div><div class="card"><strong id="saved"></strong><span>forecast saved (UTC)</span></div></div>
<section><div class="topline"><div><h2>Who won the simulations?</h2><div class="note">Each bar is that player's share of all simulated wins.</div></div><label>Show <select id="count"><option value="10">Top 10</option><option value="20">Top 20</option><option value="50">Top 50</option><option value="all">All players</option></select></label></div><div id="bars" role="img" aria-label="Player win probabilities"></div><p class="note">Bars use the top player's probability as their visual scale. The numbers are probabilities out of 100%, not shares of the players shown.</p></section>
<section><h2>How much history is behind the leading picks?</h2><div class="note">Recorded prior rounds available to the model for each of the top 10 picks.</div><div id="history-bars" role="img" aria-label="Prior rounds for the leading picks"></div><p class="note">More rounds provide more historical evidence; the model pulls estimates based on fewer rounds more strongly toward the field average.</p></section>
<section><h2>From past scores to a forecast</h2><div class="steps"><div class="step"><b>1 · Past rounds</b><p>Compare each historical round with that tournament round's field average.</p></div><div class="step"><b>2 · Player estimate</b><p>Average those differences, pulling estimates with fewer rounds toward the field average.</p></div><div class="step"><b>3 · Play it again</b><p>Draw four random rounds per player. The lowest simulated total wins.</p></div><div class="step"><b>4 · Count winners</b><p>Repeat for the full field, then divide each player's wins by the number of simulations.</p></div></div><div class="formula" id="example"></div><p class="note">The model uses a fixed round-to-round spread for every player. It does not model cuts, playoffs, course changes, weather, or late field changes. These are model estimates, not guarantees.</p></section>
<section><h2>Against real life</h2><div id="result"></div><p class="note">When the event is final, run the score command and rebuild this report to show its result. Each saved forecast is a local snapshot.</p></section>
</main><script id="data" type="application/json">__DATA__</script><script>
const {forecast:f,result:r}=JSON.parse(document.getElementById('data').textContent);const byId=id=>document.getElementById(id);byId('event').textContent=f.event;byId('sims').textContent=f.simulations.toLocaleString();byId('field').textContent=f.players.length.toLocaleString();byId('saved').textContent=f.created_at.replace('T',' ').slice(0,16);const pct=x=>(100*x).toFixed(2)+'%';const top=f.players[0];byId('example').textContent=`Example: ${top.name} won ${Math.round(top.win_probability*f.simulations).toLocaleString()} of ${f.simulations.toLocaleString()} simulations → ${pct(top.win_probability)} estimated chance.`;
function draw(){const bars=byId('bars');bars.replaceChildren();const v=byId('count').value;const list=f.players.slice(0,v==='all'?f.players.length:Number(v));for(const p of list){const row=document.createElement('div');row.className='bar-row';const name=document.createElement('span');name.textContent=p.name;const track=document.createElement('div');track.className='track';const bar=document.createElement('div');bar.className='bar';bar.style.width=(top.win_probability?100*p.win_probability/top.win_probability:0)+'%';track.append(bar);const n=document.createElement('span');n.className='value';n.textContent=pct(p.win_probability);row.append(name,track,n);bars.append(row)}}byId('count').addEventListener('change',draw);draw();const history=f.players.slice(0,10);const maxRounds=Math.max(...history.map(p=>p.prior_rounds),1);for(const p of history){const row=document.createElement('div');row.className='bar-row';const name=document.createElement('span');name.textContent=p.name;const track=document.createElement('div');track.className='track';const bar=document.createElement('div');bar.className='bar';bar.style.width=(100*p.prior_rounds/maxRounds)+'%';track.append(bar);const n=document.createElement('span');n.className='value';n.textContent=p.prior_rounds;row.append(name,track,n);byId('history-bars').append(row)}byId('result').textContent=r?`Model pick: ${r.pick}. Actual winner: ${r.winner}. ${r.hit?'Correct pick.':'Missed pick.'} Brier score: ${r.brier.toFixed(4)} (lower is better).`:'Awaiting the final result.';
</script></body></html>'''
    return template.replace('__TITLE__', title).replace('__DATA__', data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('forecast', type=Path, help='Path to saved forecast JSON')
    parser.add_argument('--result', type=Path, help='Optional scored result JSON')
    parser.add_argument('--output', type=Path, default=Path('forecast-report.html'))
    args = parser.parse_args()
    forecast = json.loads(args.forecast.read_text())
    result = json.loads(args.result.read_text()) if args.result else None
    if result and str(result['event_id']) != str(forecast['event_id']):
        parser.error('Result does not match forecast event')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render_report(forecast, result), encoding='utf-8')
    print(f'Report saved to {args.output}')


if __name__ == '__main__':
    main()
