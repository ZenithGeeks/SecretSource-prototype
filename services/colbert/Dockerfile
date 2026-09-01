# ColBERTv2 retrieval service. Build context is services/colbert/.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
# cu130 wheels: RTX 50xx (sm_120) needs cu128+; the wheel bundles CUDA, the host only needs the driver.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu130 \
 && pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8893
CMD ["python", "server.py"]
