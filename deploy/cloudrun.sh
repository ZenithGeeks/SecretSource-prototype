#!/usr/bin/env bash
# Deploy the stack to Cloud Run so the whole team shares one set of services. Nothing in
# the code changes — only environment variables.
#
#   PROJECT=my-project REGION=asia-southeast1 ./deploy/cloudrun.sh
#
# Images are built by Cloud Build (gcloud builds submit), so no local Docker is needed.
#
# The model is Qwen3.5-9B on vLLM on a Cloud Run L4 (see deploy/vllm-cloud-run.md).
#
# One decision:
#   VISION=1 (default) deploys colpali on an L4 GPU; VISION=0 skips it. COLPALI_GPU=0
#   deploys it CPU-only instead (works, but a query takes minutes — demo only).
#
# Qdrant: Cloud Run has no persistent disk for it, so this script keeps a small GCE VM
# (e2-small + 10 GB disk, ~$13/month) running the qdrant container. Pass QDRANT_URL /
# QDRANT_API_KEY to use an external cluster (e.g. Qdrant Cloud) and no VM is touched.
#
# NOTE the Cloud Run L4 quota is per project per region and this project has 1. Both vllm
# and colpali deploy against it (allocation is checked per running instance, and both
# scale to zero), but they cannot be up at the same time until the quota is raised to 2.
set -euo pipefail

PROJECT="${PROJECT:?set PROJECT}"
REGION="${REGION:-asia-southeast1}"
ZONE="${ZONE:-$REGION-b}"
VISION="${VISION:-1}"
COLPALI_GPU="${COLPALI_GPU:-1}"
REPO="${REPO:-secretsource}"
IMAGE_HOST="$REGION-docker.pkg.dev/$PROJECT/$REPO"

# Which checkpoint, on which card — see deploy/vllm-cloud-run.md for the trade-offs.
VLLM_HF_MODEL="${VLLM_HF_MODEL:-Qwen/Qwen3.5-9B}"
VLLM_SERVED_NAME="${VLLM_SERVED_NAME:-qwen}"
VLLM_QUANT="${VLLM_QUANT:-fp8}"
VLLM_MAX_LEN="${VLLM_MAX_LEN:-16384}"
GPU_TYPE="${GPU_TYPE:-nvidia-l4}"
MIN_INSTANCES="${MIN_INSTANCES:-0}" # 1 keeps the weights warm, and bills for the GPU all day

gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
    artifactregistry.googleapis.com compute.googleapis.com --quiet
gcloud artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1 ||
    gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION"

build_and_push() {
    local name=$1 context=$2
    gcloud builds submit "$context" --tag "$IMAGE_HOST/$name" --quiet
}

deploy() {
    local name=$1
    shift
    gcloud run deploy "$name" --image "$IMAGE_HOST/$name" --region "$REGION" --quiet "$@"
}

url_of() { gcloud run services describe "$1" --region "$REGION" --format 'value(status.url)'; }

# --- qdrant: one small VM with a disk that outlives it ------------------------

QDRANT_API_KEY="${QDRANT_API_KEY:-}"
if [ -z "${QDRANT_URL:-}" ]; then
    if gcloud compute instances describe qdrant --zone "$ZONE" >/dev/null 2>&1; then
        # Re-run: recover the key the VM was created with instead of minting a mismatched one.
        QDRANT_API_KEY="${QDRANT_API_KEY:-$(gcloud compute instances describe qdrant --zone "$ZONE" \
            --format 'value(metadata.items.qdrant-api-key)')}"
    fi
    QDRANT_API_KEY="${QDRANT_API_KEY:-$(openssl rand -hex 24)}"
    if ! gcloud compute instances describe qdrant --zone "$ZONE" >/dev/null 2>&1; then
        # create-with-container is discontinued, so a COS image plus a startup script
        # that mounts the data disk and `docker run`s qdrant (deploy/qdrant-startup.sh).
        gcloud compute instances create qdrant \
            --zone "$ZONE" --machine-type e2-small --tags qdrant \
            --image-family cos-stable --image-project cos-cloud \
            --create-disk "name=qdrant-data,device-name=qdrant-data,size=10GB,auto-delete=no" \
            --metadata-from-file startup-script=deploy/qdrant-startup.sh \
            --metadata "qdrant-api-key=$QDRANT_API_KEY"
        gcloud compute firewall-rules describe allow-qdrant >/dev/null 2>&1 ||
            gcloud compute firewall-rules create allow-qdrant \
                --allow tcp:6333 --target-tags qdrant --source-ranges 0.0.0.0/0
    fi
    QDRANT_IP=$(gcloud compute instances describe qdrant --zone "$ZONE" \
        --format 'value(networkInterfaces[0].accessConfigs[0].natIP)')
    QDRANT_URL="http://$QDRANT_IP:6333"
fi

# --- the HF cache bucket: cold starts read weights from GCS, not Hugging Face --

HF_BUCKET="${HF_BUCKET:-$PROJECT-hf-cache}"
gcloud storage buckets describe "gs://$HF_BUCKET" >/dev/null 2>&1 ||
    gcloud storage buckets create "gs://$HF_BUCKET" --location "$REGION"

# --- stateless services -------------------------------------------------------

gcloud run deploy grobid --image lfoppiano/grobid:0.8.2 --region "$REGION" \
    --port 8070 --memory 4Gi --allow-unauthenticated --quiet

build_and_push colbert ./services/colbert
deploy colbert --port 8893 --memory 4Gi --allow-unauthenticated \
    --add-volume "name=hf,type=cloud-storage,bucket=$HF_BUCKET" \
    --add-volume-mount "volume=hf,mount-path=/root/.cache/huggingface" \
    --set-env-vars "QDRANT_URL=$QDRANT_URL,QDRANT_API_KEY=$QDRANT_API_KEY"

COLPALI_ENV=""
if [ "$VISION" = "1" ]; then
    build_and_push colpali ./services/colpali
    # No HF cache bucket here: ColQwen2 is 731 safetensors shards and loading them through
    # GCS FUSE takes ~45 minutes, past the 30-minute startup probe. A fresh Hub download to
    # the instance disk is a couple of minutes.
    colpali_flags=(--port 8894 --allow-unauthenticated
        --set-env-vars "QDRANT_URL=$QDRANT_URL,QDRANT_API_KEY=$QDRANT_API_KEY,HF_TOKEN=${HF_TOKEN:-}"
        --max-instances 1 --concurrency 4 --timeout 600
        --startup-probe "tcpSocket.port=8894,failureThreshold=1800,periodSeconds=1,timeoutSeconds=1")
    if [ "$COLPALI_GPU" = "1" ]; then
        colpali_flags+=(--gpu 1 --gpu-type "$GPU_TYPE" --no-gpu-zonal-redundancy
            --cpu 8 --memory 32Gi --no-cpu-throttling)
    else
        colpali_flags+=(--cpu 4 --memory 16Gi)
    fi
    deploy colpali "${colpali_flags[@]}"
    COLPALI_ENV=",COLPALI_URL=$(url_of colpali)"
fi

# A public /v1/chat/completions is a free LLM for whoever finds the URL. vLLM checks
# this key on every request. Export your own to keep it stable across deploys.
VLLM_API_KEY="${VLLM_API_KEY:-$(openssl rand -hex 24)}"

case "$GPU_TYPE" in
nvidia-rtx-pro-6000) GPU_CPU=20 GPU_MEM=80Gi ;;
*) GPU_CPU=8 GPU_MEM=32Gi ;;
esac

vllm_args=(
    "$VLLM_HF_MODEL" --host 0.0.0.0 --port 8000
    --served-model-name "$VLLM_SERVED_NAME"
    --max-model-len "$VLLM_MAX_LEN" --max-num-seqs 8
    # fp8_e4m3 is what plain "fp8" means on CUDA; spelled out because gcloud's --args
    # rejects a list that repeats a value, and --quantization already said fp8.
    --kv-cache-dtype fp8_e4m3 --enable-prefix-caching
    --generation-config vllm --language-model-only
    --reasoning-parser qwen3
    --enable-auto-tool-choice --tool-call-parser qwen3_xml
    --default-chat-template-kwargs '{"enable_thinking": false}'
)
[ -n "$VLLM_QUANT" ] && vllm_args+=(--quantization "$VLLM_QUANT")
# One arg contains a comma, which --args splits on; ^|^ makes it split on | instead.
vllm_args_joined=$(
    IFS='|'
    echo "${vllm_args[*]}"
)

gcloud run deploy vllm --image vllm/vllm-openai:v0.26.0 --region "$REGION" --quiet \
    --port 8000 --gpu 1 --gpu-type "$GPU_TYPE" --no-gpu-zonal-redundancy \
    --cpu "$GPU_CPU" --memory "$GPU_MEM" --no-cpu-throttling \
    --max-instances 1 --min-instances "$MIN_INSTANCES" --concurrency 8 --timeout 900 \
    --allow-unauthenticated \
    --startup-probe "tcpSocket.port=8000,failureThreshold=1800,periodSeconds=1,timeoutSeconds=1" \
    --add-volume "name=hf,type=cloud-storage,bucket=$HF_BUCKET" \
    --add-volume-mount "volume=hf,mount-path=/root/.cache/huggingface" \
    --set-env-vars "VLLM_API_KEY=$VLLM_API_KEY,HF_TOKEN=${HF_TOKEN:-}" \
    --args "^|^$vllm_args_joined"

MODEL_ENV="VLLM_URL=$(url_of vllm)/v1,VLLM_MODEL=$VLLM_SERVED_NAME,VLLM_API_KEY=$VLLM_API_KEY"

# --- gateway and UI -----------------------------------------------------------

build_and_push gateway ./backend
deploy gateway --port 8080 --memory 4Gi --allow-unauthenticated \
    --add-volume "name=hf,type=cloud-storage,bucket=$HF_BUCKET" \
    --add-volume-mount "volume=hf,mount-path=/root/.cache/huggingface" \
    --set-env-vars "SERVICE_AUTH=google-id-token,GROBID_URL=$(url_of grobid),COLBERT_URL=$(url_of colbert)$COLPALI_ENV,$MODEL_ENV"

build_and_push web ./frontend
# 127.0.0.11 is Docker's DNS and does not exist here; nginx is pointed at the metadata
# resolver to look up the gateway's *.run.app hostname.
deploy web --port 80 --allow-unauthenticated \
    --set-env-vars "GATEWAY_URL=$(url_of gateway),NGINX_RESOLVER=169.254.169.254"

echo
echo "UI:          $(url_of web)"
echo "Gateway:     $(url_of gateway)"
echo "Qdrant:      $QDRANT_URL   (api key: $QDRANT_API_KEY — keep it out of git)"
echo "ColBERT MCP: $(url_of colbert)/mcp"
[ "$VISION" = "1" ] && echo "ColPali MCP: $(url_of colpali)/mcp"
echo "Model:       $VLLM_HF_MODEL served as '$VLLM_SERVED_NAME' on a $GPU_TYPE"
echo "             VLLM_API_KEY=$VLLM_API_KEY   (export it to keep the same key next deploy)"
echo
echo "Run history is SQLite on the container's disk and resets when an instance recycles."
echo "Point ANALYSES_DB at Cloud SQL before anyone relies on it."
