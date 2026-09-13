"""RAG over indexed papers: DSPy + the ColBERT retrieval service.

ADK builds each tool's schema from the type hints and docstring."""

from app.clients.retrieval import colbert_add, colbert_search

_rag = None  # lazy: needs dspy, a running LM and the ColBERT service


def _build_rag():
    import dspy

    from app.llm import dspy_lm

    language_model = dspy_lm()

    class GenerateAnswer(dspy.Signature):
        """Answer the question using only the retrieved context."""

        context: list[str] = dspy.InputField(desc="Retrieved passages that may contain relevant facts")
        question: str = dspy.InputField()
        answer: str = dspy.OutputField(desc="Short factual answer, 1-2 sentences")

    class RAG(dspy.Module):
        def __init__(self, k: int = 3):
            super().__init__()
            self.k = k
            self.generate = dspy.ChainOfThought(GenerateAnswer)

        def forward(self, question: str):
            # colbert_search, not dspy.ColBERTv2. dspy's client cannot send the identity
            # token. The Cloud Run service requires it.
            passages = [passage["text"] for passage in colbert_search(question, k=self.k)]
            # dspy.context is thread-safe, dspy.configure is not.
            # ADK runs tools in worker threads.
            with dspy.context(lm=language_model):
                prediction = self.generate(context=passages, question=question)
            return dspy.Prediction(context=passages, answer=prediction.answer)

    return RAG()


def answer_from_docs(question: str) -> dict:
    """Answer a question from the indexed document collection with ColBERTv2 retrieval (RAG).

    Args:
        question: a question about the indexed documents, like "How does ColBERTv2 compress its index?".
    """
    global _rag
    try:
        if _rag is None:
            _rag = _build_rag()
        prediction = _rag(question=question)
        return {"status": "ok", "answer": prediction.answer, "sources": prediction.context}
    except Exception as error:
        return {"status": "error", "message": str(error)}


def add_paper(pdf_path: str) -> dict:
    """Add a research paper (PDF) to the document index. answer_from_docs can use it then.

    Args:
        pdf_path: path to a PDF file, for example "data/papers/colbertv2.pdf".
    """
    try:
        return colbert_add(pdf_path)
    except Exception as error:
        return {"status": "error", "message": str(error), "reason": "indexing-failed"}
