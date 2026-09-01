# ColPali visual retrieval service. Build context is services/colpali/.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu130 \
 && pip install --no-cache-dir -r requirements.txt
# Triton compiles a small CUDA helper the first time a query is encoded and needs a C
# compiler; without one every search dies with "Failed to find C compiler" while indexing
# succeeds. Kept after pip so editing requirements.txt only rebuilds the fast layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*
COPY . .
EXPOSE 8894
CMD ["python", "server.py"]
