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

## Pre-tournament forecasts and tracking

The separate forecast workflow saves a local snapshot before an event, then compares it with the final ESPN result. For example:

```bash
python3 pga_forecast.py upcoming --year 2026
python3 pga_forecast.py forecast --year 2026 --event-id 401850981 --history-start 2022 --simulations 10000
python3 pga_forecast.py score --year 2026
python3 pga_forecast.py record
```

Find event IDs and field sizes with `upcoming`; run `forecast` for each event with a published field. The current year's scoreboard is fetched fresh. A snapshot is saved once to `forecast-records/forecasts/<event-id>.json` and is never overwritten by the command. The event must still be marked scheduled, and the command refuses forecasts at or after ESPN's listed start timestamp (which may be an early date placeholder rather than a tee time). It includes only completed prior tournaments ending before the event's date. Late withdrawals or field changes are not incorporated after the snapshot. Forecasts are local files, not tamper-proof timestamped records; back them up. The `forecast-records` directory is ignored by Git.

After an event is final, `score` saves a separate result for each unscored event in that year; `record` summarizes hits and Brier scores. If a winner joined the field after the snapshot, that winner is scored at zero probability. Forecasts and records do not update automatically: run the commands for each event and after results are final. ESPN availability and field completeness are outside the project's control. The simulation is for individual four-round stroke play; don't use it for team, match play, or starting-strokes events without a format-specific model. It does not model cuts or course changes and provides no proven betting advantage.

## Visual forecast report

Create a self-contained HTML report from any saved forecast and open it in a browser:

```bash
python3 pga_report.py forecast-records/forecasts/401850981.json --output forecast-records/rsm-report.html
```

The report charts player win probabilities, explains the simulation, and shows the actual winner if a matching result is supplied. After scoring an event, rebuild with `--result forecast-records/results/401850981.json`. Reports use only the saved forecast and optional result; creating one does not rerun the simulation or require internet access.

## Interactive Vercel dashboard

`site/` contains a static interactive model lab. The initial chart shows a saved forecast. Changing variation, prior strength, historical skill influence, or a selected player's score and volatility adjustments and clicking **Run simulation** runs new Monte Carlo trials in the visitor's browser. The progress bar, recent winners, and probabilities update from actual simulation batches. Experiments are not saved and are not pre-event forecasts. Results vary slightly between runs due to random sampling.

The field and historical inputs in `site/data/model.json` are a fixed snapshot, not a live field or automatically updated data feed. To update it with a saved forecast, reconstruct historical inputs and redeploy:

```bash
python3 export_dashboard.py forecast-records/forecasts/EVENT_ID.json --history-start 2022
vercel deploy site --prod --project golf-tournament-forecast
```

The exporter checks that historical round counts match the saved forecast and refuses mismatches. This check cannot detect source revisions that preserve round counts; preserve original data snapshots if exact historical reproducibility matters. The model inputs are published when deployed. The standalone report from `pga_report.py` remains available separately.

Run `node tests/test_dashboard.js` to check the browser dashboard logic without a browser.
