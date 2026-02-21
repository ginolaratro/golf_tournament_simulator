import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

# ============================================================
# Golf Shot Outcome Predictor
# Multi-task model: 3 regression + 1 classification output
# ============================================================

class GolfShotPredictor(nn.Module):
    """
    Inputs (8 features after encoding):
        - clubhead_speed (continuous)
        - attack_angle (continuous)
        - face_angle (continuous)
        - path (continuous)
        - strike_vertical (-1 low, 0 center, 1 high)
        - strike_horizontal (-1 toe, 0 center, 1 heel)
        - club_loft (continuous, derived from club selection)
        - club_type (0=iron, 1=wood/driver)

    Outputs:
        - carry_distance (regression)
        - spin_rate (regression)
        - smash_factor (regression)
        - within_10ft_prob (classification logit)
    """

    def __init__(self, input_dim=8, hidden_dims=[64, 128, 64]):
        super().__init__()

        # Shared feature extraction layers
        layers = []
        prev_dim = input_dim
        for hidden_dim in hidden_dims:
            layers.extend([
                nn.Linear(prev_dim, hidden_dim),
                nn.BatchNorm1d(hidden_dim),
                nn.ReLU(),
                nn.Dropout(0.2)
            ])
            prev_dim = hidden_dim
        self.shared = nn.Sequential(*layers)

        # Output heads - separate head for each prediction task
        self.head_carry = nn.Linear(hidden_dims[-1], 1)      # yards
        self.head_spin = nn.Linear(hidden_dims[-1], 1)       # rpm
        self.head_smash = nn.Linear(hidden_dims[-1], 1)      # ratio
        self.head_within_10ft = nn.Linear(hidden_dims[-1], 1) # logit

    def forward(self, x):
        features = self.shared(x)

        carry = self.head_carry(features)
        spin = self.head_spin(features)
        smash = self.head_smash(features)
        within_10ft = self.head_within_10ft(features)

        return {
            'carry_distance': carry,
            'spin_rate': spin,
            'smash_factor': smash,
            'within_10ft_logit': within_10ft
        }


class GolfShotLoss(nn.Module):
    """Combined loss for multi-task learning with adjustable weights."""

    def __init__(self, regression_weight=1.0, classification_weight=1.0):
        super().__init__()
        self.mse = nn.MSELoss()
        self.bce = nn.BCEWithLogitsLoss()
        self.reg_weight = regression_weight
        self.cls_weight = classification_weight

    def forward(self, predictions, targets):
        # Regression losses
        loss_carry = self.mse(predictions['carry_distance'], targets['carry_distance'])
        loss_spin = self.mse(predictions['spin_rate'], targets['spin_rate'])
        loss_smash = self.mse(predictions['smash_factor'], targets['smash_factor'])

        # Classification loss
        loss_within = self.bce(predictions['within_10ft_logit'], targets['within_10ft'])

        # Combine losses
        total = self.reg_weight * (loss_carry + loss_spin + loss_smash) + \
                self.cls_weight * loss_within

        return {
            'total': total,
            'carry': loss_carry,
            'spin': loss_spin,
            'smash': loss_smash,
            'within_10ft': loss_within
        }


def preprocess_input(clubhead_speed, attack_angle, face_angle, path,
                     strike_location, club):
    """
    Convert raw inputs to model-ready tensor.

    Args:
        clubhead_speed: mph (e.g., 95-120 for driver)
        attack_angle: degrees (negative = down, positive = up)
        face_angle: degrees (negative = closed, positive = open)
        path: degrees (negative = out-to-in, positive = in-to-out)
        strike_location: tuple (vertical, horizontal) e.g., ('high', 'toe')
        club: string e.g., 'driver', '7iron', 'PW'

    Returns:
        Tensor of shape (1, 8)
    """
    # Encode strike location
    strike_v_map = {'low': -1, 'center': 0, 'high': 1}
    strike_h_map = {'toe': -1, 'center': 0, 'heel': 1}
    strike_v = strike_v_map.get(strike_location[0], 0)
    strike_h = strike_h_map.get(strike_location[1], 0)

    # Encode club (approximate lofts)
    club_lofts = {
        'driver': 10.5, '3wood': 15, '5wood': 18,
        '4iron': 23, '5iron': 26, '6iron': 29, '7iron': 32,
        '8iron': 36, '9iron': 40, 'PW': 44, 'SW': 54, 'LW': 58
    }
    club_loft = club_lofts.get(club, 32)
    club_type = 1 if club in ['driver', '3wood', '5wood'] else 0

    features = torch.tensor([[
        clubhead_speed,
        attack_angle,
        face_angle,
        path,
        strike_v,
        strike_h,
        club_loft,
        club_type
    ]], dtype=torch.float32)

    return features


def create_synthetic_data(n_samples=1000):
    """Generate synthetic golf shot data for demonstration."""
    torch.manual_seed(42)

    # Random inputs
    clubhead_speed = torch.normal(100, 15, (n_samples, 1))  # mph
    attack_angle = torch.normal(-2, 3, (n_samples, 1))       # degrees
    face_angle = torch.normal(0, 2, (n_samples, 1))          # degrees
    path = torch.normal(0, 3, (n_samples, 1))                # degrees
    strike_v = torch.randint(-1, 2, (n_samples, 1)).float()
    strike_h = torch.randint(-1, 2, (n_samples, 1)).float()
    club_loft = torch.normal(30, 12, (n_samples, 1))
    club_type = torch.randint(0, 2, (n_samples, 1)).float()

    X = torch.cat([clubhead_speed, attack_angle, face_angle, path,
                   strike_v, strike_h, club_loft, club_type], dim=1)

    # Synthetic targets (simplified physics-inspired relationships)
    carry = 2.5 * clubhead_speed - 1.5 * club_loft + torch.normal(0, 10, (n_samples, 1))
    spin = 100 * club_loft - 20 * clubhead_speed + torch.normal(0, 500, (n_samples, 1))
    smash = 1.45 - 0.05 * torch.abs(strike_v) - 0.05 * torch.abs(strike_h) + torch.normal(0, 0.02, (n_samples, 1))

    # Within 10ft probability (center strikes + good face/path = better)
    dispersion_score = torch.abs(face_angle - path) + torch.abs(strike_v) + torch.abs(strike_h)
    within_10ft = (dispersion_score < 3).float()

    targets = {
        'carry_distance': carry,
        'spin_rate': spin,
        'smash_factor': smash,
        'within_10ft': within_10ft
    }

    return X, targets


# ============================================================
# Training Script
# ============================================================

if __name__ == '__main__':
    # Create synthetic data
    X, targets = create_synthetic_data(n_samples=2000)

    # Train/val split
    split_idx = int(0.8 * len(X))
    X_train, X_val = X[:split_idx], X[split_idx:]
    targets_train = {k: v[:split_idx] for k, v in targets.items()}
    targets_val = {k: v[split_idx:] for k, v in targets.items()}

    # Initialize model, loss, optimizer
    model = GolfShotPredictor()
    criterion = GolfShotLoss(regression_weight=1.0, classification_weight=0.5)
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=10)

    # Training loop
    batch_size = 32
    n_epochs = 100

    for epoch in range(n_epochs):
        model.train()

        # Mini-batch training
        indices = torch.randperm(len(X_train))
        epoch_loss = 0
        n_batches = 0

        for i in range(0, len(X_train), batch_size):
            batch_idx = indices[i:i+batch_size]
            X_batch = X_train[batch_idx]
            targets_batch = {k: v[batch_idx] for k, v in targets_train.items()}

            optimizer.zero_grad()
            predictions = model(X_batch)
            losses = criterion(predictions, targets_batch)
            losses['total'].backward()
            optimizer.step()

            epoch_loss += losses['total'].item()
            n_batches += 1

        # Validation
        model.eval()
        with torch.no_grad():
            val_preds = model(X_val)
            val_losses = criterion(val_preds, targets_val)

        scheduler.step(val_losses['total'])

        if (epoch + 1) % 20 == 0:
            print(f"Epoch {epoch+1:3d} | Train Loss: {epoch_loss/n_batches:.4f} | "
                  f"Val Loss: {val_losses['total']:.4f}")

    # Test prediction
    print("\n--- Sample Prediction ---")
    model.eval()
    sample_input = preprocess_input(
        clubhead_speed=105,
        attack_angle=-3,
        face_angle=1,
        path=2,
        strike_location=('center', 'center'),
        club='7iron'
    )

    with torch.no_grad():
        output = model(sample_input)

    print(f"Clubhead Speed: 105 mph | Club: 7-iron")
    print(f"Predicted Carry: {output['carry_distance'].item():.1f} yards")
    print(f"Predicted Spin:  {output['spin_rate'].item():.0f} rpm")
    print(f"Predicted Smash: {output['smash_factor'].item():.3f}")
    print(f"Within 10ft Prob: {torch.sigmoid(output['within_10ft_logit']).item():.1%}")
