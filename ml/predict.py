"""
XGBoost Persona Inference Script
Predicts persona distribution and sensitivities from audience feature vector.
"""

from __future__ import annotations
import sys
import json
from pathlib import Path
import numpy as np

CURRENT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CURRENT_DIR))

from synthetic_data import FEATURE_NAMES, PERSONA_LABELS

def predict_personas(features: list[float], artifact_dir: Path | None = None) -> dict:
    import xgboost as xgb

    if artifact_dir is None:
        artifact_dir = CURRENT_DIR / 'artifacts'

    model_path = artifact_dir / 'xgboost_persona_model.json'
    if not model_path.exists():
        raise FileNotFoundError(f"Model file not found at {model_path}. Please train first.")

    booster = xgb.Booster()
    booster.load_model(str(model_path))

    if len(features) != len(FEATURE_NAMES) or not all(
        isinstance(value, (float, int)) and not isinstance(value, bool) and np.isfinite(value)
        for value in features
    ):
        raise ValueError('Expected exactly 16 finite numeric features')

    dmatrix = xgb.DMatrix(np.array([features], dtype=np.float32), feature_names=FEATURE_NAMES)
    raw_probs = booster.predict(dmatrix)[0]

    probabilities = [round(float(p), 4) for p in raw_probs]
    dominant_idx = int(np.argmax(probabilities))

    results = []
    for idx, (label, prob) in enumerate(zip(PERSONA_LABELS, probabilities)):
        results.append({
            'index': idx,
            'label': label,
            'probability': prob,
            'isDominant': (idx == dominant_idx),
            'recommendedWeight': max(0.05, round(prob, 2))
        })

    # Sort by probability descending
    results.sort(key=lambda x: x['probability'], reverse=True)

    return {
        'dominantPersona': PERSONA_LABELS[dominant_idx],
        'dominantIndex': dominant_idx,
        'personaScores': results,
        'featuresUsed': dict(zip(FEATURE_NAMES, features))
    }

if __name__ == '__main__':
    if len(sys.argv) > 1:
        raw_input = sys.argv[1]
        try:
            feats = json.loads(raw_input)
            if isinstance(feats, dict):
                # Extract features in order
                feats = [float(feats.get(name, 0.0)) for name in FEATURE_NAMES]
        except Exception:
            feats = [float(x) for x in sys.argv[1].split(',')]
    else:
        feats = [4.5, 0.04, 0.85, 1.0, 0.08, 4.2, 0.75, 0.15, 0.35, 3.2, 0.06, 85.0, 65.0, 0.0, 1.0, 1.0]

    out = predict_personas(feats, Path(sys.argv[2]) if len(sys.argv) > 2 else None)
    print(json.dumps(out, indent=2, ensure_ascii=False))
