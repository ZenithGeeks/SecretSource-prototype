"""RAG over indexed papers: DSPy + the ColBERT retrieval service.
ADK builds each tool's schema from type hints + docstring."""

from app.clients.retrieval import colbert_add

_rag = None  # lazy: needs dspy, a running LM and the ColBERT service


def _build_rag():
    import dspy

    from app.config import COLBERT_URL
    from app.llm import dspy_lm

    language_model = dspy_lm()
    retriever = dspy.ColBERTv2(url=f"{COLBERT_URL}/api/search")

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
            passages = [passage["text"] for passage in retriever(question, k=self.k)]
            # dspy.context is thread-safe; dspy.configure is not (ADK runs tools in worker threads)
            with dspy.context(lm=language_model):
                prediction = self.generate(context=passages, question=question)
            return dspy.Prediction(context=passages, answer=prediction.answer)

    return RAG()


def answer_from_docs(question: str) -> dict:
    """Answer a question from the indexed document collection using ColBERTv2 retrieval (RAG).

    Args:
        question: a question about the indexed documents, e.g. "How does ColBERTv2 compress its index?".
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
    """Add a research paper (PDF) to the document index so answer_from_docs can use it.

    Args:
        pdf_path: path to a PDF file, e.g. "data/papers/colbertv2.pdf".
    """
    try:
        return colbert_add(pdf_path)
    except Exception as error:
        return {"status": "error", "message": str(error)}
