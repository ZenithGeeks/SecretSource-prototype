# Deploying the model to Cloud Run

One job: get Qwen running on a Cloud Run GPU so the agents can call it. Nothing else in the
stack is deployed here — that is what `deploy/cloudrun.sh` does.

Everything below runs in **Cloud Shell**, the terminal built into the Google Cloud console.
It already has `gcloud`, it is already logged in as you, and it is bash, so every command
here can be pasted as-is. You do not need to install anything on Windows.

Open it: go to <https://console.cloud.google.com>, pick project **gcp-edu-471706**, then
click the terminal icon in the top-right toolbar (tooltip: "Activate Cloud Shell").

Total time: about 15 minutes, most of it waiting for the weights to download.

> **Not in Cloud Shell?** Every command here is bash. Paste one into PowerShell and you get
> `'export' is not recognized`, or — worse, because it fails quietly — an empty `$PROJECT`.
> The appendix has the three rules that make them work in PowerShell, but Cloud Shell is
> less trouble.

---

## Step 1 — Set the variables

Paste this whole block. It only sets names; nothing is created yet.

```bash
export PROJECT=gcp-edu-471706
export REGION=asia-southeast1
export HF_BUCKET=$PROJECT-hf-cache

gcloud config set project $PROJECT
gcloud services enable run.googleapis.com storage.googleapis.com
```

**Expect:** `Updated property [core/project].` and then a pause while the APIs enable.

> Cloud Shell disconnects after about 20 minutes of no typing, and when it does these
> variables are gone. If a later step complains about an empty value, paste this block again.

---

## Step 2 — Check you are allowed a GPU

A Google Cloud project cannot use a GPU until it has quota for one. This is the single most
common reason a deploy fails, so check before doing any work.

Do this one in the browser rather than the terminal. It is the same page where you ask for
more, if you have none.

1. Open <https://console.cloud.google.com/iam-admin/quotas?project=gcp-edu-471706>
2. In the filter box, type `Nvidia`
3. Find **Total Nvidia L4 GPU allocation without zonal redundancy, per project per region**
4. Read the limit on the `asia-southeast1` row

**If the limit is 1 or more:** go on to step 3.

**If it is 0, or the row is missing:** you have to ask, and a human at Google reviews the
request.

1. Tick that row's checkbox
2. Click **Edit Quotas**, choose region `asia-southeast1`, ask for **1**
3. Submit, and wait for the approval email

Ask for the *without zonal redundancy* one specifically. It is the cheaper kind and it gets
approved faster. Do not continue until it is granted.

---

## Step 3 — Make a bucket for the model weights

Qwen3.5-9B is about 18 GB. Without somewhere to keep it, Cloud Run re-downloads the whole
thing from Hugging Face every time the service wakes up. This bucket is where it lives
instead.

```bash
gcloud storage buckets create gs://$HF_BUCKET --location $REGION
```

**Expect:** `Creating gs://gcp-edu-471706-hf-cache/...`

**If it says the bucket already exists:** fine, move on.

---

## Step 4 — Let the service write to that bucket

The container runs as a service account. By default that account cannot touch your new
bucket, so the cache would silently never fill up.

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format 'value(projectNumber)')

gcloud storage buckets add-iam-policy-binding gs://$HF_BUCKET \
  --member serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role roles/storage.objectUser
```

**Expect:** a block of YAML ending in `etag: ...`

---

## Step 5 — Make a password for the model

The service will be reachable from the open internet. Without a key, anyone who finds the
URL gets a free LLM billed to you. vLLM checks this key on every request.

```bash
export VLLM_API_KEY=$(openssl rand -hex 24)
echo $VLLM_API_KEY
```

**Copy the printed value into a note now.** You need it in steps 7, 8 and 9, and Cloud Shell
will not remember it if the session drops.

---

## Step 6 — Deploy

This is the long command. Paste the whole thing, including the last line.

```bash
gcloud run deploy vllm \
  --image vllm/vllm-openai:v0.26.0 \
  --region $REGION \
  --port 8000 \
  --gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy \
  --cpu 8 --memory 32Gi --no-cpu-throttling \
  --max-instances 1 --min-instances 0 --concurrency 8 --timeout 900 \
  --allow-unauthenticated \
  --startup-probe "tcpSocket.port=8000,failureThreshold=1800,periodSeconds=1,timeoutSeconds=1" \
  --add-volume "name=hf,type=cloud-storage,bucket=$HF_BUCKET" \
  --add-volume-mount "volume=hf,mount-path=/root/.cache/huggingface" \
  --set-env-vars "VLLM_API_KEY=$VLLM_API_KEY" \
  --args "^|^Qwen/Qwen3.5-9B|--host|0.0.0.0|--port|8000|--served-model-name|qwen|--max-model-len|16384|--max-num-seqs|8|--quantization|fp8|--kv-cache-dtype|fp8_e4m3|--enable-prefix-caching|--generation-config|vllm|--language-model-only|--reasoning-parser|qwen3|--enable-auto-tool-choice|--tool-call-parser|qwen3_xml|--default-chat-template-kwargs|{\"enable_thinking\": false}"
```

**Expect:** `Service [vllm] revision [vllm-00001-abc] has been deployed and is serving 100
percent of traffic.` plus a `*.run.app` URL.

That message means Cloud Run accepted the configuration. The model is **not** loaded yet —
that happens on the first request.

### What the odd-looking parts do

| Part | Why it is there |
|---|---|
| `^\|^` at the start of `--args` | `--args` normally splits on commas, and one of the arguments contains a comma. This tells gcloud to split on `\|` instead |
| `--cpu 8 --memory 32Gi` | Cloud Run refuses an L4 with less than 4 CPU and 16 GiB. 8 and 32 are the recommended pair |
| `--startup-probe ... failureThreshold=1800` | The default gives a container 240 seconds to start. Loading 18 GB takes longer. This gives it 30 minutes |
| `--max-instances 1` | Each extra instance is another rented GPU loading another copy of the model |
| `--no-cpu-throttling` | vLLM has background work to do between requests |
| `--min-instances 0` | Costs nothing while idle, at the price of a slow first request |
| `--quantization fp8` | Halves the memory the weights need, so 9B fits an L4 with room left for context |
| `--kv-cache-dtype fp8_e4m3` | The same thing for the context cache. Written the long way because gcloud refuses an `--args` list that repeats a value, and `fp8` is already in there once |

---

## Step 7 — Watch it load

```bash
gcloud beta run services logs tail vllm --region $REGION
```

Nothing appears until something calls the service. Leave this running and open a **second**
Cloud Shell tab with the `+` button.

In that second tab, re-run **Step 1** to set the variables, and re-export the key from your
note:

```bash
export VLLM_API_KEY=paste-the-key-from-step-5
```

---

## Step 8 — First request

Still in the second tab:

```bash
export VLLM_SVC=$(gcloud run services describe vllm --region $REGION --format 'value(status.url)')
echo $VLLM_SVC

curl -s -H "Authorization: Bearer $VLLM_API_KEY" $VLLM_SVC/v1/models
```

**This one takes several minutes.** It is downloading 18 GB. Watch the log tab: you want to
see `Application startup complete`.

**Expect, eventually:** JSON containing `"id": "qwen"`.

Now ask it something real:

```bash
curl -s $VLLM_SVC/v1/chat/completions \
  -H "Authorization: Bearer $VLLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen","messages":[{"role":"user","content":"Reply with one word: ok"}],"max_tokens":16}'
```

**Expect:** JSON with `"content":"ok"` inside it.

Finally, confirm the key is doing its job. This one must be refused:

```bash
curl -s -o /dev/null -w '%{http_code}\n' $VLLM_SVC/v1/models
```

**Expect:** `401`. If it prints `200`, the key was not applied — redo step 6.

Every request after this is fast. Cold starts, after roughly 15 minutes of no traffic,
reload from the bucket, which takes about a minute rather than the original several.

---

## Step 9 — Point the agents at it

Three environment variables, the same three whether you are running locally or in the cloud.
`model.py` reads them, so no code changes.

**If the gateway is already on Cloud Run:**

```bash
gcloud run services update gateway --region $REGION \
  --update-env-vars "VLLM_URL=$VLLM_SVC/v1,VLLM_MODEL=qwen,VLLM_API_KEY=$VLLM_API_KEY"
```

**To drive it from your Windows machine instead**, add these to your local `.env`, using the
real URL that `echo $VLLM_SVC` printed:

```
VLLM_URL=https://vllm-xxxxx-as.a.run.app/v1
VLLM_MODEL=qwen
VLLM_API_KEY=the-key-from-step-5
```

Then run the REPL as usual:

```powershell
python backend/cli.py
```

---

## Reaching a private service

`--allow-unauthenticated` fails silently on projects whose organization forbids `allUsers`,
which is usual at a university. The service deploys, and every request comes back as an HTML
401 from Google's frontend rather than anything vLLM wrote.

Check whether public access is even allowed:

```bash
gcloud run services add-iam-policy-binding vllm --region $REGION   --member=allUsers --role=roles/run.invoker
```

`One or more users named in the policy do not belong to a permitted customer` means it is
blocked at the org level and no flag will change that. Tunnel instead — one terminal holds
it open, signing each request with your own credentials:

```bash
gcloud run services proxy vllm --region $REGION --port 8001
```

Then point `.env` at the tunnel rather than the public URL:

```
VLLM_URL=http://localhost:8001/v1
```

`VLLM_API_KEY` still applies: the tunnel satisfies Cloud Run's IAM, the key satisfies vLLM.
Two layers, different headers, no conflict.

This only works while the proxy runs on your machine. A gateway deployed to Cloud Run would
need its service account granted `roles/run.invoker` and code to attach an ID token — which
is why the compose stack still talks to a local vLLM by default.

---

## Keeping it warm

The engine takes about three minutes to be ready: roughly a minute to read 18 GB from the
bucket, then `init engine ... took 174 s` for profiling, KV cache and CUDA graph capture.
Cloud Run scales the instance away five minutes after the last request, so during a working
session you pay that wait repeatedly, and requests arriving during it come back as
`Rate exceeded`.

Either warm it by hand before running anything real:

```bash
curl -s -m 600 -H "Authorization: Bearer $VLLM_API_KEY" $VLLM_SVC/v1/models
```

Or hold one instance up for as long as you are working:

```bash
gcloud run services update vllm --region $REGION --min-instances 1
```

That bills the GPU continuously, about $0.67 an hour, until you put it back:

```bash
gcloud run services update vllm --region $REGION --min-instances 0
```

---

## When you are done

The GPU bills for every second an instance is alive, roughly **$0.67/hour** plus CPU and
memory. With `--min-instances 0` an idle service costs nothing, but a forgotten one that
keeps getting traffic does.

Delete the service when the demo is over:

```bash
gcloud run services delete vllm --region $REGION
```

The bucket stays, so the next deploy skips the download. Storing 18 GB costs about $0.50 a
month. Delete that too if you want:

```bash
gcloud storage rm -r gs://$HF_BUCKET
```

---

## When something breaks

| What you see | What it means |
|---|---|
| `Quota exceeded ... nvidia_l4_gpu_allocation` | Step 2 was skipped, or not yet approved |
| `Container failed to start` after ~4 minutes | The `--startup-probe` line was dropped or mistyped |
| Every wake-up is slow, not only the first | Step 4 was skipped, so nothing is being cached |
| `404 The model 'qwen' does not exist` | `--served-model-name` and `VLLM_MODEL` disagree |
| `unrecognized arguments: --host` | The `^\|^` prefix was lost, so gcloud split on commas |
| `argument --args: "fp8" cannot be specified multiple times` | gcloud rejects an `--args` list containing the same value twice. Every value in the list must be unique — that is why `--kv-cache-dtype` says `fp8_e4m3` |
| Answers are long and rambling | `--default-chat-template-kwargs` was dropped, so the model is thinking out loud |
| `ValueError: quantization fp8 is not compatible` | The checkpoint is already quantized. Use `--quantization gptq_marlin` for a `-GPTQ-Int4` model, or drop the flag |
| `export: command not found` | You are in PowerShell, not Cloud Shell. These commands are bash |
| `401 Unauthorized` as an HTML page, `Empty Authorization header value` | Cloud Run IAM refused before vLLM ever saw the request — `--allow-unauthenticated` did not take. vLLM's own refusals are JSON, never HTML. See *Reaching a private service* below |
| `RateLimitError ... Rate exceeded` | Cloud Run shedding requests because no instance is ready yet. The engine needs about three minutes; the agents fired several calls into that gap. Warm it first |
| `EngineDeadError` in the log right after `shutdown triggered` | Not a crash. The instance scaled to zero after five idle minutes and the engine noticed its own teardown |

---

## Choosing a different model

Change one word in step 6: the first item after `^|^`. A Cloud Run GPU costs the same per
second whatever it holds, so the only question is what fits in the card's 24 GB and how fast
it answers.

| Checkpoint | Size on the card | Speed on an L4 | Use it when |
|---|---|---|---|
| `Qwen/Qwen3.5-4B` | ~4 GB | ~65 tokens/sec | You want the fastest replies and accept weaker verdicts |
| `Qwen/Qwen3.5-9B` | ~9 GB | ~27 tokens/sec | **Default.** Same GPU bill as the 4B, clearly better at judging claims |
| `Qwen/Qwen3.5-27B-GPTQ-Int4` | ~16 GB | ~12 tokens/sec | Quality matters more than latency. Also swap `fp8` for `gptq_marlin` in `--quantization` |

The L4 reads its own memory at 300 GB/s, and generation speed is mostly that number divided
by the size of the weights. That is the whole reason the 27B feels three times slower.

For anything larger the card has to change. `--gpu-type nvidia-rtx-pro-6000` has 96 GB and
fits `Qwen/Qwen3.5-35B-A3B-FP8`, which stores 35B parameters but uses only 3B per token, so
it stays fast while knowing far more. Cloud Run bills 20 CPU and 80 GiB of RAM alongside
that GPU, so treat it as something you switch on for a benchmark run and switch off after.

---

## Appendix — installing gcloud on Windows

Cloud Shell is enough for this guide. You need a local install for `deploy/cloudrun.sh`,
which builds Docker images out of your working copy.

```powershell
winget install --id Google.CloudSDK --accept-package-agreements --accept-source-agreements
```

Then **close the terminal and open a new one** — PATH only updates for new shells.

```powershell
gcloud version
gcloud auth login
gcloud auth application-default login
gcloud config set project gcp-edu-471706
```

Still `'gcloud' is not recognized` after reopening? Add it to PATH yourself, then reopen once
more:

```powershell
[Environment]::SetEnvironmentVariable('Path', $env:Path + ";$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin", 'User')
```

### Running this guide's commands in PowerShell

Git Bash is the easy answer: type `bash`, and everything above pastes unchanged. To stay in
PowerShell instead, three rules cover it.

| Bash | PowerShell |
|---|---|
| `export PROJECT=gcp-edu-471706` | `$PROJECT = "gcp-edu-471706"` — a plain variable, **not** `$env:PROJECT` |
| `curl ...` | `curl.exe ...` — bare `curl` is an alias for something else, with different flags |
| `\` at the end of a line | A backtick, or put the whole command on one line |

Nothing else changes. `$PROJECT` expands in both shells, and so does `$(command)`. Once the
variables are set with `=` instead of `export`, a command like this works as written:

```powershell
gcloud alpha services quota list --service=run.googleapis.com --consumer="projects/$PROJECT" --filter="NvidiaL4"
```

The exception is `deploy/cloudrun.sh` itself. It is a bash script, and PowerShell cannot run
it at all — use Git Bash for that one.
