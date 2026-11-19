# Golf tournament simulator

Monte Carlo forecasts for PGA Tour stroke-play events, built from real round scores. The project:

- **Backtests** a simple skill model against past tournaments, scored by hit rate and Brier score (`pga_backtest.py`).
- **Saves pre-tournament forecasts** before an event starts and scores them against official results afterwards (`pga_forecast.py`).
- **Renders a static HTML report** for any saved forecast (`pga_report.py`).
- **Publishes an interactive model lab** on Vercel (`site/`). Visitors change assumptions, weight PGA Tour strokes-gained, traditional, recent-form and course-fit stats, add their own custom fields, and rerun thousands of simulated tournaments in the browser.

The core uses only the Python standard library; data comes from ESPN's and PGA Tour's public (unofficial) endpoints. It is a research and learning tool, not betting advice.

The original neural-network tournament and shot-prediction scripts are synthetic demonstrations, not trained PGA Tour models. `pga_backtest.py` adds an independent, reproducible historical baseline using actual PGA Tour results.

## Historical Monte Carlo study

Requires Python 3.9+ and internet access for the first download; no third-party packages are needed.

```bash
python3 pga_backtest.py --years 2022:2024 --test-start 2024 --simulations 10000 --seed 42
```

The command downloads ESPN's public PGA scoreboard data for each year into `.pga-cache/`, then writes a tournament-by-tournament record to `backtest.csv`. Delete a cached year to refresh it; completed historical data can change. The first two years in this example supply prior history and only 2024 is scored. Choose a later `--test-start` and include earlier years for more warm-up. Run `python3 -m unittest discover -s tests -v` for the tests.

For each eligible completed individual stroke-play event, the model estimates each player's average round score relative to that round's field, shrunk toward the field average by 20 prior rounds. It draws four independent rounds with a fixed 2.8-stroke round standard deviation, and the lowest total wins. Monte Carlo wins divided by simulations estimate win probabilities. The CSV records the most likely winner, actual winner, both probabilities, hit, prior round counts and multiclass Brier score. Brier measures the entire probability forecast; lower is better. The uniform-field baseline assigns every entrant the same chance. A fixed seed makes a run reproducible.

The study uses only tournaments that ended before the target event began, including when events overlap. Historical fields come from the completed scoreboard, so withdrawals and late field changes can create hindsight bias. The model simplifies four-round stroke play: it does not simulate cuts, playoffs, withdrawals, course changes, starting strokes, match play, or team formats. It excludes events without enough identifiable round scores and a unique winner, but unusual formats can still enter. Field-relative scores after a cut are affected by selection. Fixed variance and shrinkage are assumptions, not fitted parameters; this is a baseline for investigating patterns, not evidence of betting value. The backtest and saved forecasts do not use strokes-gained categories, odds, or course fit; those are available only as user-weighted inputs in the dashboard.

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
vercel deploy --prod --project golf-tournament-forecast
```

The exporter checks that historical round counts match the saved forecast and refuses mismatches. This check cannot detect source revisions that preserve round counts; preserve original data snapshots if exact historical reproducibility matters. The model inputs are published when deployed. The standalone report from `pga_report.py` remains available separately.

Run `node tests/test_dashboard.js` to check the browser dashboard logic without a browser.

### Strokes gained, stats and custom fields

By default, `export_dashboard.py` also adds PGA Tour stats for each player from the GraphQL feed behind pgatour.com (`pga_stats.py`):

- **Season strokes gained:** total, tee-to-green, off-the-tee, approach, around-the-green and putting, plus measured rounds.
- **Traditional stats:** driving distance, driving accuracy, greens in regulation, scrambling, birdies per round, bogey rate and adjusted scoring average.
- **Recent form:** strokes gained by category over the last five starts.
- **PGA Tour course fit** for the event.

PGA Tour only lists qualified players in its season leaderboards, so some fields have partial coverage. The dashboard shows coverage for each field, and players without data count as field average. The tournament is matched by name; pass `--pga-tournament-id R2026493` if that fails, or `--no-stats` to skip stats. The feed shows current numbers, so the exporter refuses to run once the event has started. `--allow-post-start-stats` overrides that and labels the data as possibly including the event's own rounds. The feed is unofficial and undocumented; check PGA Tour's terms before redistributing.

In the dashboard, each stat has a weight that starts at zero, so the defaults reproduce the saved forecast. Strokes-gained weights multiply strokes per round relative to the field. Other stats use strokes per round per standard deviation. Presets (strokes-gained blend, ball-striking, recent form) are illustrative starting points, not fitted or backtested. Stats overlap with score history and with each other, so stacking weights double-counts. **Custom fields** accept pasted `Player name, value` lines. Values are standardized against the listed players and saved only in the visitor's browser. `python3 pga_stats.py --year 2026 --tournament-id R2026493` prints field coverage.

### Guided scenarios

The lab groups assumptions into scenario selection, field strength and uncertainty, skill categories, and player hypotheses. Each stat has an explanation, coverage count, units and an illustrative starting range. Expand a skill category to fine-tune it. Start with score history to establish a baseline.

Try **Course plays hard** (approach and recovery emphasis), **Birdie contest**, or **Rookie contender**. For the rookie scenario, select a known rookie manually: the data does not identify rookies or predict participation. It applies a hypothetical −0.3 strokes per round and 1.2× variation to the selected player, with 30 prior rounds. These are sensitivity experiments, not fitted predictions. A hard course scenario changes skill emphasis; it does not forecast absolute scores or weather.

Switching presets restores round variation, shrinkage and player adjustments, replaces all stat weights, and disables custom-field weights so earlier experiments do not leak into the scenario. Player selection and simulation count are retained. Run the simulation after each change.

The root `vercel.json` publishes only `site/` as the output directory for repository-based deployments. Run the deploy command from the repository root; deploying the repository without this setting serves the dashboard under `/site/` and leaves `/` without a homepage.

### Explaining the forecast leader

The results include a **Show the math** explanation built from numeric inputs and actual simulation counts, with no LLM. It shows the leader's shrunk score history, weighted stat effects, player adjustment, four-round normal score formula, and win-count fraction. A new run also retains the final trial's winning draw and runner-up score. Saved forecasts do not contain individual draws, so those are explicitly unavailable until a new run. The explanation captures the assumptions used for the displayed results; editing controls does not rewrite past results.
