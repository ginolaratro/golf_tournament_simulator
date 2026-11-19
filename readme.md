# Golf tournament simulator

The original neural-network tournament and shot-prediction scripts are synthetic demonstrations, not trained PGA Tour models. `pga_backtest.py` adds an independent, reproducible historical baseline using actual PGA Tour results.

## Historical Monte Carlo study

Requires Python 3.9+ and internet access for the first download; no third-party packages are needed.

```bash
python3 pga_backtest.py --years 2022:2024 --test-start 2024 --simulations 10000 --seed 42
```

The command downloads ESPN's public PGA scoreboard data for each year into `.pga-cache/`, then writes a tournament-by-tournament record to `backtest.csv`. Delete a cached year to refresh it; completed historical data can change. The first two years in this example supply prior history and only 2024 is scored. Choose a later `--test-start` and include earlier years for more warm-up. Run `python3 -m unittest discover -s tests -v` for the tests.

For each eligible completed individual stroke-play event, the model estimates each player's average round score relative to that round's field, shrunk toward the field average by 20 prior rounds. It draws four independent rounds with a fixed 2.8-stroke round standard deviation, and the lowest total wins. Monte Carlo wins divided by simulations estimate win probabilities. The CSV records the most likely winner, actual winner, both probabilities, hit, prior round counts and multiclass Brier score. Brier measures the entire probability forecast; lower is better. The uniform-field baseline assigns every entrant the same chance. A fixed seed makes a run reproducible.

The study uses only tournaments that ended before the target event began, including when events overlap. Historical fields come from the completed scoreboard, so withdrawals and late field changes can create hindsight bias. The model simplifies four-round stroke play: it does not simulate cuts, playoffs, withdrawals, course changes, starting strokes, match play, or team formats. It excludes events without enough identifiable round scores and a unique winner, but unusual formats can still enter. Field-relative scores after a cut are affected by selection. Fixed variance and shrinkage are assumptions, not fitted parameters; this is a baseline for investigating patterns, not evidence of betting value. It does not use strokes-gained categories, odds, or course fit.

The CSV is a **retrospective** record: it is regenerated from historical data, not a timestamped archive of forecasts made before play. To track genuine future performance, save predictions and the field before the event starts, then compare that immutable snapshot with official results after it finishes. No automatic live forecast or results reconciliation is implemented yet.

Data source: [ESPN PGA scoreboard](https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=2024&limit=500), an unofficial public endpoint that can change or be unavailable. Check the provider's terms before redistributing data. For richer round-level strokes-gained and stable player identifiers, [Data Golf's API](https://datagolf.com/api-access) is a possible licensed source; access and historical coverage depend on its subscription.
