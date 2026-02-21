import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
from dataclasses import dataclass
from typing import Dict, List, Tuple
import json

# ============================================================
# Golf Tournament Simulator with Neural Scoring Model
#
# Components:
#   1. GolferScoringModel - NN that predicts scoring distribution
#   2. TournamentSimulator - Monte Carlo tournament simulation
#   3. BettingEdgeEngine - Find +EV betting opportunities
# ============================================================


# ------------------------------------------------------------
# 1. GOLFER SCORING MODEL
# Predicts mean and std of a golfer's scoring distribution
# given their stats and course characteristics
# ------------------------------------------------------------

class GolferScoringModel(nn.Module):
    """
    Neural network that outputs scoring distribution parameters.

    Inputs (12 features):
        - sg_off_tee: Strokes gained off the tee (season avg)
        - sg_approach: Strokes gained approach
        - sg_around_green: Strokes gained around green
        - sg_putting: Strokes gained putting
        - sg_total: Total strokes gained
        - recent_form: Avg score vs field last 5 tournaments
        - course_history: Avg score vs field at this course
        - course_length: Course length (normalized)
        - course_difficulty: Scoring avg vs par (normalized)
        - rounds_played: Experience factor (log scaled)
        - days_rest: Days since last tournament
        - world_ranking: OWGR (log scaled)

    Outputs:
        - mu: Expected score relative to field (negative = better)
        - log_sigma: Log of std dev (ensures positive sigma)
        - skew: Distribution skewness (captures blowup rounds)
    """

    def __init__(self, input_dim=12, hidden_dims=[64, 32]):
        super().__init__()

        layers = []
        prev_dim = input_dim
        for h_dim in hidden_dims:
            layers.extend([
                nn.Linear(prev_dim, h_dim),
                nn.LayerNorm(h_dim),
                nn.LeakyReLU(0.1),
                nn.Dropout(0.15)
            ])
            prev_dim = h_dim

        self.backbone = nn.Sequential(*layers)

        # Separate heads for distribution parameters
        self.head_mu = nn.Linear(hidden_dims[-1], 1)
        self.head_log_sigma = nn.Linear(hidden_dims[-1], 1)
        self.head_skew = nn.Linear(hidden_dims[-1], 1)

    def forward(self, x):
        features = self.backbone(x)

        mu = self.head_mu(features)
        log_sigma = self.head_log_sigma(features)
        skew = torch.tanh(self.head_skew(features)) * 2  # Bound skew to [-2, 2]

        return {
            'mu': mu.squeeze(-1),
            'sigma': torch.exp(log_sigma).squeeze(-1),
            'skew': skew.squeeze(-1)
        }

    def sample_scores(self, x, n_samples=1):
        """Sample round scores from predicted distribution."""
        with torch.no_grad():
            params = self.forward(x)

            # Use skew-normal sampling
            mu = params['mu'].unsqueeze(-1)
            sigma = params['sigma'].unsqueeze(-1)
            skew = params['skew'].unsqueeze(-1)

            # Generate skew-normal samples
            u1 = torch.randn(x.shape[0], n_samples)
            u2 = torch.randn(x.shape[0], n_samples)

            # Skew-normal transformation
            delta = skew / torch.sqrt(1 + skew**2)
            z = delta * torch.abs(u1) + torch.sqrt(1 - delta**2) * u2

            scores = mu + sigma * z

        return scores


class ScoringModelLoss(nn.Module):
    """Negative log-likelihood loss for scoring distribution."""

    def forward(self, predictions, actual_scores):
        mu = predictions['mu']
        sigma = predictions['sigma'] + 1e-6

        # Gaussian NLL (simplified, ignoring skew for training stability)
        nll = 0.5 * torch.log(2 * np.pi * sigma**2) + \
              0.5 * ((actual_scores - mu)**2) / (sigma**2)

        return nll.mean()


# ------------------------------------------------------------
# 2. TOURNAMENT SIMULATOR
# Monte Carlo simulation of full tournaments
# ------------------------------------------------------------

@dataclass
class Golfer:
    name: str
    features: torch.Tensor  # Shape: (12,)
    odds: float = None      # Decimal odds from sportsbook


class TournamentSimulator:
    """
    Simulates tournaments using the scoring model.

    For each simulation:
        1. Sample 4 round scores for each golfer
        2. Sum to get tournament total
        3. Determine winner (lowest total)
        4. Track all placements
    """

    def __init__(self, model: GolferScoringModel, course_par: int = 72):
        self.model = model
        self.model.eval()
        self.course_par = course_par

    def simulate(self, golfers: List[Golfer], n_simulations: int = 10000,
                 n_rounds: int = 4) -> Dict:
        """
        Run tournament simulations.

        Returns:
            Dictionary with win counts, top5/10/20 counts, avg finish
        """
        n_golfers = len(golfers)

        # Stack all golfer features
        features = torch.stack([g.features for g in golfers])

        # Track results
        wins = np.zeros(n_golfers)
        top5 = np.zeros(n_golfers)
        top10 = np.zeros(n_golfers)
        top20 = np.zeros(n_golfers)
        made_cut = np.zeros(n_golfers)
        total_finish = np.zeros(n_golfers)

        for sim in range(n_simulations):
            # Sample all rounds at once: (n_golfers, n_rounds)
            round_scores = self.model.sample_scores(features, n_samples=n_rounds)

            # Tournament totals
            totals = round_scores.sum(dim=1).numpy()

            # Simulate cut (top 65 + ties after round 2)
            r2_totals = round_scores[:, :2].sum(dim=1).numpy()
            cut_line = np.partition(r2_totals, min(65, n_golfers-1))[min(65, n_golfers-1)]
            made_cut_mask = r2_totals <= cut_line

            # For those who missed cut, set high total
            totals[~made_cut_mask] = 999

            # Rankings
            rankings = np.argsort(np.argsort(totals)) + 1

            # Update counts
            wins += (rankings == 1)
            top5 += (rankings <= 5)
            top10 += (rankings <= 10)
            top20 += (rankings <= 20)
            made_cut += made_cut_mask
            total_finish += np.minimum(rankings, n_golfers)  # Cap at field size

        # Compile results
        results = {}
        for i, golfer in enumerate(golfers):
            results[golfer.name] = {
                'win_prob': wins[i] / n_simulations,
                'top5_prob': top5[i] / n_simulations,
                'top10_prob': top10[i] / n_simulations,
                'top20_prob': top20[i] / n_simulations,
                'make_cut_prob': made_cut[i] / n_simulations,
                'avg_finish': total_finish[i] / n_simulations,
                'implied_odds': n_simulations / wins[i] if wins[i] > 0 else float('inf')
            }

        return results


# ------------------------------------------------------------
# 3. BETTING EDGE ENGINE
# Compare model probabilities to sportsbook odds
# ------------------------------------------------------------

class BettingEdgeEngine:
    """
    Identifies +EV betting opportunities.

    Edge = (Model Prob * Decimal Odds) - 1

    Kelly Criterion for optimal bet sizing:
        f* = (p * b - q) / b
        where p = model prob, q = 1-p, b = decimal odds - 1
    """

    def __init__(self, min_edge: float = 0.05, max_kelly_fraction: float = 0.25):
        self.min_edge = min_edge
        self.max_kelly_fraction = max_kelly_fraction

    def find_edges(self, simulation_results: Dict, golfers: List[Golfer],
                   bet_type: str = 'win') -> List[Dict]:
        """
        Find betting edges for a given bet type.

        Args:
            simulation_results: Output from TournamentSimulator
            golfers: List of Golfer objects with odds
            bet_type: 'win', 'top5', 'top10', 'top20', 'make_cut'

        Returns:
            List of betting opportunities sorted by edge
        """
        prob_key = f'{bet_type}_prob' if bet_type != 'win' else 'win_prob'

        opportunities = []

        for golfer in golfers:
            if golfer.odds is None:
                continue

            result = simulation_results[golfer.name]
            model_prob = result[prob_key]

            if model_prob == 0:
                continue

            # Calculate edge
            decimal_odds = golfer.odds
            implied_prob = 1 / decimal_odds
            edge = (model_prob * decimal_odds) - 1

            # Kelly criterion
            b = decimal_odds - 1
            q = 1 - model_prob
            kelly = (model_prob * b - q) / b if b > 0 else 0
            kelly = max(0, min(kelly, self.max_kelly_fraction))  # Cap Kelly

            if edge >= self.min_edge:
                opportunities.append({
                    'golfer': golfer.name,
                    'bet_type': bet_type,
                    'model_prob': model_prob,
                    'implied_prob': implied_prob,
                    'decimal_odds': decimal_odds,
                    'edge': edge,
                    'kelly_fraction': kelly,
                    'rating': edge * model_prob  # Risk-adjusted edge
                })

        # Sort by edge
        opportunities.sort(key=lambda x: x['edge'], reverse=True)
        return opportunities

    def generate_report(self, simulation_results: Dict, golfers: List[Golfer],
                        bankroll: float = 1000) -> str:
        """Generate a full betting analysis report."""
        lines = []
        lines.append("=" * 60)
        lines.append("BETTING EDGE ANALYSIS")
        lines.append("=" * 60)

        for bet_type in ['win', 'top5', 'top10', 'top20']:
            edges = self.find_edges(simulation_results, golfers, bet_type)

            if edges:
                lines.append(f"\n{bet_type.upper()} BETS:")
                lines.append("-" * 40)

                for opp in edges[:5]:  # Top 5 per category
                    suggested_bet = bankroll * opp['kelly_fraction']
                    lines.append(
                        f"  {opp['golfer']}: "
                        f"Edge={opp['edge']:.1%}, "
                        f"Model={opp['model_prob']:.1%}, "
                        f"Odds={opp['decimal_odds']:.1f}, "
                        f"Bet=${suggested_bet:.0f}"
                    )

        lines.append("\n" + "=" * 60)
        return "\n".join(lines)


# ------------------------------------------------------------
# 4. SYNTHETIC DATA & TRAINING DEMO
# ------------------------------------------------------------

def create_synthetic_golfer_data(n_golfers: int = 100, n_tournaments: int = 20):
    """
    Create synthetic training data.

    In practice, you'd pull this from:
        - pgatour.com/stats
        - datagolf.com
        - ESPN/CBS Sports APIs
    """
    torch.manual_seed(42)
    np.random.seed(42)

    all_features = []
    all_scores = []

    for golfer_id in range(n_golfers):
        # Base skill level
        skill = np.random.normal(0, 1)

        for tourn in range(n_tournaments):
            # Generate features
            sg_ott = skill * 0.3 + np.random.normal(0, 0.3)
            sg_app = skill * 0.4 + np.random.normal(0, 0.4)
            sg_arg = skill * 0.15 + np.random.normal(0, 0.2)
            sg_putt = skill * 0.15 + np.random.normal(0, 0.5)
            sg_total = sg_ott + sg_app + sg_arg + sg_putt
            recent_form = skill + np.random.normal(0, 0.5)
            course_history = np.random.normal(0, 1)
            course_length = np.random.normal(0, 1)
            course_difficulty = np.random.normal(0, 0.5)
            rounds_played = np.log(100 + golfer_id * 10)
            days_rest = np.random.randint(7, 30)
            world_ranking = np.log(golfer_id + 1)

            features = torch.tensor([
                sg_ott, sg_app, sg_arg, sg_putt, sg_total,
                recent_form, course_history, course_length,
                course_difficulty, rounds_played, days_rest / 30,
                world_ranking / 5
            ], dtype=torch.float32)

            # Generate actual tournament score (relative to field)
            # Better players (higher skill) score lower
            true_mu = -sg_total + course_difficulty * 0.5
            true_sigma = 2.5 - skill * 0.3  # Better players more consistent
            actual_score = np.random.normal(true_mu, max(true_sigma, 1))

            all_features.append(features)
            all_scores.append(actual_score)

    X = torch.stack(all_features)
    y = torch.tensor(all_scores, dtype=torch.float32)

    return X, y


def train_model(X, y, n_epochs=200, lr=0.001):
    """Train the scoring model."""
    model = GolferScoringModel()
    criterion = ScoringModelLoss()
    optimizer = optim.Adam(model.parameters(), lr=lr)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, n_epochs)

    # Train/val split
    n_train = int(0.8 * len(X))
    indices = torch.randperm(len(X))
    train_idx, val_idx = indices[:n_train], indices[n_train:]

    X_train, y_train = X[train_idx], y[train_idx]
    X_val, y_val = X[val_idx], y[val_idx]

    best_val_loss = float('inf')

    for epoch in range(n_epochs):
        # Training
        model.train()
        optimizer.zero_grad()
        preds = model(X_train)
        loss = criterion(preds, y_train)
        loss.backward()
        optimizer.step()
        scheduler.step()

        # Validation
        model.eval()
        with torch.no_grad():
            val_preds = model(X_val)
            val_loss = criterion(val_preds, y_val)

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_state = model.state_dict().copy()

        if (epoch + 1) % 50 == 0:
            print(f"Epoch {epoch+1:3d} | Train: {loss:.4f} | Val: {val_loss:.4f}")

    model.load_state_dict(best_state)
    return model


# ------------------------------------------------------------
# 5. MAIN DEMO
# ------------------------------------------------------------

if __name__ == '__main__':
    print("=" * 60)
    print("GOLF TOURNAMENT SIMULATION ENGINE")
    print("=" * 60)

    # Create and train model
    print("\n[1] Training scoring model...")
    X, y = create_synthetic_golfer_data()
    model = train_model(X, y, n_epochs=200)

    # Create sample tournament field
    print("\n[2] Creating tournament field...")

    # Top players with realistic features and betting odds
    players_data = [
        ("Scottie Scheffler", [0.8, 1.2, 0.3, 0.2, 2.5, 0.5, 0.3, 0.1, 0.0, 4.5, 0.4, 0.0], 6.0),
        ("Rory McIlroy", [1.0, 0.8, 0.2, 0.3, 2.3, 0.4, 0.5, 0.2, 0.0, 4.8, 0.3, 0.1], 8.0),
        ("Jon Rahm", [0.7, 1.0, 0.4, 0.3, 2.4, 0.3, 0.2, 0.0, 0.0, 4.6, 0.5, 0.1], 9.0),
        ("Viktor Hovland", [0.5, 0.9, 0.1, 0.4, 1.9, 0.2, 0.1, 0.1, 0.0, 4.2, 0.4, 0.2], 15.0),
        ("Patrick Cantlay", [0.3, 0.7, 0.3, 0.5, 1.8, 0.1, 0.4, -0.1, 0.0, 4.5, 0.3, 0.2], 18.0),
        ("Xander Schauffele", [0.6, 0.8, 0.3, 0.4, 2.1, 0.3, 0.3, 0.0, 0.0, 4.4, 0.4, 0.2], 12.0),
        ("Collin Morikawa", [0.2, 1.1, 0.2, 0.2, 1.7, 0.0, 0.2, -0.1, 0.0, 4.1, 0.5, 0.3], 20.0),
        ("Ludvig Aberg", [0.7, 0.7, 0.2, 0.3, 1.9, 0.4, 0.0, 0.2, 0.0, 3.8, 0.3, 0.4], 14.0),
        ("Wyndham Clark", [0.6, 0.5, 0.2, 0.4, 1.7, 0.2, 0.1, 0.1, 0.0, 4.0, 0.4, 0.4], 25.0),
        ("Max Homa", [0.4, 0.6, 0.3, 0.3, 1.6, 0.1, 0.3, 0.0, 0.0, 4.3, 0.3, 0.4], 30.0),
        ("Tommy Fleetwood", [0.3, 0.7, 0.2, 0.2, 1.4, 0.0, 0.2, 0.0, 0.0, 4.6, 0.4, 0.5], 35.0),
        ("Sahith Theegala", [0.5, 0.4, 0.3, 0.3, 1.5, 0.3, 0.0, 0.1, 0.0, 3.9, 0.3, 0.5], 40.0),
    ]

    golfers = []
    for name, feats, odds in players_data:
        golfers.append(Golfer(
            name=name,
            features=torch.tensor(feats, dtype=torch.float32),
            odds=odds
        ))

    # Run simulation
    print("\n[3] Running 10,000 tournament simulations...")
    simulator = TournamentSimulator(model)
    results = simulator.simulate(golfers, n_simulations=10000)

    # Display results
    print("\n[4] Tournament Probabilities:")
    print("-" * 70)
    print(f"{'Golfer':<20} {'Win':>8} {'Top 5':>8} {'Top 10':>8} {'Model Odds':>12}")
    print("-" * 70)

    # Sort by win probability
    sorted_results = sorted(results.items(), key=lambda x: x[1]['win_prob'], reverse=True)

    for name, data in sorted_results:
        print(f"{name:<20} {data['win_prob']:>7.1%} {data['top5_prob']:>7.1%} "
              f"{data['top10_prob']:>7.1%} {data['implied_odds']:>11.1f}")

    # Betting analysis
    print("\n[5] Finding betting edges...")
    engine = BettingEdgeEngine(min_edge=0.03)
    report = engine.generate_report(results, golfers, bankroll=1000)
    print(report)

    # Example of volatile player analysis
    print("\n[6] Volatility Analysis:")
    print("-" * 40)
    for name, data in sorted_results[:5]:
        golfer = next(g for g in golfers if g.name == name)
        with torch.no_grad():
            params = model(golfer.features.unsqueeze(0))
        print(f"{name}: σ={params['sigma'].item():.2f}, skew={params['skew'].item():.2f}")
