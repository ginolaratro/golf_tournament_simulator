"""Save pre-tournament forecasts and reconcile them with completed results."""
import argparse
import json
import random
import statistics
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from pga_backtest import URL, events_from, fetch_year, simulate, update_history


def fresh_year(year):
    req = urllib.request.Request(URL.format(year=year), headers={'User-Agent': 'golf-research/1.0'})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def find_event(data, event_id):
    matches = [e for e in data.get('events', []) if str(e.get('id')) == str(event_id)]
    if len(matches) != 1:
        raise ValueError(f'Event {event_id} was not found uniquely in the scoreboard')
    return matches[0]


def create_forecast(event, history_events, simulations, seed, now):
    status = event.get('status', {}).get('type', {})
    start = datetime.fromisoformat(event['date'].replace('Z', '+00:00'))
    if status.get('state') != 'pre' or now >= start:
        raise ValueError('Forecasts must be saved before the scoreboard start time and while the event is scheduled')
    competitors = event['competitions'][0].get('competitors', [])
    players = [{'id': str(p['id']), 'name': p['athlete']['displayName']} for p in competitors
               if p.get('id') and p.get('athlete', {}).get('displayName')]
    if len(players) < 20 or len({p['id'] for p in players}) != len(players):
        raise ValueError('The field is missing, too small, or has duplicate player IDs')
    history = defaultdict(list)
    for prior in history_events:
        if prior['end_date'] < event['date'][:10]:
            update_history(prior, history)
    probs = simulate(players, history, simulations, random.Random(seed))
    forecasts = [{**p, 'win_probability': prob, 'prior_rounds': len(history[p['id']])}
                 for p, prob in zip(players, probs)]
    forecasts.sort(key=lambda p: (-p['win_probability'], p['id']))
    return {'schema_version': 1, 'model': 'field-relative-rounds-v1', 'event_id': str(event['id']),
            'event': event['name'], 'event_start': event['date'], 'created_at': now.isoformat(),
            'simulations': simulations, 'seed': seed, 'players': forecasts}


def score_forecast(forecast, event):
    if str(event['id']) != forecast['event_id']:
        raise ValueError('Event does not match forecast')
    if not event.get('status', {}).get('type', {}).get('completed'):
        raise ValueError('Event is not final yet')
    competitors = event['competitions'][0].get('competitors', [])
    winners = [p for p in competitors if p.get('order') == 1 and p.get('id')]
    if len(winners) != 1:
        raise ValueError('Could not identify a unique official winner')
    winner = winners[0]
    players = forecast['players']
    winner_id = str(winner['id'])
    winner_forecast = next((p for p in players if p['id'] == winner_id), None)
    # A late entrant is assigned zero probability; include its outcome in Brier.
    brier = sum((p['win_probability'] - (p['id'] == winner_id)) ** 2 for p in players)
    if winner_forecast is None:
        brier += 1
    return {'event_id': forecast['event_id'], 'event': forecast['event'],
            'forecast_created_at': forecast['created_at'], 'winner': winner.get('athlete', {}).get('displayName', winner_id),
            'winner_id': winner_id, 'winner_in_forecast_field': winner_forecast is not None,
            'winner_probability': winner_forecast['win_probability'] if winner_forecast else 0,
            'pick': players[0]['name'], 'pick_id': players[0]['id'], 'hit': players[0]['id'] == winner_id,
            'brier': brier, 'uniform_brier': (1 - 1 / len(players)) if winner_forecast else (1 + 1 / len(players)),
            'scored_at': datetime.now(timezone.utc).isoformat()}


def save_new(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as out:
        json.dump(data, out, indent=2)
        out.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--records', type=Path, default=Path('forecast-records'))
    parser.add_argument('--cache', type=Path, default=Path('.pga-cache'))
    sub = parser.add_subparsers(dest='command', required=True)
    upcoming = sub.add_parser('upcoming', help='List scheduled tournaments and available field sizes')
    upcoming.add_argument('--year', type=int, required=True)
    forecast = sub.add_parser('forecast', help='Save one pre-event forecast (never overwrites)')
    forecast.add_argument('--year', type=int, required=True)
    forecast.add_argument('--event-id', required=True)
    forecast.add_argument('--history-start', type=int, required=True)
    forecast.add_argument('--simulations', type=int, default=10000)
    forecast.add_argument('--seed', type=int, default=42)
    score = sub.add_parser('score', help='Score saved forecasts for final events')
    score.add_argument('--year', type=int, required=True)
    sub.add_parser('record', help='Show scored forecasts')
    args = parser.parse_args()
    try:
        if args.command == 'upcoming':
            for e in fresh_year(args.year).get('events', []):
                if e.get('status', {}).get('type', {}).get('state') == 'pre':
                    print(f"{e['date'][:10]}  {e['id']}  {e['name']}  field: {len(e['competitions'][0].get('competitors', []))}")
        elif args.command == 'forecast':
            if args.history_start > args.year or args.simulations < 1:
                raise ValueError('History start must be at or before the event year and simulations must be positive')
            current = fresh_year(args.year)
            event = find_event(current, args.event_id)
            history = []
            for year in range(args.history_start, args.year + 1):
                print(f'Loading history {year}...', file=sys.stderr)
                history.extend(events_from(current if year == args.year else fetch_year(year, args.cache)))
            result = create_forecast(event, history, args.simulations, args.seed, datetime.now(timezone.utc))
            saved_at = datetime.now(timezone.utc)
            if saved_at >= datetime.fromisoformat(event['date'].replace('Z', '+00:00')):
                raise ValueError('The event start deadline passed while the forecast was being generated')
            result['created_at'] = saved_at.isoformat()
            path = args.records / 'forecasts' / f"{result['event_id']}.json"
            save_new(path, result)
            print(f"{result['event']} — {len(result['players'])} players; forecast saved to {path}")
            for p in result['players'][:10]:
                print(f"{p['name']:25} {p['win_probability']:6.2%}  ({p['prior_rounds']} prior rounds)")
        elif args.command == 'score':
            data = fresh_year(args.year)
            for path in sorted((args.records / 'forecasts').glob('*.json')):
                forecast_data = json.loads(path.read_text())
                if forecast_data['event_start'][:4] != str(args.year):
                    continue
                result_path = args.records / 'results' / path.name
                if result_path.exists():
                    continue
                event = find_event(data, forecast_data['event_id'])
                if not event.get('status', {}).get('type', {}).get('completed'):
                    print(f"Pending: {forecast_data['event']}")
                    continue
                result = score_forecast(forecast_data, event)
                save_new(result_path, result)
                print(f"Scored {result['event']}: {result['pick']} / winner {result['winner']}")
        else:
            rows = [json.loads(p.read_text()) for p in sorted((args.records / 'results').glob('*.json'))]
            if not rows:
                print('No scored forecasts yet.')
            else:
                for row in rows:
                    print(f"{row['event']}: pick {row['pick']}; winner {row['winner']}; {'HIT' if row['hit'] else 'MISS'}")
                print(f"Record: {sum(r['hit'] for r in rows)}/{len(rows)}; Brier {statistics.mean(r['brier'] for r in rows):.4f}; uniform {statistics.mean(r['uniform_brier'] for r in rows):.4f}")
    except (ValueError, KeyError, OSError) as exc:
        parser.exit(1, f'Error: {exc}\n')


if __name__ == '__main__':
    main()
