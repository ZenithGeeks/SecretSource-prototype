#!/usr/bin/env bash
# Keep the GPU Cloud Run services (colpali, vllm) from billing around the clock.
#
# A GPU on Cloud Run forces CPU always allocated, so an instance bills for its whole
# lifetime (~$1.6/h on an L4, ~$38/day) whether or not it serves anything. Two things have
# kept ColPali's instance up for days:
#   - something polling it (the uptime check -> gateway /health, fixed in #328), and
#   - the service's scaling set to "manual, 1 instance" (or min instances > 0) from the
#     Cloud Console. Service-level scaling overrides the revision's minScale=0, so the
#     service looks scale-to-zero in `gcloud run services describe` but never is.
#
#   PROJECT=gcp-edu-471706 ALERT_EMAIL=you@example.com ./deploy/gpu-guard.sh install
#   PROJECT=gcp-edu-471706 ./deploy/gpu-guard.sh check
#
# install  Creates or updates, for every GPU service that exists:
#            - a Cloud Scheduler job, gpu-guard-<service>, that sets the service back to
#              automatic scaling with min 0 every hour (minute 7). It does not create a
#              revision and does not stop an instance that is serving requests; an idle one
#              goes away ~15 minutes later. Cloud Scheduler cannot send PATCH, so the job
#              POSTs with X-HTTP-Method-Override: PATCH.
#            - one Cloud Monitoring alert policy that emails ALERT_EMAIL when a GPU service
#              is billed for more than 50 of the last 60 minutes, held for 30 minutes.
# check    Prints each GPU service's scaling and its billed hours over the last 1 h / 24 h.
#          Exits 1 if one is pinned or billed more than 20 of the last 24 hours.
#
# To keep a GPU instance warm on purpose (a demo), pause its job first, and resume it after:
#   gcloud scheduler jobs pause  gpu-guard-colpali --location "$REGION"
#   gcloud scheduler jobs resume gpu-guard-colpali --location "$REGION"
# Never point an uptime check, health probe or warm-up loop at a GPU service.
set -euo pipefail

PROJECT="${PROJECT:?set PROJECT}"
REGION="${REGION:-asia-southeast1}"
GPU_SERVICES="${GPU_SERVICES:-colpali vllm}"
SCHEDULE="${SCHEDULE:-7 * * * *}"
POLICY_NAME="GPU Cloud Run service billed continuously"
CHANNEL_NAME="GPU guard email"

RUN_API="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/services"
MON_API="https://monitoring.googleapis.com/v3/projects/$PROJECT"

# Windows curl (Schannel) fails the TLS handshake on revocation checks it cannot reach.
CURL=(curl -sS --fail-with-body)
curl -V | grep -q Schannel && CURL+=(--ssl-no-revoke)

token() { gcloud auth print-access-token; }
api() { # api METHOD URL [JSON]
    local args=(-X "$1" -H "Authorization: Bearer $(token)" -H "Content-Type: application/json")
    [ $# -ge 3 ] && args+=(-d "$3")
    "${CURL[@]}" "${args[@]}" "$2"
}
PY=python3
"$PY" -c pass 2>/dev/null || PY=python
py() { "$PY" -c "$@" | tr -d '\r'; }

existing_services() {
    local live
    live=" $(gcloud run services list --project "$PROJECT" --region "$REGION" \
        --format='value(metadata.name)' | tr -d '\r' | tr '\n' ' ') "
    for s in $GPU_SERVICES; do
        case "$live" in *" $s "*) echo "$s" ;; esac
    done
}

billed_hours() { # billed_hours SERVICE SECONDS_BACK
    local end start
    end=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    start=$(date -u -d "@$(($(date +%s) - $2))" +%Y-%m-%dT%H:%M:%SZ)
    "${CURL[@]}" -G -H "Authorization: Bearer $(token)" "$MON_API/timeSeries" \
        --data-urlencode "filter=metric.type=\"run.googleapis.com/container/billable_instance_time\" AND resource.labels.service_name=\"$1\"" \
        --data-urlencode "interval.startTime=$start" --data-urlencode "interval.endTime=$end" \
        --data-urlencode "aggregation.alignmentPeriod=$2s" \
        --data-urlencode "aggregation.perSeriesAligner=ALIGN_SUM" \
        --data-urlencode "aggregation.crossSeriesReducer=REDUCE_SUM" |
        py "import json,sys; d=json.load(sys.stdin)
print(round(sum(p['value'].get('doubleValue',0) for s in d.get('timeSeries',[]) for p in s['points'])/3600,1))"
}

check() {
    local bad=0 s scaling h1 h24
    for s in $(existing_services); do
        scaling=$(api GET "$RUN_API/$s" | py "import json,sys; c=json.load(sys.stdin).get('scaling',{})
print(c.get('scalingMode','AUTOMATIC'), c.get('manualInstanceCount',0), c.get('minInstanceCount',0))")
        read -r mode manual min <<<"$scaling"
        h1=$(billed_hours "$s" 3600)
        h24=$(billed_hours "$s" 86400)
        echo "$s: scaling=$mode manual=$manual min=$min  billed ${h1} h of last 1 h, ${h24} h of last 24 h"
        if [ "$mode" = "MANUAL" ] || [ "$min" != "0" ]; then
            echo "  PINNED: fix with  gcloud run services update $s --region $REGION --scaling=auto --min=0"
            bad=1
        fi
        if py "import sys; sys.exit(0 if $h24 > 20 else 1)"; then
            echo "  billed most of the last day: find the caller in the request log, or the scaling change in the audit log"
            bad=1
        fi
    done
    return $bad
}

install_jobs() {
    local sa s verb headers body
    sa="${GUARD_SA:-$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com}"
    body='{"scaling":{"scalingMode":"AUTOMATIC","minInstanceCount":0}}'
    for s in $(existing_services); do
        verb=create headers=--headers
        if gcloud scheduler jobs describe "gpu-guard-$s" --project "$PROJECT" --location "$REGION" \
            >/dev/null 2>&1; then
            verb=update headers=--update-headers
        fi
        gcloud scheduler jobs "$verb" http "gpu-guard-$s" --project "$PROJECT" --location "$REGION" \
            --schedule "$SCHEDULE" --time-zone UTC \
            --uri "$RUN_API/$s?updateMask=scaling" --http-method POST \
            "$headers" Content-Type=application/json,X-HTTP-Method-Override=PATCH \
            --message-body "$body" \
            --oauth-service-account-email "$sa" \
            --oauth-token-scope https://www.googleapis.com/auth/cloud-platform \
            --description "Reset $s to automatic scaling, min 0 (deploy/gpu-guard.sh)" --quiet >/dev/null
        echo "scheduler job gpu-guard-$s: ${verb}d"
    done
}

install_alert() {
    local email="${ALERT_EMAIL:?set ALERT_EMAIL}" channel policy services_list body
    channel=$(api GET "$MON_API/notificationChannels" | py "import json,sys
for c in json.load(sys.stdin).get('notificationChannels',[]):
    if c.get('displayName')=='$CHANNEL_NAME' and c.get('labels',{}).get('email_address')=='$email': print(c['name']); break")
    if [ -z "$channel" ]; then
        channel=$(api POST "$MON_API/notificationChannels" \
            "{\"type\":\"email\",\"displayName\":\"$CHANNEL_NAME\",\"labels\":{\"email_address\":\"$email\"}}" |
            py "import json,sys; print(json.load(sys.stdin)['name'])")
    fi
    services_list=$(py "print(','.join('\"%s\"' % s for s in '$GPU_SERVICES'.split()))")
    body=$(py "import json; print(json.dumps({
 'displayName': '$POLICY_NAME',
 'combiner': 'OR',
 'notificationChannels': ['$channel'],
 'alertStrategy': {'autoClose': '86400s'},
 'documentation': {'mimeType': 'text/markdown', 'content':
  'A GPU Cloud Run service has been billed for more than 50 of the last 60 minutes for half an hour '
  '(~\$1.6/h per L4 instance). Run \`PROJECT=$PROJECT ./deploy/gpu-guard.sh check\`. If it says PINNED, '
  'someone set manual scaling or min instances: \`gcloud run services update <service> --region $REGION '
  '--scaling=auto --min=0\`. Otherwise something keeps calling it: group its request log by '
  'httpRequest.userAgent and remoteIp. See deploy/gpu-guard.sh.'},
 'conditions': [{
  'displayName': 'GPU service billed > 50 min of the last hour',
  'conditionThreshold': {
   'filter': 'resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/container/billable_instance_time\" AND resource.labels.service_name = one_of($services_list)',
   'aggregations': [{'alignmentPeriod': '3600s', 'perSeriesAligner': 'ALIGN_SUM',
                     'crossSeriesReducer': 'REDUCE_SUM', 'groupByFields': ['resource.labels.service_name']}],
   'comparison': 'COMPARISON_GT', 'thresholdValue': 3000, 'duration': '1800s',
   'trigger': {'count': 1}}}]}))")
    policy=$(api GET "$MON_API/alertPolicies" | py "import json,sys
for p in json.load(sys.stdin).get('alertPolicies',[]):
    if p.get('displayName')=='$POLICY_NAME': print(p['name']); break")
    if [ -n "$policy" ]; then
        api PATCH "https://monitoring.googleapis.com/v3/$policy" "$body" >/dev/null
        echo "alert policy updated: $policy -> $email"
    else
        policy=$(api POST "$MON_API/alertPolicies" "$body" | py "import json,sys; print(json.load(sys.stdin)['name'])")
        echo "alert policy created: $policy -> $email"
    fi
}

case "${1:-}" in
install)
    gcloud services enable cloudscheduler.googleapis.com monitoring.googleapis.com --project "$PROJECT"
    install_jobs
    install_alert
    ;;
check) check ;;
*)
    echo "usage: $0 install|check" >&2
    exit 2
    ;;
esac
