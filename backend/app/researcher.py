"""What the researcher screens show, built from one user's analyses.

Home, the library, field consensus and the knowledge graph are all computed from the stored
analyses: the claims a paper makes, the works it cites, and the verdicts already found. Only
projects (which papers a user grouped together) are stored on their own, in app/store.py.

These are plain functions over lists of analyses, so they can be tested without a gateway.
"""

import hashlib
import re
from collections import Counter

from app.pipeline.claims import _tokens

UNSORTED = "unsorted"  # the project that holds every paper not put in a project
MATCH = 0.34  # share of a question's words a claim must contain to count as an answer
CONSENSUS_ROWS = 20
HOME_CONFLICTS = 5
HOME_QUEUE = 5


# --- Papers and claims ---------------------------------------------------------------


def library_papers(analyses: list[dict]) -> list[dict]:
    """The finished analyses, one per paper. A paper analysed twice counts once: the newest
    run wins. `analyses` is oldest first, as the gateway keeps them.

    A single-claim check (POST /verify) is not stored against a paper: it has neither `file`
    nor `paper`, so it is not part of the library and is skipped here rather than crashing
    every researcher route with a KeyError (#256)."""
    newest: dict[str, dict] = {}
    for analysis in analyses:
        if analysis.get("status") != "done":
            continue
        key = analysis.get("file") or analysis.get("paper")
        if key:
            newest[key] = analysis
    return list(newest.values())


def standing(claim: dict) -> str:
    """backed, contradicted, silent or unchecked. The worst answer wins, as in the web app's
    claim cards: one contradicting source outweighs three supporting ones."""
    verdicts = [verdict.get("verdict") for verdict in claim.get("verdicts", [])]
    if "refutes" in verdicts:
        return "contradicted"
    if "insufficient" in verdicts:
        return "silent"
    if verdicts:
        return "backed"
    return "unchecked"


def tally(papers: list[dict]) -> dict:
    counts = Counter(standing(claim) for paper in papers for claim in paper.get("claims", []))
    return {name: counts.get(name, 0) for name in ("backed", "silent", "contradicted", "unchecked")}


def _count(number: int, noun: str) -> str:
    """ "1 claim", "3 claims"."""
    return f"{number} {noun}{'' if number == 1 else 's'}"


def title_of(analysis: dict) -> str:
    """The paper's own title, or its file name when GROBID found no title (older analyses)."""
    if analysis.get("title"):
        return analysis["title"]
    name = (analysis.get("file") or analysis["paper"]).replace("\\", "/").split("/")[-1]
    return re.sub(r"\.pdf$", "", name, flags=re.I)


def cite(authors: list[str], year: str, comma: bool = False) -> str:
    """ "Han et al. 2025", from the authors and year. Empty when there are no authors."""
    if not authors:
        return year
    surname = authors[0].split()[-1]
    who = f"{surname} et al." if len(authors) > 1 else surname
    return f"{who}{',' if comma else ''} {year}".strip()


def short_title(title: str) -> str:
    """ "ColBERTv2" from "ColBERTv2: Effective and Efficient Retrieval via ..."."""
    head = title.split(":")[0].strip()
    return head if 0 < len(head) <= 60 else title[:60]


def work_key(citation: dict) -> str:
    """One key per cited work, whichever way a paper wrote it down."""
    if citation.get("doi"):
        return "doi:" + citation["doi"].lower()
    if citation.get("arxiv"):
        return "arxiv:" + re.sub(r"v\d+$", "", citation["arxiv"].lower())
    return "title:" + " ".join(_tokens(citation.get("title", "")))


def analysis_keys(analysis: dict) -> set[str]:
    """The keys an analysed paper would have if another paper cited it."""
    keys = set()
    paper = analysis["paper"].strip()
    stem = re.sub(r"\.pdf$", "", paper.replace("\\", "/").split("/")[-1], flags=re.I)
    if re.fullmatch(r"10\.\d{4,9}/\S+", paper):
        keys.add("doi:" + paper.lower())
    for candidate in (paper, stem):
        if re.fullmatch(r"\d{4}\.\d{4,5}(v\d+)?", candidate):
            keys.add("arxiv:" + re.sub(r"v\d+$", "", candidate))
    if analysis.get("title"):
        keys.add("title:" + " ".join(_tokens(analysis["title"])))
    return keys


def _cited_work(claim: dict, verdict: dict) -> dict:
    """The citation a verdict answers for, matched by what it was looked up by."""
    for citation in claim.get("citations", []):
        if verdict.get("cited") in (
            citation.get("doi"),
            citation.get("arxiv"),
            citation.get("title"),
            citation.get("url"),
        ):
            return citation
    name = re.sub(r"\.pdf$", "", verdict.get("source", ""), flags=re.I)
    return {"title": name, "authors": [], "year": "", "doi": "", "arxiv": "", "url": ""}


def _page(verdict: dict) -> str:
    evidence = verdict.get("evidence") or []
    return f"p.{evidence[0]['page']}" if evidence and evidence[0].get("page") else ""


# --- Home ----------------------------------------------------------------------------


def home(analyses: list[dict]) -> dict:
    papers = library_papers(analyses)
    counts = tally(papers)
    claims = sum(counts.values())
    verified = claims - counts["unchecked"]

    conflicts = []
    for paper in reversed(papers):  # newest first
        for index, claim in enumerate(paper.get("claims", [])):
            verdicts = claim.get("verdicts", [])
            against = [
                short_title(_cited_work(claim, v)["title"]) for v in verdicts if v.get("verdict") == "refutes"
            ]
            if against:
                conflicts.append(
                    {
                        "claim": claim["claim"],
                        "for": [
                            short_title(_cited_work(claim, v)["title"])
                            for v in verdicts
                            if v.get("verdict") == "supports"
                        ],
                        "against": against,
                        "analysis": paper["id"],
                        "claimIndex": index,
                    }
                )

    analysed = set().union(*(analysis_keys(paper) for paper in papers)) if papers else set()
    cited_by: dict[str, set[str]] = {}
    claims_citing: Counter = Counter()
    works: dict[str, dict] = {}
    for paper in papers:
        for claim in paper.get("claims", []):
            for citation in claim.get("citations", []):
                key = work_key(citation)
                if key in analysed or key == "title:":
                    continue
                works.setdefault(key, citation)
                cited_by.setdefault(key, set()).add(paper["id"])
                claims_citing[key] += 1
    ranked = sorted(works, key=lambda key: (len(cited_by[key]), claims_citing[key]), reverse=True)
    queue = []
    for key in ranked:
        if claims_citing[key] < 2:
            break
        citation = works[key]
        by = len(cited_by[key])
        queue.append(
            {
                "paper": short_title(citation.get("title") or key)
                + (f" ({citation['year']})" if citation.get("year") else ""),
                "note": (
                    f"cited by {by} papers you analysed"
                    if by > 1
                    else f"cited by {claims_citing[key]} claims"
                )
                + ", not in your library",
                "identifier": citation.get("doi") or citation.get("arxiv") or citation.get("title", ""),
            }
        )
        if len(queue) == HOME_QUEUE:
            break

    if not papers:
        alert = "Analyse a paper to start your library."
    elif counts["contradicted"]:
        alert = (
            f"{_count(counts['contradicted'], 'claim')} in your papers contradicted by the work they cite."
        )
    else:
        alert = f"{verified} of {_count(claims, 'claim')} in your papers checked against their sources."

    return {
        "alert": alert,
        "conflicts": conflicts[:HOME_CONFLICTS],
        "queue": queue,
        "library": {"papers": len(papers), "claims": claims, "verified": verified, "tally": counts},
    }


# --- Projects and the library ---------------------------------------------------------


def _in_project(project: dict, papers: list[dict]) -> list[dict]:
    wanted = set(project.get("analyses", []))
    return [paper for paper in papers if paper["id"] in wanted]


def _unsorted(projects: list[dict], papers: list[dict]) -> list[dict]:
    placed = {analysis_id for project in projects for analysis_id in project.get("analyses", [])}
    return [paper for paper in papers if paper["id"] not in placed]


def _summary(project_id: str, name: str, papers: list[dict], updated: str, unsorted: bool = False) -> dict:
    counts = tally(papers)
    return {
        "id": project_id,
        "name": name,
        "papers": len(papers),
        "claims": sum(counts.values()),
        "clusters": 0,  # papers are not clustered yet
        "tally": counts,
        "updated": updated,
        **({"unsorted": True} if unsorted else {}),
    }


def projects(stored: list[dict], analyses: list[dict]) -> list[dict]:
    """Every project of the user, newest change first, then Unsorted when it has papers."""
    papers = library_papers(analyses)
    listed = [
        _summary(project["id"], project["name"], _in_project(project, papers), project.get("updated", ""))
        for project in sorted(stored, key=lambda project: project.get("updated", ""), reverse=True)
    ]
    loose = _unsorted(stored, papers)
    if loose:
        listed.append(_summary(UNSORTED, "Unsorted", loose, "", unsorted=True))
    return listed


def library(project_id: str, stored: list[dict], analyses: list[dict]) -> dict | None:
    """One project's papers, or None when the user has no such project."""
    papers = library_papers(analyses)
    if project_id == UNSORTED:
        chosen = _unsorted(stored, papers)
    else:
        project = next((project for project in stored if project["id"] == project_id), None)
        if project is None:
            return None
        chosen = _in_project(project, papers)

    cited = {
        paper["id"]: {work_key(c) for claim in paper.get("claims", []) for c in claim.get("citations", [])}
        for paper in chosen
    }
    rows = []
    for paper in reversed(chosen):  # newest first
        claims = paper.get("claims", [])
        checked = any(claim.get("verdicts") or claim.get("unchecked") for claim in claims)
        standings = Counter(standing(claim) for claim in claims)
        linked = [
            short_title(title_of(other))
            for other in chosen
            if other["id"] != paper["id"] and cited[paper["id"]] & cited[other["id"]]
        ]
        rows.append(
            {
                "id": paper["id"],
                "title": title_of(paper),
                "cite": cite(paper.get("authors", []), paper.get("year", "")),
                "cluster": "",
                "claims": len(claims),
                "backed": standings["backed"] if checked else None,
                "contradicted": standings["contradicted"] if checked else None,
                "linked": linked[:3],
            }
        )
    claim_count = sum(row["claims"] for row in rows)
    return {
        "summary": f"{_count(len(rows), 'paper')} · {_count(claim_count, 'claim')}",
        "clusters": ["All", "Unverified"],
        "papers": rows,
    }


# --- Field consensus -------------------------------------------------------------------


def consensus(question: str, analyses: list[dict]) -> dict:
    """What the works cited in the user's papers say about a question, from verdicts already
    found. A claim answers the question when it contains enough of the question's words."""
    empty = {
        "question": question,
        "supports": 0,
        "refutes": 0,
        "silent": 0,
        "span": "",
        "note": "",
        "rows": [],
        "unlisted": 0,
    }
    wanted = set(_tokens(question))
    if not wanted:
        return {**empty, "note": "Ask a question about your field."}

    matches = []
    for paper in library_papers(analyses):
        for index, claim in enumerate(paper.get("claims", [])):
            words = set(_tokens(claim["claim"] + " " + (claim.get("sentence") or "")))
            score = len(wanted & words) / len(wanted)
            if score >= MATCH and claim.get("verdicts"):
                matches.append((score, paper, index, claim))
    matches.sort(key=lambda match: match[0], reverse=True)

    rows, seen = [], set()
    for _, paper, index, claim in matches:
        for verdict in claim["verdicts"]:
            work = _cited_work(claim, verdict)
            key = (work_key(work), verdict.get("verdict"), claim["claim"])
            if key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "paper": short_title(work.get("title", "")),
                    "cite": cite(work.get("authors", []), work.get("year", ""), comma=True),
                    "verdict": verdict.get("verdict", "insufficient"),
                    "quote": verdict.get("quote", ""),
                    "claim": claim["claim"],
                    "analysis": paper["id"],
                    "claimIndex": index,
                    "year": work.get("year", ""),
                }
            )

    if not rows:
        return {**empty, "note": "No claim in your analysed papers answers this yet."}
    years = sorted(int(row["year"]) for row in rows if str(row["year"]).isdigit())
    counts = Counter(row["verdict"] for row in rows)
    claims = len({(row["analysis"], row["claimIndex"]) for row in rows})
    return {
        "question": question,
        "supports": counts["supports"],
        "refutes": counts["refutes"],
        "silent": counts["insufficient"],
        "span": (f"{years[0]}–{years[-1]}" if years[0] != years[-1] else str(years[0])) if years else "",
        "note": f"From {_count(claims, 'claim')} in your analysed papers that match the question.",
        "rows": [{k: v for k, v in row.items() if k != "year"} for row in rows[:CONSENSUS_ROWS]],
        "unlisted": max(0, len(rows) - CONSENSUS_ROWS),
    }


# --- Knowledge graph -------------------------------------------------------------------


def _node_id(prefix: str, key: str) -> str:
    return f"{prefix}{hashlib.sha1(key.encode()).hexdigest()[:10]}"


def _year(year: str) -> str:
    return f"'{year[-2:]}" if year and year[-2:].isdigit() else ""


INDEX_NAMES = {"semantic-scholar": "Semantic Scholar", "arxiv": "arXiv", "unpaywall": "Unpaywall"}
FOUND_WITHOUT_COPY = {"no-open-access"}  # an index knew the work; it just has no free PDF
NOT_FOUND = {"unresolvable", "web-source"}  # no index knew the work


def _index_of_verdict(verdict: dict) -> tuple[str, str]:
    """Whether a public index knew a checked work: ("yes", "Semantic Scholar"), ("no", "") or
    ("", "") when the run does not say. arXiv is asked first for titles, so "arXiv" names the
    index that answered, not the only one that has the work. This is never a Scopus check."""
    index = (verdict.get("indexed_in") or {}).get("index", "")
    if index in INDEX_NAMES:
        return "yes", INDEX_NAMES[index]
    # A bare URL is used as it is, so no index was asked or knew it.
    return ("no", "") if str(verdict.get("cited", "")).startswith("http") else ("", "")


def _index_of_unchecked(entry: dict) -> tuple[str, str]:
    """The same answer for a work we could not check, read from why the check failed."""
    reason = entry.get("reason", "")
    if reason in FOUND_WITHOUT_COPY:
        return "yes", ""
    return ("no", "") if reason in NOT_FOUND else ("", "")


def _mark_index(node: dict, found: tuple[str, str]) -> None:
    """Keep the strongest answer for a work cited several times: found beats not found, and
    either beats not known. One citation with a garbled title must not hide a clean one."""
    rank = {"": 0, "no": 1, "yes": 2}
    state, name = found
    if rank[state] > rank[node["indexed"]]:
        node["indexed"], node["index"] = state, name
    elif state == node["indexed"] and name and not node["index"]:
        node["index"] = name


def graph(analyses: list[dict]) -> dict:
    """Papers and claims as nodes; a paper asserts a claim, a cited work backs, contradicts or
    is silent on it, or could not be checked. Paper links join a paper to the works it cites,
    and two analysed papers that cite the same works. A cited work's node says whether a
    public index knew it (`indexed`: yes, no, or "" when not known)."""
    papers = library_papers(analyses)
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    edge_ids: set[str] = set()
    key_to_node: dict[str, str] = {}

    for paper in papers:
        node = "a:" + paper["id"]
        nodes[node] = {
            "id": node,
            "kind": "paper",
            "label": short_title(title_of(paper)),
            "year": _year(paper.get("year", "")),
            "cluster": "Analysed",
            "indexed": "",
            "index": "",
        }
        for key in analysis_keys(paper):
            key_to_node[key] = node

    links: dict[tuple[str, str], dict] = {}
    cites: dict[str, set[str]] = {}
    single_source = contradicted = claim_count = 0
    for paper in papers:
        paper_node = "a:" + paper["id"]
        cites[paper_node] = set()
        for index, claim in enumerate(paper.get("claims", [])):
            claim_node = f"c:{paper['id']}:{index}"
            claim_count += 1
            nodes[claim_node] = {"id": claim_node, "kind": "claim", "label": claim["claim"]}
            page = f"p.{claim['source']['page']}" if claim.get("source") else ""
            edges.append(
                {
                    "id": f"{claim_node}:asserts",
                    "source": paper_node,
                    "target": claim_node,
                    "relation": "asserts",
                    "note": "the paper makes this claim",
                    "quote": claim.get("sentence", ""),
                    "page": page,
                }
            )
            if len(claim.get("citations", [])) == 1:
                single_source += 1
            if standing(claim) == "contradicted":
                contradicted += 1
            # Checks that ran, then checks that could not: a work we could not find is still
            # cited, and hiding it would hide the sources most likely to be outside an index.
            answers = [(verdict, None) for verdict in claim.get("verdicts", [])] + [
                ({"cited": entry.get("source", ""), "source": entry.get("source", "")}, entry)
                for entry in claim.get("unchecked", [])
            ]
            for verdict, unchecked in answers:
                work = _cited_work(claim, verdict)
                key = work_key(work)
                work_node = key_to_node.get(key) or _node_id("w:", key)
                if work_node not in nodes:
                    nodes[work_node] = {
                        "id": work_node,
                        "kind": "paper",
                        "label": short_title(work.get("title", "")),
                        "year": _year(work.get("year", "")),
                        "cluster": "Cited",
                        "indexed": "",
                        "index": "",
                    }
                _mark_index(
                    nodes[work_node],
                    _index_of_unchecked(unchecked) if unchecked else _index_of_verdict(verdict),
                )
                edge_id = f"{claim_node}:{work_node}"
                if edge_id in edge_ids:  # the same work cited twice in one claim
                    continue
                edge_ids.add(edge_id)
                if unchecked:
                    relation = "unchecked"
                    edges.append(
                        {
                            "id": edge_id,
                            "source": work_node,
                            "target": claim_node,
                            "relation": relation,
                            "reason": unchecked.get("reason", ""),
                            "note": "",
                            "quote": "",
                            "page": "",
                        }
                    )
                else:
                    relation = {"supports": "backs", "refutes": "contradicts"}.get(
                        verdict.get("verdict"), "silent"
                    )
                    edges.append(
                        {
                            "id": edge_id,
                            "source": work_node,
                            "target": claim_node,
                            "relation": relation,
                            "note": verdict.get("reasoning", ""),
                            "quote": verdict.get("quote", ""),
                            "page": _page(verdict),
                        }
                    )
                if work_node == paper_node:
                    continue
                cites[paper_node].add(work_node)
                link = links.setdefault(
                    (paper_node, work_node), {"claims": 0, "contradicted": 0, "passages": []}
                )
                link["claims"] += 1
                link["contradicted"] += relation == "contradicts"
                if verdict.get("quote") and len(link["passages"]) < 3:
                    link["passages"].append(
                        {
                            "paper": nodes[work_node]["label"],
                            "page": _page(verdict),
                            "quote": verdict["quote"],
                        }
                    )

    paper_edges = []
    for (a, b), link in links.items():
        total = max(1, sum(1 for edge in edges if edge["source"] == a and edge["relation"] == "asserts"))
        paper_edges.append(
            {
                "id": f"{a}->{b}",
                "a": a,
                "b": b,
                "similarity": round(link["claims"] / total, 2),
                "sharedPassages": len(link["passages"]),
                "citations": link["claims"],
                "cites": True,
                "contradicted": link["contradicted"],
                "passages": link["passages"],
            }
        )
    analysed_nodes = sorted(cites)
    for i, a in enumerate(analysed_nodes):
        for b in analysed_nodes[i + 1 :]:
            shared = cites[a] & cites[b]
            if shared:
                paper_edges.append(
                    {
                        "id": f"{a}<->{b}",
                        "a": a,
                        "b": b,
                        "similarity": round(len(shared) / len(cites[a] | cites[b]), 2),
                        "sharedPassages": 0,
                        "citations": len(shared),
                        "cites": False,
                        "contradicted": 0,
                        "passages": [],
                    }
                )

    return {
        "stats": [
            {"count": len(papers), "label": "papers analysed"},
            {"count": claim_count, "label": "claims"},
            {"count": single_source, "label": "claims rest on a single source"},
            {"count": contradicted, "label": "claims contradicted by a source"},
        ],
        "clusters": ["Analysed", "Cited"],
        "nodes": list(nodes.values()),
        "edges": edges,
        "paperEdges": paper_edges,
    }
