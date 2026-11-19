"""Historical PGA Tour round-score Monte Carlo and walk-forward evaluation.

Uses ESPN's public scoreboard response; no credentials or third-party packages.
"""
import argparse
import csv
import json
import random
import statistics
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates={year}&limit=500'


def fetch_year(year, cache):
    path = cache / f'{year}.json'
    if path.exists():
        return json.loads(path.read_text())
    req = urllib.request.Request(URL.format(year=year), headers={'User-Agent': 'golf-research/1.0'})
    with urllib.request.urlopen(req, timeout=60) as response:
        data = json.load(response)
    cache.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return data


def events_from(data):
    events = []
    for event in data.get('events', []):
        if not event.get('status', {}).get('type', {}).get('completed'):
            continue
        comps = event.get('competitions', [])
        if len(comps) != 1:
            continue
        players = []
        for p in comps[0].get('competitors', []):
            if not p.get('id') or not p.get('athlete', {}).get('displayName'):
                continue
            rounds = {}
            for r in p.get('linescores', []):
                value, period = r.get('value'), r.get('period')
                # A complete 18-hole round is typically between 50 and 100 strokes.
                if period in (1, 2, 3, 4) and isinstance(value, (int, float)) and 50 <= value <= 100:
                    rounds[period] = value
            players.append({'id': str(p['id']), 'name': p['athlete']['displayName'],
                            'order': p.get('order'), 'rounds': rounds})
        winners = [p for p in players if p['order'] == 1]
        # Exclude team, match play, incomplete, and other formats that cannot be
        # represented as a four-round individual stroke-play event.
        if len(players) < 20 or len(winners) != 1 or len(winners[0]['rounds']) != 4:
            continue
        if sum(len(p['rounds']) >= 2 for p in players) < len(players) * .8:
            continue
        events.append({'id': str(event['id']), 'name': event['name'],
                       'date': event['date'][:10], 'end_date': event.get('endDate', event['date'])[:10], 'players': players})
    return sorted(events, key=lambda e: (e['date'], e['id']))


def simulate(players, history, simulations, rng, prior=20):
    """Shrink player field-relative round means toward zero, sample four rounds."""
    skills = []
    for player in players:
        past = history[player['id']]
        mean = sum(past) / (len(past) + prior)
        skills.append(mean)
    wins = [0] * len(players)
    for _ in range(simulations):
        scores = [rng.gauss(4 * mean, 2.8 * 2) for mean in skills]
        wins[min(range(len(scores)), key=scores.__getitem__)] += 1
    return [w / simulations for w in wins]


def update_history(event, history):
    # Center each round against that event's field to remove course difficulty.
    for round_no in range(1, 5):
        values = [p['rounds'][round_no] for p in event['players'] if round_no in p['rounds']]
        if not values:
            continue
        mean = statistics.mean(values)
        for player in event['players']:
            if round_no in player['rounds']:
                history[player['id']].append(player['rounds'][round_no] - mean)


def backtest(events, start, simulations, seed):
    history = defaultdict(list)
    rng = random.Random(seed)
    rows = []
    # Only completed events ending strictly before this event starts are available.
    pending = []
    dates = sorted({e['date'] for e in events})
    for date in dates:
        for prior_event in pending[:]:
            if prior_event['end_date'] < date:
                update_history(prior_event, history)
                pending.remove(prior_event)
        day = [e for e in events if e['date'] == date]
        for event in day:
            if date[:4] < str(start):
                continue
            players = event['players']
            probs = simulate(players, history, simulations, rng)
            pick = max(range(len(players)), key=probs.__getitem__)
            winner = next(i for i, p in enumerate(players) if p['order'] == 1)
            n = len(players)
            rows.append({'date': date, 'event_id': event['id'], 'event': event['name'],
                         'field_size': n, 'pick': players[pick]['name'],
                         'pick_probability': probs[pick], 'winner': players[winner]['name'],
                         'winner_probability': probs[winner], 'hit': int(pick == winner),
                         'brier': sum((p - (i == winner)) ** 2 for i, p in enumerate(probs)),
                         'uniform_brier': 1 - 1 / n,
                         'pick_prior_rounds': len(history[players[pick]['id']]),
                         'winner_prior_rounds': len(history[players[winner]['id']])})
        pending.extend(day)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--years', required=True, help='Inclusive years, e.g. 2022:2024 (earlier years warm up the model)')
    parser.add_argument('--test-start', type=int, required=True, help='First year scored; earlier years provide history')
    parser.add_argument('--simulations', type=int, default=10000)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--cache', type=Path, default=Path('.pga-cache'))
    parser.add_argument('--output', type=Path, default=Path('backtest.csv'))
    args = parser.parse_args()
    try:
        first, last = map(int, args.years.split(':'))
        if first > last or not first <= args.test_start <= last or args.simulations < 1:
            raise ValueError
    except ValueError:
        parser.error('Use --years FIRST:LAST, a test start within that range, and positive simulations')
    events = []
    for year in range(first, last + 1):
        print(f'Loading {year}...', file=sys.stderr)
        events.extend(events_from(fetch_year(year, args.cache)))
    rows = backtest(sorted(events, key=lambda e: (e['date'], e['id'])), args.test_start, args.simulations, args.seed)
    if not rows:
        parser.error('No eligible completed events found in the test period')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"Events: {len(rows)} | Picks correct: {sum(r['hit'] for r in rows)} ({statistics.mean(r['hit'] for r in rows):.1%})")
    print(f"Multiclass Brier score: {statistics.mean(r['brier'] for r in rows):.4f} | Uniform field baseline: {statistics.mean(r['uniform_brier'] for r in rows):.4f} (lower is better)")
    print(f'Record saved to {args.output}')


if __name__ == '__main__':
    main()
