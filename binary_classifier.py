import torch
import torch.nn as nn
import torch.optim as optim

# 1. Define model
class SimpleNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.layer1 = nn.Linear(10, 32)
        self.relu = nn.ReLU()
        self.layer2 = nn.Linear(32, 1)

    def forward(self, x):
        x = self.relu(self.layer1(x))
        return self.layer2(x)

model = SimpleNN()

# 2. Loss + Optimizer
criterion = nn.BCEWithLogitsLoss()
optimizer = optim.Adam(model.parameters(), lr=0.001)

# 3. Training loop
for epoch in range(100):
    optimizer.zero_grad()
    outputs = model(torch.randn(16, 10))
    targets = torch.randn(16, 1)
    loss = criterion(outputs, targets)
    loss.backward()
    optimizer.step()

print("Training complete")