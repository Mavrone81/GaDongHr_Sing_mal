FROM python:3.11-slim

# Runtime deps for OpenCV + ONNX Runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 curl \
        gcc g++ python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/face-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download InsightFace buffalo_sc models at build time so the container
# starts instantly with no network dependency at runtime.
ENV INSIGHTFACE_HOME=/app/.insightface
RUN python3 -c "\
from insightface.app import FaceAnalysis; \
fa = FaceAnalysis('buffalo_sc', providers=['CPUExecutionProvider']); \
fa.prepare(ctx_id=-1, det_size=(320,320)); \
print('Models cached successfully')"

COPY services/face-service/app.py .

EXPOSE 5010
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:5010/health || exit 1

CMD ["gunicorn", "-b", "0.0.0.0:5010", "-w", "2", "--timeout", "60", "--access-logfile", "-", "app:app"]
