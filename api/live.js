// Same-origin proxy for ESPN's live PGA scoreboard. Trims the payload to the
// fields the live model reads and lets Vercel's CDN share one fetch per 30 seconds.
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

function trimHole(h) {
  return {period: h.period, value: h.value, scoreType: h.scoreType ? {displayValue: h.scoreType.displayValue} : undefined};
}
function trimRound(r) {
  const stats = r.statistics?.categories?.[0]?.stats || [];
  return {period: r.period, value: r.value, displayValue: r.displayValue,
    linescores: (r.linescores || []).map(trimHole),
    statistics: stats.length ? {categories: [{stats: [{displayValue: stats[stats.length - 1].displayValue}]}]} : undefined};
}
function trim(data) {
  return {events: (data.events || []).map(e => ({id: e.id, name: e.name, date: e.date, endDate: e.endDate, status: e.status,
    competitions: (e.competitions || []).slice(0, 1).map(c => ({status: c.status,
      competitors: (c.competitors || []).map(p => ({id: p.id, order: p.order, score: p.score,
        athlete: {displayName: p.athlete?.displayName}, linescores: (p.linescores || []).map(trimRound)}))}))}))};
}

module.exports = async (req, res) => {
  const dates = new URL(req.url, 'http://localhost').searchParams.get('dates') || '';
  if (!/^\d{8}(-\d{8})?$/.test(dates)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({error: 'dates must be YYYYMMDD or YYYYMMDD-YYYYMMDD'}));
  }
  try {
    const upstream = await fetch(`${ESPN}?dates=${dates}`, {headers: {'User-Agent': 'golf-forecast-lab/1.0'}});
    if (!upstream.ok) throw new Error(`ESPN HTTP ${upstream.status}`);
    const body = JSON.stringify(trim(await upstream.json()));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=30');
    res.end(body);
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({error: error.message}));
  }
};

module.exports.trim = trim;
