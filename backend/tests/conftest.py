import pytest
from app import main, queue


class _NullRedis:
    """Takes every publish and drops it. Anything else (an enqueue, a job lookup) raises, the way an
    unreachable Redis does, so the code under test takes its Redis-is-down path."""

    def publish(self, channel, message):
        return 0


@pytest.fixture(autouse=True)
def no_real_redis(request, monkeypatch):
    """Unit tests never reach the Redis at REDIS_URL. Without this, every analysis stage a test
    publishes tries localhost:6379, and a refused connection takes about 2 s on Windows: those
    waits made the suite take 8 minutes. A test that needs other behaviour patches
    redis_connection itself, and that wins. Tests marked real_redis use the real one."""
    if request.node.get_closest_marker("real_redis"):
        return
    monkeypatch.setattr(main, "redis_connection", _NullRedis)
    monkeypatch.setattr(queue, "redis_connection", _NullRedis)
    monkeypatch.setattr(queue, "_queue", None)
