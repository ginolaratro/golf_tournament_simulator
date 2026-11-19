import json
import unittest

from pga_report import render_report


class ReportTests(unittest.TestCase):
    def test_report_embeds_forecast_safely(self):
        forecast = {'event': '</script><b>Event', 'simulations': 100, 'players': [
            {'name': 'Player', 'win_probability': .12, 'prior_rounds': 4}]}
        report = render_report(forecast)
        self.assertNotIn('</script><b>Event', report)
        payload = report.split('<script id="data" type="application/json">')[1].split('</script>')[0]
        self.assertEqual(json.loads(payload)['forecast'], forecast)
        self.assertIn('From past scores to a forecast', report)


if __name__ == '__main__':
    unittest.main()
