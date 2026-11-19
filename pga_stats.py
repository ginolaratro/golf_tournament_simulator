"""PGA Tour strokes-gained and traditional statistics for the model lab.

Uses the GraphQL endpoint behind pgatour.com's stats pages. It is unofficial and
undocumented, so it can change or disappear; check PGA Tour's terms before
redistributing data. The key is the public one the website sends from every browser.
"""
import argparse
import json
import re
import unicodedata
import urllib.request

ENDPOINT = 'https://orchestrator.pgatour.com/graphql'
PUBLIC_KEY = 'da2-gsrx5bibzbb4njvhl7t37wqyl4'

# key, PGA Tour stat ID, label, unit, column holding the value, higher_is_better
SEASON_STATS = [
    ('sg_total', '02675', 'SG: Total', 'strokes/round', 'Avg', True),
    ('sg_t2g', '02674', 'SG: Tee-to-Green', 'strokes/round', 'Avg', True),
    ('sg_ott', '02567', 'SG: Off-the-Tee', 'strokes/round', 'Avg', True),
    ('sg_app', '02568', 'SG: Approach', 'strokes/round', 'Avg', True),
    ('sg_arg', '02569', 'SG: Around-the-Green', 'strokes/round', 'Avg', True),
    ('sg_putt', '02564', 'SG: Putting', 'strokes/round', 'Avg', True),
    ('driving_distance', '101', 'Driving distance', 'yards', 'Avg', True),
    ('driving_accuracy', '102', 'Driving accuracy', '%', '%', True),
    ('gir', '103', 'Greens in regulation', '%', '%', True),
    ('scrambling', '130', 'Scrambling', '%', '%', True),
    ('birdie_average', '156', 'Birdies per round', 'birdies', 'Avg', True),
    ('bogey_rate', '02414', 'Bogey rate', '% of holes', '% Makes Bogey', False),
    ('scoring_average', '120', 'Adjusted scoring average', 'strokes', 'Avg', False),
]
# Last-five-starts strokes gained, keyed by the stat ID PGA Tour returns.
FORM_STATS = [
    ('form_sg_ott', '02567', 'Form SG: Off-the-Tee'),
    ('form_sg_app', '02568', 'Form SG: Approach'),
    ('form_sg_arg', '02569', 'Form SG: Around-the-Green'),
    ('form_sg_putt', '02564', 'Form SG: Putting'),
    ('form_sg_total', '02675', 'Form SG: Total'),
]
SEASON_QUERY = ('query($id: String!, $year: Int) { statDetails(tourCode: R, statId: $id, year: $year) {'
                ' rows { ... on StatDetailsPlayer { playerId playerName stats { statName statValue } } } } }')
FIELD_QUERY = 'query($id: ID!) { field(id: $id) { players { id firstName lastName } } }'
FORM_QUERY = ('query($id: ID!) { fieldStats(tournamentId: $id, fieldStatType: CURRENT_FORM) { players {'
              ' ... on FieldStatCurrentForm { playerId totalRounds strokesGained { statId statValue } } } } }')
FIT_QUERY = ('query($id: ID!) { fieldStats(tournamentId: $id, fieldStatType: COURSE_FIT) { statHeaders players {'
             ' ... on FieldStatCourseFit { playerId totalRounds score } } } }')
SCHEDULE_QUERY = ('query($year: String) { schedule(tourCode: "R", year: $year) {'
                  ' completed { tournaments { id tournamentName } } upcoming { tournaments { id tournamentName } } } }')


def graphql(query, variables):
    body = json.dumps({'query': query, 'variables': variables}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={
        'Content-Type': 'application/json', 'x-api-key': PUBLIC_KEY, 'User-Agent': 'golf-research/1.0'})
    with urllib.request.urlopen(req, timeout=60) as response:
        payload = json.load(response)
    if payload.get('errors') or not payload.get('data'):
        raise ValueError(f'PGA Tour stats request failed: {payload.get("errors")}')
    return payload['data']


def normalize_name(name):
    """Fold accents, punctuation and suffixes so ESPN and PGA Tour names match."""
    text = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    text = re.sub(r'[^a-z ]', ' ', text.replace("'", ''))
    return ' '.join(w for w in text.split() if w not in {'jr', 'sr', 'ii', 'iii', 'iv'})


def parse_number(text):
    try:
        value = float(str(text).replace(',', '').replace('%', '').strip())
    except ValueError:
        return None
    return value if value == value else None  # Reject NaN.


def season_table(details):
    """{normalized name: {stat key: value}} from statDetails responses keyed by stat key."""
    table = {}
    for key, _, _, _, column, _ in SEASON_STATS:
        for row in details.get(key) or []:
            values = {s.get('statName'): parse_number(s.get('statValue')) for s in row.get('stats', [])}
            if not row.get('playerName') or values.get(column) is None:
                continue
            entry = table.setdefault(normalize_name(row['playerName']), {})
            entry[key] = values[column]
            if key.startswith('sg_') and values.get('Measured Rounds') is not None:
                entry['sg_rounds'] = max(entry.get('sg_rounds', 0), int(values['Measured Rounds']))
    return table


def form_table(players):
    by_id = {sid: key for key, sid, _ in FORM_STATS}
    table = {}
    for row in players:
        entry = {by_id[s['statId']]: parse_number(s.get('statValue'))
                 for s in row.get('strokesGained', []) if s.get('statId') in by_id}
        entry = {k: v for k, v in entry.items() if v is not None}
        rounds = parse_number(row.get('totalRounds'))
        if entry and rounds:
            entry['form_rounds'] = int(rounds)
            table[str(row['playerId'])] = entry
    return table


def fit_table(players):
    table = {}
    for row in players:
        score = parse_number(row.get('score'))
        if score is not None:
            table[str(row['playerId'])] = {'course_fit': score}
    return table


def find_tournament(year, event_name, query=graphql):
    data = query(SCHEDULE_QUERY, {'year': str(year)})['schedule']
    target = normalize_name(event_name)
    matches = {t['id'] for part in ('completed', 'upcoming') for month in data.get(part) or []
               for t in month.get('tournaments', []) if normalize_name(t['tournamentName']) == target}
    if len(matches) != 1:
        raise ValueError(f'Could not uniquely match "{event_name}" on the PGA Tour schedule; pass --pga-tournament-id')
    return matches.pop()


def field_definitions(course_fit_headers=()):
    fields = [{'key': k, 'stat_id': sid, 'label': label, 'unit': unit, 'higher_is_better': better,
               'group': 'strokes_gained' if k.startswith('sg_') else 'traditional', 'source': 'season'}
              for k, sid, label, unit, _, better in SEASON_STATS]
    fields += [{'key': k, 'stat_id': sid, 'label': label, 'unit': 'strokes/round', 'higher_is_better': True,
                'group': 'form', 'source': 'last 5 starts'} for k, sid, label in FORM_STATS]
    fields.append({'key': 'course_fit', 'label': 'PGA Tour course fit', 'unit': 'fit score',
                   'higher_is_better': False, 'group': 'course_fit', 'source': 'PGA Tour course fit',
                   'description': 'Lower is a better fit. Based on: ' + ', '.join(course_fit_headers)})
    return fields


def attach_stats(players, year, tournament_id, query=graphql):
    """Add a stats dict to each forecast player and return dataset metadata."""
    details = {key: query(SEASON_QUERY, {'id': sid, 'year': year})['statDetails']['rows']
               for key, sid, *_ in SEASON_STATS}
    season = season_table(details)
    names = {str(p['id']): normalize_name(f"{p['firstName']} {p['lastName']}")
             for p in query(FIELD_QUERY, {'id': tournament_id})['field']['players']}
    form_data = query(FORM_QUERY, {'id': tournament_id})['fieldStats'] or {'players': []}
    fit_data = query(FIT_QUERY, {'id': tournament_id})['fieldStats'] or {'players': [], 'statHeaders': []}
    by_name = {}
    for pga_id, entry in form_table(form_data['players']).items():
        by_name.setdefault(names.get(pga_id), {}).update(entry)
    for pga_id, entry in fit_table(fit_data['players']).items():
        by_name.setdefault(names.get(pga_id), {}).update(entry)
    coverage = {}
    for player in players:
        key = normalize_name(player['name'])
        player['stats'] = {**season.get(key, {}), **by_name.get(key, {})}
        for stat in player['stats']:
            coverage[stat] = coverage.get(stat, 0) + 1
    return {'season': year, 'pga_tournament_id': tournament_id, 'fields': field_definitions(fit_data.get('statHeaders') or []),
            'coverage': coverage, 'source': 'PGA Tour stats (orchestrator.pgatour.com, unofficial)'}


def main():
    parser = argparse.ArgumentParser(description='Print PGA Tour stat coverage for a tournament field')
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--tournament-id', required=True, help='PGA Tour ID such as R2026493')
    args = parser.parse_args()
    names = graphql(FIELD_QUERY, {'id': args.tournament_id})['field']['players']
    players = [{'name': f"{p['firstName']} {p['lastName']}"} for p in names]
    meta = attach_stats(players, args.year, args.tournament_id)
    for field in meta['fields']:
        print(f"{field['label']:28} {meta['coverage'].get(field['key'], 0)}/{len(players)} players")


if __name__ == '__main__':
    main()
