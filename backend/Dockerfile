# Gateway API (app/main.py) on :8080. Build context is backend/.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
# Torch first, from TORCH_INDEX, so pip does not pick a build for us. The CPU index is the
# default: Cloud Run has no GPU. On a machine with an NVIDIA GPU, docker-compose.gpu.yml builds
# with the cu130 index (RTX 50xx needs cu128 or newer), and Docling then runs its layout, table
# and OCR models on the GPU. Its accelerator device is "auto", so nothing else changes.
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
# uv resolves requirements.txt in about a minute. pip's resolver backtracked through old
# OpenTelemetry and botocore releases for 40+ minutes and then failed on one that no longer builds.
RUN pip install --no-cache-dir torch torchvision --index-url ${TORCH_INDEX} \
    && pip install --no-cache-dir uv \
    && uv pip install --system --no-cache -r requirements.txt \
    && python -m nltk.downloader -d /usr/local/share/nltk_data punkt_tab
# NUMPY_SPEC, e.g. "<2.4", pins NumPy for a CPU without SSE4.2: NumPy 2.4+ refuses to import
# there. Empty (the default) keeps whatever requirements.txt resolved. See app/native.py.
ARG NUMPY_SPEC=
RUN if [ -n "$NUMPY_SPEC" ]; then pip install --no-cache-dir "numpy${NUMPY_SPEC}" && pip check; fi
# Docling's table model imports opencv, which needs these native libraries; without them
# converting a PDF dies with "ImportError: libxcb.so.1". graphviz is for `adk web`, which
# draws the pipeline graph with it (adk_agents/). Kept after pip so editing
# requirements.txt is the only thing that rebuilds the slow install layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxcb1 graphviz \
    && rm -rf /var/lib/apt/lists/*
COPY . .
EXPOSE 8080
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
