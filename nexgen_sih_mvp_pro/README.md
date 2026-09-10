# NexGen Sentinel — SIH 2026 Mine Subsidence Intelligence MVP

A polished, demo-ready software prototype for **SIH26025 — Development of an AI-enabled Low Cost Real-Time Mine Subsidence Monitoring, Prediction and Early Warning System for Underground Coal Mines in India**.

The current prototype is intentionally designed for SIH demonstration speed: it proves the complete **sensor → backend → dataset → AI/ML → risk score → dashboard → alert** pipeline while keeping the ML interpretable and replaceable with more advanced field-trained models later.

## 1-click Windows start

### Easiest
Double-click:

```text
START_NEXGEN.bat
```

On the first run it will create a virtual environment, install dependencies, start the server and open the dashboard automatically.

Dashboard:

```text
http://127.0.0.1:8000
```

Keep the terminal window open during the demo.

### PowerShell alternative

```powershell
.\START_NEXGEN.ps1
```

If PowerShell blocks local scripts, use `START_NEXGEN.bat` instead.

## Dashboard modules

### Command Center
- Real-time Mine Risk Index (0–100)
- NORMAL / WARNING / CRITICAL state
- Spatial mine panel risk map
- Three live sensor nodes (N01–N03)
- AI intelligence brief
- ML anomaly / temporal trend / spatial-correlation contribution bars
- Recommended action
- Live telemetry chart
- Jury demo simulator

### Sensor Network
- N01–N03 node cards
- Tilt, vibration, displacement and crack telemetry
- Node risk score and battery
- Node-specific history graph
- ML anomaly, trend and spatial scores

### AI Intelligence
- Scikit-learn Isolation Forest model
- Sensor severity + trend + anomaly + spatial fusion
- Interpretable risk-score composition
- Explainable AI panel
- Model retraining button
- Full signal-to-warning pipeline visualization

### Dataset Lab
- SQLite persistence
- Live record statistics
- Recent scored telemetry table
- CSV import
- CSV export
- Sample CSV included: `sample_sensor_dataset.csv`

### Alert Center
- Warning and Critical history
- Event timeline
- Automatic risk-transition alerts
- Optional Telegram delivery status

## Working AI / risk engine

Prototype Mine Risk Score:

```text
40% Sensor Severity
25% Temporal Trend
20% Isolation Forest Anomaly
15% Nearby-node Spatial Correlation
```

Risk levels:

```text
0–35      NORMAL
36–65     WARNING
66–100    CRITICAL
```

The weights and thresholds are prototype values intended for later mine-specific calibration using field data and domain experts.

## Jury demo sequence

1. Open **Command Center**.
2. Click **Normal** to establish stable conditions.
3. Click **Warning** to show elevated sensor patterns.
4. Click **Subsidence Event**.
5. Watch N01/N02/N03 deteriorate through the same live backend.
6. Mine Risk Score rises.
7. Spatial risk cluster appears on the map.
8. AI contribution bars and explanation update.
9. Open **Alert Center** to show generated events.
10. If Telegram is configured, show the alert arriving on the phone.

Use **Critical** as a quick fallback if you need to force a high-risk state immediately.

## ESP32 integration

POST to:

```text
http://<LAPTOP_IP>:8000/api/sensor-data
```

JSON body:

```json
{
  "node_id": "N03",
  "tilt": 2.75,
  "vibration": 0.31,
  "displacement": 4.10,
  "crack": 1.05,
  "battery": 91
}
```

Use node IDs `N01` to `N03`.

An Arduino example is included:

```text
ESP32_EXAMPLE.ino
```

Replace the Wi-Fi credentials and laptop IP before uploading it to the board.

## Telegram setup

Create a bot using BotFather, obtain your bot token and target chat ID, then start the server with these environment variables.

PowerShell:

```powershell
$env:TELEGRAM_BOT_TOKEN="YOUR_BOT_TOKEN"
$env:TELEGRAM_CHAT_ID="YOUR_CHAT_ID"
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Without these variables the dashboard still works and alerts are stored locally.

## Manual setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

## API endpoints

```text
GET  /api/health
POST /api/sensor-data
GET  /api/nodes
GET  /api/history/N03
GET  /api/alerts
GET  /api/dataset/stats
GET  /api/dataset/recent
POST /api/dataset/import.csv
GET  /api/dataset/export.csv
POST /api/model/train
POST /api/simulate/normal
POST /api/simulate/warning
POST /api/simulate/critical
POST /api/simulate/subsidence
WS   /ws
```

## SIH-safe technical claim

> The prototype uses unsupervised anomaly detection because mine-specific labelled subsidence-event data is limited. It combines anomaly detection with sensor severity, temporal trends and multi-node spatial correlation to demonstrate an interpretable early-warning pipeline. More advanced spatio-temporal forecasting will be trained and calibrated using real mine field data.
