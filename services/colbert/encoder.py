"""ColBERTv2 (colbert-ir/colbertv2.0) on plain `transformers`: text -> one 128-d unit vector per token.

Score(query, doc) = MaxSim: every query token takes its best-matching doc token, and those are summed.
Storing and scoring happens in store.py (LanceDB does MaxSim natively); this file only encodes.
"""

import string

import torch
import torch.nn.functional as F
from huggingface_hub import hf_hub_download
from safetensors.torch import load_file
from transformers import AutoModel, AutoTokenizer, logging

logging.set_verbosity_error()  # hides the expected "linear.weight UNEXPECTED" note (we load it by hand below)

CHECKPOINT = "colbert-ir/colbertv2.0"
QUERY_LEN, DOC_LEN = 32, 180  # from the checkpoint's artifact.metadata


class Encoder:
    def __init__(self, device: str | None = None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.tok = AutoTokenizer.from_pretrained(CHECKPOINT)
        self.bert = AutoModel.from_pretrained(CHECKPOINT).to(self.device).eval()
        # 768 -> 128 projection, stored in the checkpoint as a bare "linear.weight" that AutoModel skips.
        weights = load_file(hf_hub_download(CHECKPOINT, "model.safetensors"))
        self.proj = weights["linear.weight"].to(self.device)
        # ColBERT prefixes queries with [Q] and documents with [D], reusing two unused BERT vocab slots.
        self.q_marker, self.d_marker = self.tok.convert_tokens_to_ids(["[unused0]", "[unused1]"])
        # Punctuation tokens are dropped from documents, as in the reference indexer.
        punctuation_ids = {
            i for c in string.punctuation for i in self.tok.encode(c, add_special_tokens=False)
        }
        self.punct = torch.tensor(sorted(punctuation_ids))

    @torch.no_grad()
    def _run(self, texts: list[str], marker: int, max_len: int, padding: str):
        """-> (embeddings [B, L, 128], input_ids [B, L], attention_mask [B, L]), all on cpu."""
        batch = self.tok(
            [". " + t for t in texts], padding=padding, truncation=True,
            max_length=max_len, return_tensors="pt",
        )
        batch["input_ids"][:, 1] = marker  # slot 1 (the ". ") becomes [Q] / [D]
        if marker == self.q_marker:  # query augmentation: [PAD] -> [MASK], scored but not attended to
            batch["input_ids"][batch["input_ids"] == self.tok.pad_token_id] = self.tok.mask_token_id
        hidden = self.bert(**batch.to(self.device)).last_hidden_state @ self.proj.T
        return F.normalize(hidden, dim=-1).cpu(), batch["input_ids"].cpu(), batch["attention_mask"].cpu()

    def query(self, text: str) -> torch.Tensor:
        """-> [32, 128]"""
        return self._run([text], self.q_marker, QUERY_LEN, "max_length")[0][0]

    def docs(self, texts: list[str], batch_size: int = 16) -> list[torch.Tensor]:
        """-> one [n_tokens, 128] tensor per text; padding and punctuation rows removed."""
        out = []
        for i in range(0, len(texts), batch_size):
            emb, ids, mask = self._run(texts[i : i + batch_size], self.d_marker, DOC_LEN, "longest")
            keep = mask.bool() & ~torch.isin(ids, self.punct)
            out += [e[k] for e, k in zip(emb, keep, strict=True)]
        return out
