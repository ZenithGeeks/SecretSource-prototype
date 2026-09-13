"""ColPali-family retrievers on `colpali-engine`: page image -> one vector per image patch.

The document "tokens" are the patches of a rendered page, so a query can match a number
inside a table or a trend inside a figure. Scoring (MaxSim) is in store.py; this file
only encodes.

Pick a model with COLPALI_MODEL. ViDoRe scores and rough bf16 footprints:

    athrael-soju/colqwen3.5-4.5B-v3   90.9   ~9 GB   best, needs the GPU mostly to itself
    TomoroAI/tomoro-colqwen3-embed-4b 90.6   ~8 GB
    vidore/colqwen2.5-v0.2            89.4   ~6 GB
    vidore/colqwen2-v1.0              89.3   ~4 GB   the default: most of the quality, half the memory
    vidore/colSmol-500M               82.3   ~1 GB   when memory is tight

The default shares a 16 GB card with vLLM. For the 4-billion models, lower vLLM's
--gpu-memory-utilization to about 0.35 first, or give this service its own GPU.
"""

import os

import torch

CHECKPOINT = os.getenv("COLPALI_MODEL", "vidore/colqwen2-v1.0")


def _classes(checkpoint: str):
    """The (model class, processor class) pair for a checkpoint. Each family has its own."""
    import colpali_engine.models as models

    name = checkpoint.lower()
    for marker, model, processor in (
        ("colqwen3.5", "ColQwen3_5", "ColQwen3_5Processor"),
        ("colqwen3", "ColQwen3", "ColQwen3Processor"),
        ("colqwen2.5", "ColQwen2_5", "ColQwen2_5_Processor"),
        ("colqwen2", "ColQwen2", "ColQwen2Processor"),
        ("colsmol", "ColIdefics3", "ColIdefics3Processor"),
        ("colpali", "ColPali", "ColPaliProcessor"),
    ):
        if marker in name:
            if not hasattr(models, model):  # never fall through: the next marker is a near-miss
                raise ValueError(f"{checkpoint} needs {model}; upgrade colpali-engine")
            return getattr(models, model), getattr(models, processor)
    raise ValueError(f"unknown ColPali-family checkpoint: {checkpoint}")


class Encoder:
    def __init__(self, device: str | None = None):
        model_class, processor_class = _classes(CHECKPOINT)

        default_device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device or os.getenv("COLPALI_DEVICE") or default_device
        # bfloat16 on GPU halves the footprint; CPU keeps float32 because bf16 matmuls are slow there.
        dtype = torch.bfloat16 if self.device.startswith("cuda") else torch.float32
        self.model = model_class.from_pretrained(
            CHECKPOINT, torch_dtype=dtype, device_map=self.device
        ).eval()
        self.processor = processor_class.from_pretrained(CHECKPOINT)

    @property
    def dim(self) -> int:
        """Width of one patch vector. 128 across the family, but read it rather than assume."""
        return getattr(self.model.config, "embedding_dim", 128)

    @torch.no_grad()
    def _run(self, batch) -> list[torch.Tensor]:
        batch = {key: value.to(self.device) for key, value in batch.items()}
        return [embedding.to(torch.float32).cpu() for embedding in self.model(**batch)]

    def query(self, text: str) -> torch.Tensor:
        """-> [n_query_tokens, dim]"""
        return self._run(self.processor.process_queries([text]))[0]

    def pages(self, images, batch_size: int = 2) -> list[torch.Tensor]:
        """-> one [n_patches, dim] tensor per page image."""
        vectors = []
        for start in range(0, len(images), batch_size):
            vectors += self._run(self.processor.process_images(images[start : start + batch_size]))
        return vectors
