"""Cloud Run spend, analyses and LLM tokens for the last N days, against the cost budget.

    set -a; . ./.env; set +a          # SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
    python deploy/cost/report.py --days 7

Spend is billable instance time from Cloud Monitoring times the list prices below, at each
service's size and billing mode today. There is no billing export, so this is an estimate
without the free tier. Idle min instances are priced at the full rate, which overstates a
period when a service kept one. CONSTRAINTS.md says what the budget is and why.
"""

import argparse
import os
import subprocess
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import requests

PROJECT = "gcp-edu-471706"
REGION = "asia-southeast1"
SERVICES = ("gateway", "colbert", "colpali", "grobid")

# USD list prices for asia-southeast1, from the Cloud Billing Catalog on 2026-10-16.
REQUEST_BASED = {"cpu": 3.36e-5, "memory": 3.5e-6}  # per vCPU-second, per GiB-second
INSTANCE_BASED = {"cpu": 2.16e-5, "memory": 2.4e-6}
L4_GPU = 2.2404e-4  # per second, no zonal redundancy

# What the LLM calls would cost if we paid for them: Gemini 2.5 Flash, USD per million
# tokens (ai.google.dev/gemini-api/docs/pricing, 2026-10-16). Qwen on 9arm is free to us.
LLM_INPUT, LLM_OUTPUT = 0.30, 2.50

BUDGET_PER_ANALYSIS = 0.50  # CONSTRAINTS.md


@dataclass
class Service:
    name: str
    usd_per_second: float  # one instance at its size and billing mode today
    idle: str  # the setting that bills it with no traffic, or "" when it scales to zero


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args()

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=args.days)
    token = access_token()

    services = [fetch_service(token, name) for name in SERVICES]
    spend = {}  # USD per service over the period
    for service in services:
        spend[service.name] = billable_seconds(token, service.name, start, end) * service.usd_per_second
    analyses = analyses_since(start)

    print(f"{start:%Y-%m-%d} to {end:%Y-%m-%d} ({args.days} days)\n")
    print_report(services, spend, analyses)


def access_token() -> str:
    """The gcloud user's OAuth token for the Monitoring and Cloud Run APIs."""
    # shell on Windows, where gcloud is a .cmd file
    gcloud = subprocess.run(
        ["gcloud", "auth", "print-access-token"],
        capture_output=True,
        text=True,
        check=True,
        shell=os.name == "nt",
    )
    return gcloud.stdout.strip()


def fetch_service(token: str, name: str) -> Service:
    """A Cloud Run service's price per second and any setting that keeps it running."""
    response = requests.get(
        f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/services/{name}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    response.raise_for_status()
    service = response.json()
    return Service(name, price_per_second(service["template"]), idle_setting(service))


def price_per_second(template: dict) -> float:
    """USD per second for one instance of a revision template."""
    # Each of our services runs one container.
    resources = template["containers"][0]["resources"]
    limits = resources["limits"]
    has_gpu = template.get("nodeSelector", {}).get("accelerator") == "nvidia-l4"
    # A GPU service always keeps its CPU, and the API leaves cpuIdle out for it.
    is_request_based = resources.get("cpuIdle", False) and not has_gpu
    prices = REQUEST_BASED if is_request_based else INSTANCE_BASED
    rate = vcpus(limits["cpu"]) * prices["cpu"] + gibibytes(limits["memory"]) * prices["memory"]
    return rate + L4_GPU if has_gpu else rate


def idle_setting(service: dict) -> str:
    """The setting that keeps a service billed with no traffic, or "" when it scales to zero.

    Both kinds have cost us: GROBID on manual scaling and ColBERT with a min instance billed
    every day from 2 to 16 Oct 2026 with no analyses.
    """
    scaling = service.get("scaling", {})
    if scaling.get("scalingMode") == "MANUAL":
        return f"manual scaling, {scaling.get('manualInstanceCount', 0)} instances"
    # A min can be set on the service (the Console's service-level scaling) or on the
    # revision template (gcloud --min-instances); either keeps an instance up.
    template_min = service["template"].get("scaling", {}).get("minInstanceCount", 0)
    if scaling.get("minInstanceCount", 0) or template_min:
        return "min instances above 0"
    return ""


def vcpus(cpu: str) -> float:
    """Cloud Run's CPU limit ("2", "1000m") in vCPUs."""
    return float(cpu[:-1]) / 1000 if cpu.endswith("m") else float(cpu)


def gibibytes(memory: str) -> float:
    """Cloud Run's memory limit ("4Gi", "512Mi") in GiB."""
    if memory.endswith("Gi"):
        return float(memory[:-2])
    if memory.endswith("Mi"):
        return float(memory[:-2]) / 1024
    raise ValueError(f"unexpected memory limit {memory!r}; expected Gi or Mi")


def billable_seconds(token: str, service: str, start: datetime, end: datetime) -> float:
    """Seconds this service's instances were billed in the period."""
    params = {
        "filter": 'metric.type="run.googleapis.com/container/billable_instance_time" '
        'AND resource.type="cloud_run_revision" '
        f'AND resource.label.service_name="{service}"',
        "interval.startTime": start.isoformat().replace("+00:00", "Z"),
        "interval.endTime": end.isoformat().replace("+00:00", "Z"),
        # One alignment period as long as the whole window, summed: one total per revision.
        "aggregation.alignmentPeriod": f"{int((end - start).total_seconds())}s",
        "aggregation.perSeriesAligner": "ALIGN_SUM",
        "aggregation.crossSeriesReducer": "REDUCE_SUM",
    }
    response = requests.get(
        f"https://monitoring.googleapis.com/v3/projects/{PROJECT}/timeSeries",
        params=params,
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    response.raise_for_status()
    points = [p for series in response.json().get("timeSeries", []) for p in series["points"]]
    return sum(float(p["value"].get("doubleValue", 0)) for p in points)


def analyses_since(start: datetime) -> list[dict]:
    """Each analysis started in the period: its status and the tokens its LLM calls used."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (set -a; . ./.env; set +a)")
    response = requests.get(
        f"{url}/rest/v1/analyses",
        params={
            "select": "status:data->>status,llm_tokens:data->llm_tokens",
            "started": f"gte.{start.isoformat()}",
        },
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def llm_cost(tokens: dict[str, int]) -> float:
    """USD for one analysis's tokens at the LLM prices above."""
    prompt = sum(n for kind, n in tokens.items() if kind.endswith("_prompt"))
    completion = sum(n for kind, n in tokens.items() if kind.endswith("_completion"))
    return (prompt * LLM_INPUT + completion * LLM_OUTPUT) / 1e6


def print_report(services: list[Service], spend: dict[str, float], analyses: list[dict]) -> None:
    """Spend per service, spend per analysis against the budget, and any idle setting."""
    for name, usd in spend.items():
        print(f"  {name:8} ${usd:8.2f}")
    total = sum(spend.values())
    print(f"  {'total':8} ${total:8.2f}\n")

    for service in services:
        if service.idle:
            print(f"Bills with no traffic: {service.name} ({service.idle})")

    finished = [a for a in analyses if a.get("status") == "done"]
    print(f"Analyses started: {len(analyses)} ({len(finished)} finished)")
    if not analyses:
        return
    # Cloud Run is spent on every analysis started, so it is divided by all of them. The LLM
    # average uses only analyses with token counts: older records do not have them.
    token_counts = [a["llm_tokens"] for a in analyses if a.get("llm_tokens")]
    cloud_per_analysis = total / len(analyses)
    llm_per_analysis = sum(map(llm_cost, token_counts)) / len(token_counts) if token_counts else 0.0
    per_analysis = cloud_per_analysis + llm_per_analysis
    verdict = "within" if per_analysis <= BUDGET_PER_ANALYSIS else "OVER"
    print(f"Cloud Run per analysis: ${cloud_per_analysis:.2f}")
    print(
        f"LLM per analysis, if paid: ${llm_per_analysis:.3f} "
        f"(from {len(token_counts)} analyses with token counts)"
    )
    print(f"Total per analysis: ${per_analysis:.2f}, {verdict} the ${BUDGET_PER_ANALYSIS:.2f} budget")


if __name__ == "__main__":
    main()
