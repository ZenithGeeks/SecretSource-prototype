"""The worker's start-up check: it turns oneDNN off on a CPU without SSE4.1, and refuses to
start when a native library cannot run, instead of taking jobs it would half-finish."""

import builtins

import pytest
import torch
from app import native

OLD_CPU = "model name\t: QEMU Virtual CPU version 2.5+\nflags\t\t: fpu sse sse2 cx16 lahf_lm\n"
NEW_CPU = "processor\t: 0\nflags\t\t: fpu sse sse2 ssse3 sse4_1 sse4_2 popcnt avx avx2\n"


@pytest.fixture(autouse=True)
def restore_mkldnn():
    before = torch.backends.mkldnn.enabled
    yield
    torch.backends.mkldnn.enabled = before


def test_reads_the_flags_line():
    assert native.cpu_flags(OLD_CPU) == {"fpu", "sse", "sse2", "cx16", "lahf_lm"}
    assert native.cpu_flags("") == set()


def test_old_cpu_turns_onednn_off_and_passes():
    torch.backends.mkldnn.enabled = True
    native.prepare_and_check(OLD_CPU)
    assert torch.backends.mkldnn.enabled is False


def test_new_cpu_leaves_onednn_on():
    torch.backends.mkldnn.enabled = True
    native.prepare_and_check(NEW_CPU)
    assert torch.backends.mkldnn.enabled is True


def test_a_library_that_cannot_run_stops_the_worker(monkeypatch):
    real_import = builtins.__import__

    def failing_import(name, *args, **kwargs):
        if name == "numpy":
            raise RuntimeError("NumPy was built with baseline optimizations: (X86_V2)")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", failing_import)
    with pytest.raises(RuntimeError) as raised:
        native.prepare_and_check(OLD_CPU)
    message = str(raised.value)
    assert "numpy: RuntimeError" in message
    assert "sse4_1" in message and "sse4_2" in message
