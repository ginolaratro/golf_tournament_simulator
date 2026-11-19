import unittest

from pga_stats import FIELD_QUERY, FIT_QUERY, FORM_QUERY, SCHEDULE_QUERY, attach_stats, find_tournament, normalize_name


def fake_query(query, variables):
    if query == FIELD_QUERY:
        return {'field': {'players': [{'id': '1', 'firstName': 'Ludvig', 'lastName': 'Åberg'},
                                      {'id': '2', 'firstName': 'Davis', 'lastName': 'Thompson'}]}}
    if query == FORM_QUERY:
        return {'fieldStats': {'players': [
            {'playerId': '1', 'totalRounds': '16', 'strokesGained': [{'statId': '02568', 'statValue': '0.900'},
                                                                     {'statId': '02675', 'statValue': '1.500'}]},
            {'playerId': '2', 'totalRounds': '', 'strokesGained': [{'statId': '02568', 'statValue': '-'}]}]}}
    if query == FIT_QUERY:
        return {'fieldStats': {'statHeaders': ['SG: Putting - 4 to 8ft'], 'players': [
            {'playerId': '1', 'score': '12'}, {'playerId': '2', 'score': 'NaN'}]}}
    if query == SCHEDULE_QUERY:
        return {'schedule': {'completed': [{'tournaments': [{'id': 'R2026001', 'tournamentName': 'The Sentry'}]}],
                             'upcoming': [{'tournaments': [{'id': 'R2026493', 'tournamentName': 'The RSM Classic'}]}]}}
    rows = {
        '02568': [{'playerName': 'Ludvig Aberg', 'stats': [{'statName': 'Avg', 'statValue': '0.712'},
                                                           {'statName': 'Measured Rounds', 'statValue': '60'}]}],
        '102': [{'playerName': 'Ludvig Åberg', 'stats': [{'statName': '%', 'statValue': '61.50%'}]},
                {'playerName': 'Davis Thompson', 'stats': [{'statName': '%', 'statValue': '1,0x'}]}],
    }
    return {'statDetails': {'rows': rows.get(variables['id'], [])}}


class StatsTests(unittest.TestCase):
    def test_names_match_across_sources(self):
        self.assertEqual(normalize_name('Ludvig Åberg'), normalize_name('ludvig aberg'))
        self.assertEqual(normalize_name("Sam Burns Jr."), 'sam burns')
        self.assertEqual(normalize_name('S.Y. Noh'), 's y noh')

    def test_attach_combines_season_form_and_course_fit(self):
        players = [{'id': 'e1', 'name': 'Ludvig Åberg'}, {'id': 'e2', 'name': 'Davis Thompson'}, {'id': 'e3', 'name': 'Nobody'}]
        meta = attach_stats(players, 2026, 'R2026493', query=fake_query)
        self.assertEqual(players[0]['stats'], {'sg_app': 0.712, 'sg_rounds': 60, 'driving_accuracy': 61.5,
                                               'form_sg_app': 0.9, 'form_sg_total': 1.5, 'form_rounds': 16, 'course_fit': 12})
        self.assertEqual(players[1]['stats'], {})  # Unparseable values and missing rounds are skipped.
        self.assertEqual(players[2]['stats'], {})
        self.assertEqual(meta['coverage']['sg_app'], 1)
        fit = next(f for f in meta['fields'] if f['key'] == 'course_fit')
        self.assertFalse(fit['higher_is_better'])
        self.assertIn('4 to 8ft', fit['description'])

    def test_find_tournament_by_name(self):
        self.assertEqual(find_tournament(2026, 'The RSM Classic', query=fake_query), 'R2026493')
        with self.assertRaises(ValueError):
            find_tournament(2026, 'Missing Open', query=fake_query)


if __name__ == '__main__':
    unittest.main()
