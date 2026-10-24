"""
XGBoost Persona Classification Model Training Script
Trains a gradient-boosted multi-class tree model on synthetic multi-channel audience telemetry.
"""

from __future__ import annotations
import sys
import os
import json
import time
import hashlib
from pathlib import Path

# Ensure local ml directory is in path
CURRENT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CURRENT_DIR))

from synthetic_data import generate_synthetic_dataset, FEATURE_NAMES, PERSONA_LABELS

def train_model(num_samples: int = 5000, artifact_dir: Path | None = None) -> dict:
    import numpy as np
    import xgboost as xgb
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score, log_loss

    if artifact_dir is None:
        artifact_dir = CURRENT_DIR / 'artifacts'
    artifact_dir.mkdir(parents=True, exist_ok=True)

    start_time = time.time()

    # 1. Generate Synthetic Data
    dataset = generate_synthetic_dataset(num_samples=num_samples)
    X = np.array(dataset['X'], dtype=np.float32)
    y = np.array(dataset['y'], dtype=np.int32)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # 2. Configure and Fit XGBoost
    params = {
        'objective': 'multi:softprob',
        'num_class': 6,
        'n_estimators': 120,
        'max_depth': 4,
        'learning_rate': 0.08,
        'subsample': 0.85,
        'colsample_bytree': 0.85,
        'eval_metric': 'mlogloss',
        'random_state': 42,
        'tree_method': 'hist',
    }

    model = xgb.XGBClassifier(**params)
    model.fit(
        X_train,
        y_train,
        eval_set=[(X_train, y_train), (X_test, y_test)],
        verbose=False
    )

    # 3. Evaluate Model
    y_pred_probs = model.predict_proba(X_test)
    y_pred = np.argmax(y_pred_probs, axis=1)

    acc = float(accuracy_score(y_test, y_pred))
    loss = float(log_loss(y_test, y_pred_probs))

    # Feature Importance
    raw_importances = model.feature_importances_
    feature_importances = [
        {'feature': name, 'importance': round(float(imp), 4)}
        for name, imp in sorted(zip(FEATURE_NAMES, raw_importances), key=lambda x: x[1], reverse=True)
    ]

    # Persona class accuracy breakdown
    persona_stats = []
    for cls_idx, label in enumerate(PERSONA_LABELS):
        mask = (y_test == cls_idx)
        cls_acc = float(accuracy_score(y_test[mask], y_pred[mask])) if mask.sum() > 0 else 0.0
        persona_stats.append({
            'index': cls_idx,
            'label': label,
            'support': int(mask.sum()),
            'accuracy': round(cls_acc, 3)
        })

    elapsed_sec = round(time.time() - start_time, 3)

    # 4. Save Artifacts
    model_path = artifact_dir / 'xgboost_persona_model.json'
    model.save_model(str(model_path))

    with open(model_path, 'rb') as f:
        model_hash = hashlib.sha256(f.read()).hexdigest()

    receipt = {
        'contract': 'octopiq-xgboost-persona-model-v1',
        'status': 'trained',
        'engine': f'xgboost-{xgb.__version__}',
        'trainedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'trainingDurationSec': elapsed_sec,
        'dataset': {
            'totalSamples': num_samples,
            'trainSamples': len(X_train),
            'testSamples': len(X_test),
            'featuresCount': len(FEATURE_NAMES),
            'featureNames': FEATURE_NAMES,
        },
        'metrics': {
            'testAccuracy': round(acc, 4),
            'testLogLoss': round(loss, 4),
            'topFeature': feature_importances[0]['feature'],
        },
        'featureImportances': feature_importances,
        'personaBreakdown': persona_stats,
        'artifact': {
            'filename': 'xgboost_persona_model.json',
            'sha256': model_hash,
            'sizeBytes': os.path.getsize(model_path),
        }
    }

    receipt_path = artifact_dir / 'training_receipt.json'
    with open(receipt_path, 'w', encoding='utf-8') as f:
        json.dump(receipt, f, indent=2, ensure_ascii=False)

    return receipt

if __name__ == '__main__':
    num_samples = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    res = train_model(num_samples, Path(sys.argv[2]) if len(sys.argv) > 2 else None)
    print(json.dumps(res, indent=2))
