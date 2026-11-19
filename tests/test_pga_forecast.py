import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from pga_forecast import create_forecast, save_new, score_forecast


def fixture():
    return {'id': '1', 'name': 'Example', 'date': '2026-06-01T05:00Z',
            'status': {'type': {'state': 'pre', 'completed': False}},
            'competitions': [{'competitors': [
                {'id': str(i), 'athlete': {'displayName': f'Player {i}'}, 'order': i + 1}
                for i in range(20)]}]}


class ForecastTests(unittest.TestCase):
    def test_forecast_is_pre_event_and_snapshot_cannot_be_overwritten(self):
        event = fixture()
        now = datetime(2026, 5, 31, tzinfo=timezone.utc)
        forecast = create_forecast(event, [], 100, 42, now)
        self.assertAlmostEqual(sum(p['win_probability'] for p in forecast['players']), 1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'one.json'
            save_new(path, forecast)
            with self.assertRaises(FileExistsError):
                save_new(path, forecast)
        with self.assertRaises(ValueError):
            create_forecast(event, [], 100, 42, datetime(2026, 6, 1, 5, tzinfo=timezone.utc))
        event['status']['type']['state'] = 'in'
        with self.assertRaises(ValueError):
            create_forecast(event, [], 100, 42, now)

    def test_results_pending_hit_and_late_winner(self):
        event = fixture()
        forecast = create_forecast(event, [], 100, 42, datetime(2026, 5, 31, tzinfo=timezone.utc))
        with self.assertRaises(ValueError):
            score_forecast(forecast, event)
        event['status']['type']['completed'] = True
        players = event['competitions'][0]['competitors']
        for player in players:
            player['order'] = 2
        chosen = next(p for p in players if p['id'] == forecast['players'][0]['id'])
        chosen['order'] = 1
        self.assertTrue(score_forecast(forecast, event)['hit'])
        chosen['order'] = 2
        players.append({'id': 'late', 'order': 1, 'athlete': {'displayName': 'Late'}})
        result = score_forecast(forecast, event)
        self.assertFalse(result['winner_in_forecast_field'])
        self.assertEqual(result['winner_probability'], 0)
        self.assertGreater(result['brier'], 1)


if __name__ == '__main__':
    unittest.main()
