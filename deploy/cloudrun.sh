#!/usr/bin/env bash
# Deploy the stack to Cloud Run. Nothing in the code changes — only environment variables.
#
#   PROJECT=my-project REGION=asia-southeast1 QDRANT_URL=... QDRANT_API_KEY=... ./deploy/cloudrun.sh
#
# Two decisions:
#   MODEL=vertex (default) uses Gemini through LiteLLM — no GPU to pay for.
#   MODEL=vllm runs Qwen on a Cloud Run GPU instead (see deploy/vllm-cloud-run.md).
# Qdrant is not deployed here: Cloud Run has no good persistent disk for it. Use a managed
# Qdrant (Qdrant Cloud has a free tier) and pass QDRANT_URL / QDRANT_API_KEY.
set -euo pipefail

PROJECT="${PROJECT:?set PROJECT}"
REGION="${REGION:-asia-southeast1}"
MODEL="${MODEL:-vertex}"
QDRANT_URL="${QDRANT_URL:?set QDRANT_URL (e.g. a Qdrant Cloud cluster URL)}"
QDRANT_API_KEY="${QDRANT_API_KEY:-}"
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
gcloud artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1 ||
    gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet

build_and_push() {
    local name=$1 context=$2
    docker build -t "$IMAGE_HOST/$name" "$context"
    docker push "$IMAGE_HOST/$name"
}

deploy() {
    local name=$1
    shift
    gcloud run deploy "$name" --image "$IMAGE_HOST/$name" --region "$REGION" --quiet "$@"
}

url_of() { gcloud run services describe "$1" --region "$REGION" --format 'value(status.url)'; }

# --- stateless services -------------------------------------------------------

gcloud run deploy grobid --image lfoppiano/grobid:0.8.2 --region "$REGION" \
    --port 8070 --memory 4Gi --allow-unauthenticated --quiet

build_and_push colbert ./services/colbert
deploy colbert --port 8893 --memory 4Gi --allow-unauthenticated \
    --set-env-vars "QDRANT_URL=$QDRANT_URL,QDRANT_API_KEY=$QDRANT_API_KEY"

if [ "$MODEL" = "vllm" ]; then
    # A bucket mounted where the HF cache lives turns the second cold start into a GCS read
    # instead of a fresh multi-GB download.
    HF_BUCKET="${HF_BUCKET:-$PROJECT-hf-cache}"
    gcloud storage buckets describe "gs://$HF_BUCKET" >/dev/null 2>&1 ||
        gcloud storage buckets create "gs://$HF_BUCKET" --location "$REGION"

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
else
    # LiteLLM routes any vertex_ai/* model string to Vertex; the gateway's code is unchanged.
    MODEL_ENV="VLLM_URL=,VLLM_MODEL=vertex_ai/gemini-2.5-flash"
fi

# --- gateway and UI -----------------------------------------------------------

build_and_push gateway ./backend
deploy gateway --port 8080 --memory 2Gi --allow-unauthenticated \
    --set-env-vars "GROBID_URL=$(url_of grobid),COLBERT_URL=$(url_of colbert),$MODEL_ENV"

build_and_push web ./frontend
# 127.0.0.11 is Docker's DNS and does not exist here; nginx is pointed at the metadata
# resolver to look up the gateway's *.run.app hostname.
deploy web --port 80 --allow-unauthenticated \
    --set-env-vars "GATEWAY_URL=$(url_of gateway),NGINX_RESOLVER=169.254.169.254"

echo
echo "UI:      $(url_of web)"
echo "Gateway: $(url_of gateway)"
if [ "$MODEL" = "vllm" ]; then
    echo "Model:   $VLLM_HF_MODEL served as '$VLLM_SERVED_NAME' on a $GPU_TYPE"
    echo "         VLLM_API_KEY=$VLLM_API_KEY   (export it to keep the same key next deploy)"
fi
echo
echo "Run history is SQLite on the container's disk and resets when an instance recycles."
echo "Point ANALYSES_DB at Cloud SQL before anyone relies on it."
