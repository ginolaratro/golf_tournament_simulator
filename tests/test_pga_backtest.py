import random
import unittest
from collections import defaultdict

from pga_backtest import backtest, simulate, update_history


def event(date, end, winner='a'):
    return {'id': date, 'name': date, 'date': date, 'end_date': end,
            'players': [{'id': 'a', 'name': 'A', 'order': 1 if winner == 'a' else 2,
                         'rounds': {i: 70 for i in range(1, 5)}},
                        {'id': 'b', 'name': 'B', 'order': 1 if winner == 'b' else 2,
                         'rounds': {i: 72 for i in range(1, 5)}}]}


class BacktestTests(unittest.TestCase):
    def test_rounds_centered_and_simulation_reproducible(self):
        history = defaultdict(list)
        e = event('2023-01-01', '2023-01-04')
        update_history(e, history)
        self.assertEqual(history['a'], [-1] * 4)
        self.assertEqual(history['b'], [1] * 4)
        p = simulate(e['players'], history, 100, random.Random(3))
        self.assertEqual(p, simulate(e['players'], history, 100, random.Random(3)))
        self.assertAlmostEqual(sum(p), 1)

    def test_overlapping_events_do_not_leak_results(self):
        events = [event('2024-01-01', '2024-01-05'),
                  event('2024-01-04', '2024-01-07'),
                  event('2024-01-08', '2024-01-11')]
        rows = backtest(events, 2024, 100, 1)
        self.assertEqual(rows[1]['pick_prior_rounds'], 0)
        self.assertEqual(rows[2]['pick_prior_rounds'], 8)


if __name__ == '__main__':
    unittest.main()
