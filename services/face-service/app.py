import base64
import io
import os
import logging

import cv2
import numpy as np
from flask import Flask, jsonify, request
from insightface.app import FaceAnalysis

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__)

# Initialise once at startup — buffalo_sc = MobileFaceNet recognition + SCRFD-500M detection
# Both models are small (~70 MB total) and accurate enough for HRMS use.
fa = FaceAnalysis('buffalo_sc', providers=['CPUExecutionProvider'])
fa.prepare(ctx_id=-1, det_size=(320, 320))
log.info('InsightFace buffalo_sc ready')

MAX_SIDE = 640  # resize before inference to cap memory/latency


def b64_to_bgr(b64_str: str) -> np.ndarray | None:
    """Decode a base64 data-URL or raw base64 string → BGR ndarray."""
    try:
        if ',' in b64_str:
            b64_str = b64_str.split(',', 1)[1]
        data = base64.b64decode(b64_str)
        arr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return None
        h, w = img.shape[:2]
        if max(h, w) > MAX_SIDE:
            scale = MAX_SIDE / max(h, w)
            img = cv2.resize(img, (int(w * scale), int(h * scale)))
        return img
    except Exception as e:
        log.warning('b64_to_bgr failed: %s', e)
        return None


def best_face(faces):
    """Return the face with the highest detection confidence score."""
    return max(faces, key=lambda f: f.det_score) if faces else None


@app.get('/health')
def health():
    return jsonify({'status': 'ok', 'model': 'buffalo_sc'})


@app.post('/compare')
def compare():
    """
    Body: { "reference": "<base64 data-URL>", "target": "<base64 data-URL>" }
    Returns:
      { "matched": bool, "similarity": float }          — on success
      { "matched": false, "error": "<code>" }            — when no face found
    """
    body = request.get_json(silent=True) or {}
    ref_b64 = body.get('reference', '')
    tgt_b64 = body.get('target', '')

    ref_img = b64_to_bgr(ref_b64)
    tgt_img = b64_to_bgr(tgt_b64)

    if ref_img is None:
        return jsonify({'matched': False, 'error': 'invalid_reference_image'}), 400
    if tgt_img is None:
        return jsonify({'matched': False, 'error': 'invalid_target_image'}), 400

    ref_faces = fa.get(ref_img)
    tgt_faces = fa.get(tgt_img)

    if not ref_faces:
        log.info('No face detected in reference image')
        return jsonify({'matched': False, 'error': 'no_face_in_reference'})
    if not tgt_faces:
        log.info('No face detected in captured image')
        return jsonify({'matched': False, 'error': 'no_face_in_target'})

    ref_face = best_face(ref_faces)
    tgt_face = best_face(tgt_faces)

    # Cosine similarity on L2-normalised embeddings
    e1 = ref_face.embedding / (np.linalg.norm(ref_face.embedding) + 1e-9)
    e2 = tgt_face.embedding / (np.linalg.norm(tgt_face.embedding) + 1e-9)
    similarity = float(np.dot(e1, e2))

    # MobileFaceNet / buffalo_sc: cosine >= 0.40 → same person (production threshold)
    matched = similarity >= 0.40

    log.info('compare: similarity=%.4f matched=%s', similarity, matched)
    return jsonify({'matched': matched, 'similarity': round(similarity, 4)})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5010, debug=False)
