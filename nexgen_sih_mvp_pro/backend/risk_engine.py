from __future__ import annotations

from dataclasses import dataclass
from collections import defaultdict, deque
from typing import Dict, Deque, List, Tuple
import math
import numpy as np

try:
    from sklearn.ensemble import IsolationForest
except Exception:  # model remains optional at import time
    IsolationForest = None


FEATURES = ("tilt", "vibration", "displacement", "crack")


@dataclass
class Analysis:
    anomaly_score: float
    sensor_severity: float
    trend_score: float
    spatial_score: float
    risk_score: float
    risk_level: str
    explanation: str


class RiskEngine:
    """Prototype hybrid intelligence engine.

    It combines normalized sensor severity, temporal trends, an IsolationForest
    anomaly score, and nearby-node correlation into a 0-100 Mine Risk Score.
    This is intentionally interpretable for the SIH prototype.
    """

    def __init__(self, history_size: int = 24):
        self.history: Dict[str, Deque[dict]] = defaultdict(lambda: deque(maxlen=history_size))
        self.latest_risk: Dict[str, float] = {}
        self.model = None
        self.model_trained = False
        self.training_samples = 0
        self.adjacency = {
            "N01": ["N02"],
            "N02": ["N01", "N03"],
            "N03": ["N02"],
        }

    @staticmethod
    def _clip01(x: float) -> float:
        return max(0.0, min(1.0, float(x)))

    @staticmethod
    def _normalized_severity(reading: dict) -> float:
        # Prototype thresholds chosen for safe demo scaling; field calibration is required.
        ratios = [
            abs(float(reading.get("tilt", 0))) / 6.0,
            abs(float(reading.get("vibration", 0))) / 0.9,
            abs(float(reading.get("displacement", 0))) / 10.0,
            abs(float(reading.get("crack", 0))) / 4.0,
        ]
        # Weighted toward displacement + crack because those are most intuitive in the demo.
        weights = [0.22, 0.18, 0.34, 0.26]
        return RiskEngine._clip01(sum(w * RiskEngine._clip01(v) for w, v in zip(weights, ratios)))

    def _trend_score(self, node_id: str, reading: dict) -> float:
        hist = list(self.history[node_id])
        if len(hist) < 4:
            return 0.0

        scores = []
        for feature, scale in [("tilt", 2.0), ("vibration", 0.35), ("displacement", 3.0), ("crack", 1.0)]:
            vals = [float(x.get(feature, 0)) for x in hist[-5:]] + [float(reading.get(feature, 0))]
            # simple robust slope from first to last across the recent window
            delta = vals[-1] - vals[0]
            scores.append(self._clip01(max(0.0, delta) / scale))
        return float(np.mean(scores))

    def _spatial_score(self, node_id: str) -> float:
        neighbors = self.adjacency.get(node_id, [])
        if not neighbors:
            return 0.0
        vals = [self.latest_risk.get(n, 0.0) / 100.0 for n in neighbors]
        if not vals:
            return 0.0
        # Correlation signal becomes strong when multiple adjacent nodes are elevated.
        elevated = [v for v in vals if v >= 0.36]
        if not elevated:
            return 0.0
        return self._clip01((sum(elevated) / max(1, len(vals))) * 1.35)

    def train(self, rows: List[dict]) -> Tuple[bool, str]:
        if IsolationForest is None:
            return False, "scikit-learn is not installed"
        matrix = []
        for r in rows:
            try:
                matrix.append([float(r[f]) for f in FEATURES])
            except Exception:
                continue
        if len(matrix) < 30:
            return False, "Need at least 30 valid rows"
        X = np.asarray(matrix, dtype=float)
        self.model = IsolationForest(
            n_estimators=140,
            contamination=0.08,
            random_state=42,
        )
        self.model.fit(X)
        self.model_trained = True
        self.training_samples = len(X)
        return True, f"Model trained on {len(X)} samples"

    def _anomaly_score(self, reading: dict) -> float:
        if not self.model_trained or self.model is None:
            # fallback based on severity until trained
            return self._normalized_severity(reading)
        X = np.asarray([[float(reading.get(f, 0)) for f in FEATURES]], dtype=float)
        # decision_function > 0 = inlier; < 0 = anomaly. Map smoothly to 0..1.
        d = float(self.model.decision_function(X)[0])
        return self._clip01(1.0 / (1.0 + math.exp(8.0 * d)))

    @staticmethod
    def _level(score: float) -> str:
        if score >= 66:
            return "CRITICAL"
        if score >= 36:
            return "WARNING"
        return "NORMAL"

    def analyze(self, node_id: str, reading: dict) -> Analysis:
        sensor = self._normalized_severity(reading)
        trend = self._trend_score(node_id, reading)
        anomaly = self._anomaly_score(reading)
        spatial = self._spatial_score(node_id)

        risk = 100.0 * (0.40 * sensor + 0.25 * trend + 0.20 * anomaly + 0.15 * spatial)
        risk = max(0.0, min(100.0, risk))
        level = self._level(risk)

        contributors = []
        if sensor >= 0.55:
            contributors.append("elevated sensor severity")
        if trend >= 0.45:
            contributors.append("rapidly increasing temporal trend")
        if anomaly >= 0.60:
            contributors.append("ML anomaly detected")
        if spatial >= 0.35:
            contributors.append("nearby-node spatial correlation")
        if not contributors:
            contributors.append("readings are within the expected range")

        explanation = ", ".join(contributors)
        self.history[node_id].append(dict(reading))
        self.latest_risk[node_id] = risk

        return Analysis(
            anomaly_score=round(anomaly * 100, 1),
            sensor_severity=round(sensor * 100, 1),
            trend_score=round(trend * 100, 1),
            spatial_score=round(spatial * 100, 1),
            risk_score=round(risk, 1),
            risk_level=level,
            explanation=explanation,
        )
