"""Cloud Run prices in USD per instance-hour.

List prices for asia-southeast1 (Tier 2), read from the Cloud Billing catalog on
2026-10-05. Keep in step with deploy/monitoring/grafana/dashboards/operations.json.
Values are (active, idle).
"""

RATES: dict[str, tuple[float, float]] = {
    "colpali": (1.705104, 1.705104),
    "gateway": (0.38016, 0.38016),
    "colbert": (0.29232, 0.0756),
    "grobid": (0.17136, 0.063),
}


def is_priced(service: str) -> bool:
    return service in RATES


def hourly_cost(service: str, active: float, idle: float) -> float:
    """USD per hour for the given instance counts; 0 for an unpriced service."""
    rate = RATES.get(service)
    if rate is None:
        return 0.0
    return active * rate[0] + idle * rate[1]
