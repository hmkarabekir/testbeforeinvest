"""
Synthetic Audience Dataset Generator for OctopIQ Audience Agent Lab
Generates calibrated audience feature vectors and persona distributions
specifically tailored for Meta, X, Web Pixel, and product hypotheses.
"""

from __future__ import annotations
import random
import math
from typing import List, Dict, Any, Tuple

CATEGORIES = ['software', 'creator', 'coffee', 'furniture', 'personal-brand', 'other']
AGE_BRACKETS = ['18-24', '25-34', '35-44', '45+']

PERSONA_LABELS = [
    'Teknik Mimar',        # 0
    'Solo Builder',        # 1
    'Taktik & Şablon',     # 2
    'Fiyat & Değer Odaklı', # 3
    'Şüpheci & Kanıt Arayan', # 4
    'Kitle Gözlemcisi'     # 5
]

FEATURE_NAMES = [
    'ig_followers_log',
    'ig_engagement_rate',
    'ig_male_ratio',
    'ig_top_age_idx',
    'ig_story_interaction_rate',
    'x_followers_log',
    'x_tech_density',
    'x_retweet_ratio',
    'x_critique_ratio',
    'pixel_events_log',
    'pixel_cta_ratio',
    'pixel_avg_dwell_sec',
    'pixel_scroll_depth',
    'category_idx',
    'has_proof_facts',
    'has_code_snippet'
]

def generate_synthetic_profile(seed: int | None = None) -> Tuple[List[float], int, List[float]]:
    """
    Generates one synthetic audience row:
    Returns (features, dominant_persona_label, persona_probabilities)
    """
    if seed is not None:
        random.seed(seed)

    category_idx = random.randint(0, len(CATEGORIES) - 1)
    category = CATEGORIES[category_idx]

    # Category priors
    is_software = (category == 'software')
    is_creator = (category in ('creator', 'personal-brand'))

    # Instagram / Meta Features
    ig_followers = random.randint(500, 250000)
    ig_followers_log = round(math.log10(max(10, ig_followers)), 3)
    ig_engagement_rate = round(random.betavariate(2, 40) if is_software else random.betavariate(3, 30), 4)
    ig_male_ratio = round(random.betavariate(8, 2) if is_software else random.betavariate(4, 5), 3)
    ig_top_age_idx = random.choice([0, 1, 1, 1, 2, 3])  # heavily skewed to 25-34 (idx 1)
    ig_story_interaction = round(random.uniform(0.01, 0.18), 3)

    # X / Twitter Features
    x_followers = random.randint(200, 150000)
    x_followers_log = round(math.log10(max(10, x_followers)), 3)
    x_tech_density = round(random.betavariate(7, 2) if is_software else random.betavariate(2, 8), 3)
    x_retweet_ratio = round(random.uniform(0.02, 0.40), 3)
    x_critique_ratio = round(random.betavariate(4, 4) if is_software else random.betavariate(2, 6), 3)

    # Web Pixel Features
    has_pixel = random.random() > 0.15
    pixel_events = random.randint(20, 8000) if has_pixel else 0
    pixel_events_log = round(math.log10(max(1, pixel_events)), 3)
    pixel_cta_ratio = round(random.betavariate(2, 20), 4) if has_pixel else 0.0
    pixel_avg_dwell_sec = round(random.uniform(15, 240), 1) if has_pixel else 0.0
    pixel_scroll_depth = round(random.uniform(25, 95), 1) if has_pixel else 0.0

    # Product specifics
    has_proof_facts = 1 if (is_software or random.random() > 0.4) else 0
    has_code_snippet = 1 if (is_software and random.random() > 0.3) else 0

    features = [
        ig_followers_log,
        ig_engagement_rate,
        ig_male_ratio,
        float(ig_top_age_idx),
        ig_story_interaction,
        x_followers_log,
        x_tech_density,
        x_retweet_ratio,
        x_critique_ratio,
        pixel_events_log,
        pixel_cta_ratio,
        pixel_avg_dwell_sec,
        pixel_scroll_depth,
        float(category_idx),
        float(has_proof_facts),
        float(has_code_snippet)
    ]

    # Ground truth persona utility functions
    # 0: Teknik Mimar
    score_tech = (
        2.5 * x_tech_density +
        1.8 * float(has_code_snippet) +
        1.4 * float(has_proof_facts) +
        1.0 * ig_male_ratio -
        0.8 * float(category_idx != 0) +
        random.gauss(0, 0.25)
    )

    # 1: Solo Builder
    score_builder = (
        1.8 * (x_tech_density * 0.7 + ig_engagement_rate * 10) +
        1.5 * pixel_cta_ratio * 10 +
        1.2 * float(category in ('software', 'personal-brand')) +
        0.8 * float(has_proof_facts) +
        random.gauss(0, 0.25)
    )

    # 2: Taktik & Şablon
    score_taktik = (
        1.5 * ig_story_interaction * 10 +
        1.2 * (1.0 - x_critique_ratio) +
        1.0 * float(category in ('creator', 'software')) +
        0.8 * pixel_cta_ratio * 8 +
        random.gauss(0, 0.25)
    )

    # 3: Fiyat & Değer Odaklı
    score_price = (
        2.0 * (pixel_avg_dwell_sec / 100.0) +
        1.5 * (1.0 - pixel_cta_ratio * 5) +
        1.0 * float(has_proof_facts == 0) +
        0.8 * float(ig_top_age_idx >= 2) +
        random.gauss(0, 0.25)
    )

    # 4: Şüpheci & Kanıt Arayan
    score_skeptic = (
        2.2 * x_critique_ratio +
        1.6 * (pixel_avg_dwell_sec / 120.0) +
        1.4 * (1.0 - float(has_proof_facts)) +
        0.8 * float(is_software) +
        random.gauss(0, 0.25)
    )

    # 5: Kitle Gözlemcisi
    score_observer = (
        2.0 * float(category in ('coffee', 'furniture', 'creator')) +
        1.5 * ig_story_interaction * 8 +
        1.2 * (1.0 - x_tech_density) +
        1.0 * float(ig_male_ratio < 0.5) +
        random.gauss(0, 0.25)
    )

    raw_scores = [score_tech, score_builder, score_taktik, score_price, score_skeptic, score_observer]
    # Softmax probabilities
    max_s = max(raw_scores)
    exp_scores = [math.exp(s - max_s) for s in raw_scores]
    sum_exp = sum(exp_scores)
    probs = [round(e / sum_exp, 4) for e in exp_scores]

    dominant_label = max(range(6), key=lambda i: probs[i])

    return features, dominant_label, probs

def generate_synthetic_dataset(num_samples: int = 4000) -> Dict[str, Any]:
    """
    Generates a full training set of synthetic audience data.
    """
    X: List[List[float]] = []
    y: List[int] = []
    probabilities: List[List[float]] = []

    for i in range(num_samples):
        features, label, probs = generate_synthetic_profile(seed=1000 + i)
        X.append(features)
        y.append(label)
        probabilities.append(probs)

    return {
        'feature_names': FEATURE_NAMES,
        'persona_labels': PERSONA_LABELS,
        'categories': CATEGORIES,
        'num_samples': num_samples,
        'X': X,
        'y': y,
        'probabilities': probabilities
    }

if __name__ == '__main__':
    data = generate_synthetic_dataset(100)
    print(f"Generated {data['num_samples']} synthetic samples with {len(data['feature_names'])} features.")
    print("Sample feature vector:", data['X'][0])
    print("Sample label:", PERSONA_LABELS[data['y'][0]])
    print("Sample probabilities:", data['probabilities'][0])
