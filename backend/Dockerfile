# Gateway API (app/main.py) on :8080. Build context is backend/.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
# Torch from the CPU index first: docling needs torch, not a GPU (retrieval runs in the
# colbert/colpali services), so pin the build here rather than let pip pick one.
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
# Docling's table model imports opencv, which needs these native libraries; without them
# converting a PDF dies with "ImportError: libxcb.so.1". Kept after pip so editing
# requirements.txt is the only thing that rebuilds the slow install layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxcb1 \
    && rm -rf /var/lib/apt/lists/*
COPY . .
EXPOSE 8080
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
