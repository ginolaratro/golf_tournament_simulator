"""Export historical inputs for an existing forecast to the interactive dashboard."""
import argparse
import json
from collections import defaultdict
from pathlib import Path

from pga_backtest import events_from, fetch_year, update_history
from pga_forecast import fresh_year


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('forecast', type=Path)
    parser.add_argument('--history-start', type=int, required=True)
    parser.add_argument('--cache', type=Path, default=Path('.pga-cache'))
    parser.add_argument('--output', type=Path, default=Path('site/data/model.json'))
    args = parser.parse_args()
    forecast = json.loads(args.forecast.read_text())
    year = int(forecast['event_start'][:4])
    if args.history_start > year:
        parser.error('History start cannot be after the event year')
    history = defaultdict(list)
    for y in range(args.history_start, year + 1):
        data = fresh_year(y) if y == year else fetch_year(y, args.cache)
        for event in events_from(data):
            if event['end_date'] < forecast['event_start'][:10]:
                update_history(event, history)
    mismatches = [p['name'] for p in forecast['players'] if len(history[p['id']]) != p['prior_rounds']]
    if mismatches:
        parser.error(f"Historical data no longer matches the snapshot for {len(mismatches)} players; cannot faithfully reconstruct inputs")
    for player in forecast['players']:
        player['round_sum'] = round(sum(history[player['id']]), 8)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(forecast, indent=2) + '\n')
    print(f'Exported {len(forecast["players"])} players to {args.output}')


if __name__ == '__main__':
    main()
