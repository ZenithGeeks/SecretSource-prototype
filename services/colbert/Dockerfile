# ColBERTv2 retrieval service. Build context is services/colbert/.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
# CPU wheels by default: Cloud Run has no GPU here, and the CUDA wheel made the image 3.2 GB,
# which every cold start pulls. The GPU compose profile passes TORCH_INDEX=.../cu130
# (RTX 50xx, sm_120, needs cu128+; that wheel bundles CUDA, the host only needs the driver).
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir torch --index-url ${TORCH_INDEX} \
 && pip install --no-cache-dir -r requirements.txt
# The weights ship in the image, so a cold start reads them from local disk instead of the network.
# HF_HOME is outside /root/.cache, so a volume mounted there cannot hide them.
ENV HF_HOME=/opt/hf
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('colbert-ir/colbertv2.0', allow_patterns=['*.json', '*.txt', 'model.safetensors'])"
COPY . .
EXPOSE 8893
CMD ["python", "server.py"]
