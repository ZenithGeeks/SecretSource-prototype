"""The analysis pipeline as a graph (app/workflow.py). Send a DOI, arXiv ID, URL or a PDF
path as the message; set state verify=false to stop after claim extraction."""

from app.workflow import analysis_workflow as root_agent  # noqa: F401
