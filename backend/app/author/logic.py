"""What the Author screens show, as plain functions over a draft's files and its checks.

A draft is a small LaTeX project: `.tex` files with `\\cite{key}` commands and a `.bib`. This
module reads them the way "Parsed draft" describes it (which citation is where, what the
bibliography is missing), turns a check's per-citation verdicts into the counts the cards
show, and diffs two checks for "Since v2". No I/O and no gateway here, so it is all testable
on its own; app/author/router.py is the HTTP layer over it.

Verdicts: supports / refutes / insufficient are the pipeline's three answers; unavailable
means the check ran but the source could not be read; unchecked means it never ran (no bib
entry, or no check yet). The same five words are the frontend's `Verdict` union.
"""

import hashlib
import html
import re
import unicodedata
from bisect import bisect_left, bisect_right
from collections import Counter
from datetime import UTC, datetime

import bibtexparser
from bibtexparser.middlewares import RemoveEnclosingMiddleware
from bibtexparser.middlewares.names import split_multiple_persons_names
from bibtexparser.model import DuplicateBlockKeyBlock, DuplicateFieldKeyBlock, Entry, Field
from bibtexparser.writer import BibtexFormat
from pylatexenc.latex2text import LatexNodes2Text
from pylatexenc.latexencode import unicode_to_latex

from app.names import surname
from app.pipeline.sources import ARXIV_PATTERN
from app.text import sentence_spans

VERDICTS = ("supports", "refutes", "insufficient", "unavailable", "unchecked")
NEEDS_WORK = ("refutes", "insufficient")

CITE = re.compile(r"\\(?:cite|citep|citet|parencite|textcite|autocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}")
SECTION = re.compile(r"\\(?:chapter|section|subsection|subsubsection)\*?\{([^}]*)\}")
LEADING_COMMAND = re.compile(r"^\s*(?:\\item\b|\\(?:sub)?paragraph\*?\{[^}]*\})\s*")


def content_hash(files: list[dict]) -> str:
    """What a draft's text and bibliography add up to, so a check can tell an edited draft
    from an unchanged one: the same files with the same content hash the same, whatever
    their order."""
    digest = hashlib.sha1()
    for f in sorted(files, key=lambda f: f["name"]):
        digest.update(f["name"].encode("utf-8"))
        digest.update(b"\0")
        digest.update((f.get("content") or "").encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


# --- .bib -------------------------------------------------------------------------------


def parse_bib(text: str) -> list[dict]:
    """The entries of a .bib file: `{"type", "key", "fields", "line"}` each, in file order,
    read by bibtexparser. A half-typed entry is a normal state in the editor: bibtexparser
    skips that block and reads the rest."""
    library = bibtexparser.parse_string(text)
    entries: list[dict] = []
    for block in library.blocks:
        if entry := _entry_of(block, library):
            fields = {field.key.lower(): " ".join(str(field.value).split()) for field in entry.fields}
            kind, line = entry.entry_type.lower(), entry.start_line + 1  # bibtexparser counts from 0
            entries.append({"type": kind, "key": entry.key, "fields": fields, "line": line})
    return entries


def _entry_of(block, library) -> Entry | None:
    """The entry a block holds, or None for @comment, @preamble, @string and failed blocks.

    bibtexparser sets aside an entry whose key or a field repeats, before its middlewares run;
    it is kept here (the lint reports a repeated key), with the braces around its values removed.
    """
    if isinstance(block, DuplicateBlockKeyBlock | DuplicateFieldKeyBlock) and block.ignore_error_block:
        return RemoveEnclosingMiddleware().transform_entry(block.ignore_error_block, library)
    return block if isinstance(block, Entry) else None


def without_bib_entry(text: str, key: str) -> tuple[str, int]:
    """The .bib text with every entry under `key` cut out, and how many were cut. The rest of
    the file stays byte for byte, comments and @string blocks included."""
    library = bibtexparser.parse_string(text)
    removed = 0
    for block in library.blocks:
        entry = _entry_of(block, library)
        if entry is not None and entry.key == key:
            text = text.replace(block.raw, "", 1)
            removed += 1
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return (text + "\n" if text else ""), removed


BIB_FORMAT = BibtexFormat()
BIB_FORMAT.indent = "  "
BIB_FORMAT.trailing_comma = True


def serialize_bib(entry: dict) -> str:
    """One entry as BibTeX text, each value in braces."""
    fields = [Field(name, value) for name, value in entry["fields"].items()]
    block = Entry(entry["type"], entry["key"], fields)
    return bibtexparser.write_string(bibtexparser.Library([block]), bibtex_format=BIB_FORMAT).strip()


def bib_entries(files: list[dict]) -> list[dict]:
    """Every entry of every .bib in a draft, each with the file it came from."""
    entries = []
    for f in files:
        if f.get("kind") == "bib":
            for e in parse_bib(f.get("content", "")):
                entries.append({**e, "file": f["name"]})
    return entries


def lacks_locator(entry: dict) -> bool:
    f = entry["fields"]
    return not (f.get("doi") or f.get("url") or f.get("eprint") or f.get("arxiv"))


def lookup_identifier(entry: dict | None, pdfs: dict[str, str] | None = None) -> str | None:
    """What to check a cited work against: an uploaded PDF first, then DOI, arXiv id, URL,
    title. None when there is no entry to resolve (a missing bib key)."""
    if entry is None:
        return None
    if pdfs and pdfs.get(entry["key"]):
        return pdfs[entry["key"]]
    f = entry["fields"]
    if doi := bib_doi(f):
        return doi
    eprint = f.get("eprint") or f.get("arxiv")
    if eprint and (arxiv := ARXIV_PATTERN.search(eprint)):
        return arxiv.group(0)
    if f.get("url"):
        return f["url"].strip()
    return bib_title(f) or None


def bib_title(fields: dict) -> str:
    """The entry's title without BibTeX braces, or ""."""
    return re.sub(r"[{}]", "", fields.get("title", "")).strip()


def bib_doi(fields: dict) -> str:
    """The entry's DOI without a doi.org or doi: prefix and without LaTeX escapes, or "".

    DBLP writes "10.1007/978-3-030-58452-8\\_13"; the indexes know it without the backslash.
    """
    doi = re.sub(r"^(https?://(dx\.)?doi\.org/|doi:\s*)", "", (fields.get("doi") or "").strip(), flags=re.I)
    return re.sub(r"\\([_&%#$])", r"\1", doi).replace("{", "").replace("}", "")


def bib_surnames(author: str) -> list[str]:
    """The surnames in a BibTeX author field, in order. "Khattab, Omar and Zaharia, Matei" and
    "Omar Khattab and Matei Zaharia" both give ["Khattab", "Zaharia"]; "Haji{\\v{c}}" gives
    "Hajič", and "John Smith Jr." gives "Smith"."""
    return [_latex_to_text(surname(name)).strip() for name in split_multiple_persons_names(author)]


def short_authors(author: str) -> str:
    """ "Khattab & Zaharia", "Santhanam et al." from a BibTeX author field."""
    surnames = bib_surnames(author)
    if not surnames:
        return ""
    if len(surnames) == 1:
        return surnames[0]
    if len(surnames) == 2:
        return f"{surnames[0]} & {surnames[1]}"
    return f"{surnames[0]} et al."


def metadata_mismatches(fields: dict, year: int | None, first_author: str, index: str) -> list[str]:
    """Where a bib entry disagrees with the index record of its DOI, in words for the author:
    ["year: the .bib says 2021, Crossref says 2022"]. A field missing on either side is not a
    mismatch, and a year one off is not either: preprint and proceedings years often differ by one.
    """
    found = []
    bib_year = re.search(r"\d{4}", fields.get("year", "") or "")
    if bib_year and year and abs(int(bib_year.group(0)) - year) > 1:
        found.append(f"year: the .bib says {bib_year.group(0)}, {index} says {year}")
    bib_first = (bib_surnames(fields.get("author", "")) or [""])[0]
    if bib_first and first_author and _last_word(bib_first) != _last_word(first_author):
        found.append(f"first author: the .bib says {bib_first}, {index} says {first_author}")
    return found


# Letters that NFKD does not split into a base letter and an accent.
UNSPLIT_LETTERS = str.maketrans(
    {"ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ß": "ss", "æ": "ae", "œ": "oe", "ı": "i"}
)


def _last_word(name: str) -> str:
    """A surname's last word without case, accents or punctuation, to compare two spellings:
    "van den Berg" and "Berg" match, as do "Müller" and "muller", and "Øvrelid" and "Ovrelid"."""
    words = name.translate(UNSPLIT_LETTERS).split() or [""]
    decomposed = unicodedata.normalize("NFKD", words[-1])
    return re.sub(r"[^a-z]", "", decomposed.encode("ascii", "ignore").decode().lower())


def source_ref(entry: dict, pdfs: dict[str, str] | None = None) -> dict:
    """The work a bib entry describes, as the evidence panel shows it."""
    f = entry["fields"]
    year = re.search(r"\d{4}", f.get("year", "") or "")
    ref = {
        "key": entry["key"],
        "title": re.sub(r"[{}]", "", f.get("title", "")),
        "authors": short_authors(f.get("author", "")),
        "year": int(year.group(0)) if year else None,
        "venue": f.get("booktitle") or f.get("journal") or f.get("publisher") or "",
        "doi": f.get("doi", ""),
        "url": f.get("url", ""),
    }
    if pdfs and pdfs.get(entry["key"]):
        ref["pdf"] = pdfs[entry["key"]]
    return ref


# --- .tex -------------------------------------------------------------------------------


def find_cites(files: list[dict]) -> list[dict]:
    """Every key of every \\cite in the draft's .tex files, in file then line order, with the
    sentence it sits in and the section it is under. Half-typed commands (no closing brace
    yet) are not counted."""
    refs: list[dict] = []
    for f in files:
        if f.get("kind") != "tex":
            continue
        content = f.get("content", "")
        line_starts = _line_starts(content)
        sentence_ends = [end for _, end in sentence_spans(content)]
        section = ""
        for m in re.finditer(r"%.*|" + SECTION.pattern + "|" + CITE.pattern, content):
            if m.group(0).startswith("%"):
                continue
            if m.group(0).startswith("\\cite") or "cite" in m.group(0)[:12]:
                keys = [k.strip() for k in m.group(m.lastindex).split(",") if k.strip()]
                line = _line_of(line_starts, m.start())
                sentence = _sentence_around(content, m.start(), m.end(), sentence_ends)
                inner = m.group(0).rfind("{") + 1
                for key in keys:
                    refs.append(
                        {
                            "key": key,
                            "file": f["name"],
                            "line": line,
                            "column": m.start() - line_starts[line - 1] + inner + 1,
                            "section": section,
                            "sentence": sentence,
                            "claim": plain_text(sentence),
                        }
                    )
            else:
                section = re.sub(r"[{}]", "", m.group(1)).strip()
    return refs


def _line_starts(content: str) -> list[int]:
    starts = [0]
    for i, c in enumerate(content):
        if c == "\n":
            starts.append(i + 1)
    return starts


def _line_of(starts: list[int], offset: int) -> int:
    return bisect_right(starts, offset)


def _sentence_around(content: str, start: int, end: int, sentence_ends: list[int]) -> str:
    """The sentence a \\cite sits in: back to the previous sentence end, blank line or
    command line; forward to the next sentence end or blank line. sentence_ends are the
    content's Punkt sentence ends, worked out once per file."""
    before = content[:start]
    previous = bisect_right(sentence_ends, start) - 1
    cut = sentence_ends[previous] if previous >= 0 else 0
    blank = before.rfind("\n\n")
    cut = max(cut, blank + 2 if blank >= 0 else 0)
    # A heading or command line above belongs to no sentence. The \cite's own line is prose
    # even when it starts with \item or \paragraph{...}: only that command is dropped (#437).
    *above, own = before[cut:].split("\n")
    kept = [LEADING_COMMAND.sub("", own)]
    for line in reversed(above):
        if line.strip().startswith("\\") or line.strip().startswith("%"):
            break
        kept.insert(0, line)
    head = "\n".join(kept)
    after = content[end:]
    following = bisect_left(sentence_ends, end)
    stop = sentence_ends[following] - end if following < len(sentence_ends) else len(after)
    blank_after = after.find("\n\n")
    if blank_after >= 0:
        stop = min(stop, blank_after)
    return re.sub(r"\s+", " ", (head + content[start:end] + after[:stop]).strip())


def cited_text(sentence: str, key: str) -> str:
    """The sentence in plain words with "[cited]" where `key` is cited, so the judge can tell
    which words the citation is for: "We use AdamW [cited] with weight decay 0.1." (#437).
    The judge picks its citation-aware prompt by this mark (app.pipeline.verify.CITED_MARK)."""

    def mark(cite: re.Match) -> str:
        keys = [k.strip() for k in cite.group(1).split(",")]
        return " [cited]" if key in keys else cite.group(0)

    return plain_text(CITE.sub(mark, sentence))


def plain_text(latex: str) -> str:
    """A sentence in plain words: citations, comments and formatting commands removed, so
    the pipeline judges the claim and not the markup."""
    s = CITE.sub("", latex)
    s = re.sub(r"(?<!\\)%.*", "", s)
    s = re.sub(r"\\(?:label|ref|eqref|pageref|footnote|index)\{[^}]*\}", "", s)
    # Unwrap formatting commands, twice on purpose. The pattern's [^{}]* argument matches
    # only an innermost {...}, so one pass turns \textbf{\emph{x}} into \textbf{x} and a
    # second is needed to reach x. Two passes cover the two levels of nesting prose has.
    for _ in range(2):
        s = re.sub(r"\\[A-Za-z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}", r"\1", s)
    s = re.sub(r"\$([^$]*)\$", r"\1", s)
    for command, word in (
        ("\\times", "×"),
        ("\\ldots", "…"),
        ("\\dots", "…"),
        ("\\%", "%"),
        ("\\&", "&"),
        ("\\_", "_"),
        ("\\#", "#"),
        ("\\$", "$"),
    ):
        s = s.replace(command, word)
    s = s.replace("~", " ").replace("---", "—").replace("--", "–")
    s = re.sub(r"\\[A-Za-z]+", "", s)
    s = re.sub(r"[{}]", "", s)
    s = re.sub(r"\s+([.,;:])", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


def _latex_to_text(latex: str) -> str:
    """A name in plain Unicode: "Haji{\\v{c}}" is "Hajič". Only for names: pylatexenc drops
    the argument of commands like \\texttt and \\mbox, so plain_text keeps its own rules."""
    return LatexNodes2Text().latex_to_text(latex)


def parse_project(files: list[dict]) -> dict:
    """What "Parsed draft" shows: counts and the four kinds of warning, each pointing at the
    file and line to fix."""
    tex = [f for f in files if f.get("kind") == "tex"]
    cites = find_cites(files)
    entries = bib_entries(files)
    known = {e["key"] for e in entries}
    cited = {c["key"] for c in cites}
    warnings: list[dict] = []

    missing: set[str] = set()
    for c in cites:
        if c["key"] in known or c["key"] in missing:
            continue
        missing.add(c["key"])
        warnings.append(
            {
                "type": "missing-key",
                "detail": f"\\cite{{{c['key']}}} in {c['file']} L{c['line']}",
                "file": c["file"],
                "line": c["line"],
            }
        )

    seen: Counter[str] = Counter(e["key"] for e in entries)
    for key, count in seen.items():
        if count > 1:
            second = [e for e in entries if e["key"] == key][1]
            warnings.append(
                {
                    "type": "duplicate-key",
                    "detail": f"{key} defined twice",
                    "file": second["file"],
                    "line": second["line"],
                }
            )

    unused = [e for e in entries if e["key"] not in cited]
    unused_keys = list(dict.fromkeys(e["key"] for e in unused))
    if unused_keys:
        first, rest = unused_keys[0], unused_keys[1:]
        detail = (
            f"{first} is never cited"
            if not rest
            else f"{first} and {len(rest)} other{'' if len(rest) == 1 else 's'} are never cited"
        )
        warnings.append(
            {"type": "unused-entry", "detail": detail, "file": unused[0]["file"], "line": unused[0]["line"]}
        )

    locatable = {e["key"] for e in entries if not lacks_locator(e)}
    no_locator = [e for e in entries if e["key"] in cited and e["key"] not in locatable]
    if no_locator:
        keys = sorted(set(e["key"] for e in no_locator))
        warnings.append(
            {
                "type": "no-doi-url",
                "detail": ", ".join(keys),
                "file": no_locator[0]["file"],
                "line": no_locator[0]["line"],
            }
        )

    return {
        "texFiles": len(tex),
        "citeCommands": len(cites),
        "bibEntries": len(entries),
        "warnings": warnings,
    }


def lint_project(bib: dict | None, drafts: list[tuple[str, list[dict]]]) -> dict:
    """The bib lint of a whole project (#714).

    Each draft is linted as it builds: its own files plus the project's .bib unless it holds a
    file of that name itself (`drafts` gives each draft's id and those files, the project's
    .bib marked `shared`). Its warnings name the draft (`draftId`). What a draft's own .bib files
    hold (never cited, no DOI or URL) is judged on those files alone, since parse_project merges
    all of a draft's entries into one warning. The project .bib's own warnings are worked out
    once, against the citations of every draft that uses it, and name no draft: an entry cited
    only in another draft is not "never cited".

    Args:
        bib: the project's {"name", "content"}, or None.
        drafts: (draft id, the files that draft builds with).
    """
    bib_name = (bib or {}).get("name")
    project_warnings: list[dict] = []
    entries = 0
    if bib:
        # The project .bib against everything its drafts cite. A stand-in file carries those
        # cites, so the warnings are the ones a single draft would get, phrased the same way.
        users = [files for _, files in drafts if any(f.get("shared") for f in files)]
        keys = {c["key"] for files in users for c in find_cites(files)}
        cites = "\\cite{" + ",".join(sorted(keys)) + "}" if keys else ""
        stand_in = {"name": "", "kind": "tex", "content": cites}
        project_bib = {"name": bib_name, "kind": "bib", "content": bib.get("content", "")}
        whole = parse_project([stand_in, project_bib])
        entries = whole["bibEntries"]
        project_warnings = [{**w, "draftId": None} for w in whole["warnings"] if w["file"] == bib_name]
    defined_twice_there = {w["detail"] for w in project_warnings if w["type"] == "duplicate-key"}

    warnings = list(project_warnings)
    tex_files = cite_commands = 0
    for draft_id, files in drafts:
        built = parse_project(files)
        own = parse_project([f for f in files if not f.get("shared")])
        uses_bib = any(f.get("shared") for f in files)
        tex_files += built["texFiles"]
        cite_commands += built["citeCommands"]
        entries += own["bibEntries"]
        found = [
            w
            for w in built["warnings"]
            if w["type"] == "missing-key"
            or (
                w["type"] == "duplicate-key"
                and not (uses_bib and w["file"] == bib_name and w["detail"] in defined_twice_there)
            )
        ]
        found += [w for w in own["warnings"] if w["type"] in ("unused-entry", "no-doi-url")]
        warnings += [{**w, "draftId": draft_id} for w in found]
    return {
        "bibName": bib_name,
        "bibEntries": entries,
        "drafts": len(drafts),
        "texFiles": tex_files,
        "citeCommands": cite_commands,
        "warnings": warnings,
    }


def replace_cite_key(content: str, line: int, old: str, new: str) -> str:
    """Swap one key for another inside the \\cite on `line` (1-based). Other keys in the same
    command stay. Unchanged when the key is not there."""
    lines = content.split("\n")
    if not 1 <= line <= len(lines):
        return content

    def swap(m: re.Match) -> str:
        keys = [k.strip() for k in m.group(1).split(",")]
        if old not in keys:
            return m.group(0)
        swapped = ", ".join(new if k == old else k for k in keys)
        whole = m.group(0)
        return whole[: whole.rfind("{") + 1] + swapped + "}"

    lines[line - 1] = CITE.sub(swap, lines[line - 1])
    return "\n".join(lines)


# --- checks -----------------------------------------------------------------------------


def is_open_issue(citation: dict) -> bool:
    return citation.get("verdict") in NEEDS_WORK and not citation.get("resolution")


def summarize(citations: list[dict]) -> dict:
    """The counts a draft's cards show: how many got each verdict, how many still need work."""
    counts = Counter(c.get("verdict", "unchecked") for c in citations)
    return {
        "checked": sum(counts[v] for v in ("supports", "refutes", "insufficient", "unavailable")),
        "counts": {v: counts.get(v, 0) for v in VERDICTS},
        "open": sum(1 for c in citations if is_open_issue(c)),
    }


MESSAGE_LIMIT = 140


def _clip(text: str, limit: int) -> str:
    return f"{text[: limit - 1].rstrip()}…" if len(text) > limit else text


def short_message(message: str | None) -> str:
    """Why a source could not be read, fit for one line. A citation's message can be whatever a
    server answered, such as a whole Cloudflare error page: that becomes a summary, and anything
    else loses its tags and is cut short. Same rule as shortMessage in lib/citations.ts."""
    if not message:
        return ""
    if re.search(r"<(!doctype|html|head|body)\b", message, re.IGNORECASE):
        found = re.search(r"<title[^>]*>([^<]*)", message, re.IGNORECASE)
        title = re.sub(r"\s+", " ", found.group(1)).strip() if found else ""
        summary = "the server sent an error page"
        return f"{summary} ({_clip(title, 60)})" if title else summary
    return _clip(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", message)).strip(), MESSAGE_LIMIT)


def status_label(status: dict) -> str:
    """ "3 issues", "1 unavailable · 1 not checked", "all supported", "no open issues",
    "2 not checked", "not checked" — the words a draft row ends with. "all supported" only when
    every citation is supported (#727): an unread source, a missing key (the only way a finished
    check leaves a citation unchecked) or a contradiction the author kept is never called
    supported. A check whose every key was missing says how many it could not check, not that
    no check ran. Same rule as statusLabel in frontend/src/lib/verdict.ts."""
    if status["checked"] == 0:
        unchecked = status["counts"].get("unchecked", 0)
        return f"{unchecked} not checked" if unchecked else "not checked"
    if status["open"]:
        return f"{status['open']} issue{'' if status['open'] == 1 else 's'}"
    unavailable = status["counts"].get("unavailable", 0)
    unchecked = status["counts"].get("unchecked", 0)
    if unavailable or unchecked:
        parts = [
            f"{unavailable} unavailable" if unavailable else "",
            f"{unchecked} not checked" if unchecked else "",
        ]
        return " · ".join(p for p in parts if p)
    if status["counts"].get("supports", 0) == status["checked"]:
        return "all supported"
    return "no open issues"


def label_after_counts(status: dict) -> str:
    """The label after a counts line that already ends with "· N unavailable" (the report
    header), without that repeat; empty when nothing is left to say. Same as labelAfterCounts
    in frontend/src/lib/verdict.ts."""
    counts = status["counts"]
    if status["checked"] == 0 or status["open"] or not counts.get("unavailable", 0):
        return status_label(status)
    unchecked = counts.get("unchecked", 0)
    return f"{unchecked} not checked" if unchecked else ""


def counts_line(status: dict) -> str:
    """ "12 citations · 7 supported · 2 partial · 2 not supported · 1 unavailable"."""
    c = status["counts"]
    parts = [f"{status['checked']} citation{'' if status['checked'] == 1 else 's'}"]
    for verdict, word in (
        ("supports", "supported"),
        ("insufficient", "partial"),
        ("refutes", "not supported"),
        ("unavailable", "unavailable"),
    ):
        if c.get(verdict):
            parts.append(f"{c[verdict]} {word}")
    return " · ".join(parts)


def _by_place(citations: list[dict]) -> dict[str, dict]:
    """Citations keyed by key and which occurrence of that key, so two checks line up even
    when lines moved."""
    seen: Counter[str] = Counter()
    out = {}
    for c in citations:
        n = seen[c["key"]]
        seen[c["key"]] += 1
        out[f"{c['key']}#{n}"] = c
    return out


def delta(current: list[dict], previous: list[dict] | None) -> dict | None:
    """What changed since the previous check: citations added, issues fixed, issues new."""
    if previous is None:
        return None
    now, before = _by_place(current), _by_place(previous)
    fixed = sum(
        1
        for k, c in before.items()
        if c.get("verdict") in NEEDS_WORK and (k not in now or now[k].get("verdict") not in NEEDS_WORK)
    )
    new = sum(
        1
        for k, c in now.items()
        if c.get("verdict") in NEEDS_WORK and (k not in before or before[k].get("verdict") not in NEEDS_WORK)
    )
    return {"addedCitations": len(now) - len(before), "fixedIssues": fixed, "newIssues": new}


def compare(current: list[dict], previous: list[dict]) -> list[dict]:
    """Row by row: every citation of either check with both verdicts, for "Compare vN with
    vN-1". `change` is added / removed / fixed / new / changed / same."""
    now, before = _by_place(current), _by_place(previous)
    rows = []
    for place in dict.fromkeys(list(before) + list(now)):
        a, b = before.get(place), now.get(place)
        va, vb = (a or {}).get("verdict"), (b or {}).get("verdict")
        if a is None:
            change = "added"
        elif b is None:
            change = "removed"
        elif va == vb:
            change = "same"
        elif va in NEEDS_WORK and vb not in NEEDS_WORK:
            change = "fixed"
        elif vb in NEEDS_WORK and va not in NEEDS_WORK:
            change = "new"
        else:
            change = "changed"
        rows.append(
            {
                "key": place.split("#")[0],
                "claim": (b or a).get("claim", ""),
                "file": (b or a).get("file"),
                "line": (b or a).get("line"),
                "before": va,
                "after": vb,
                "change": change,
            }
        )
    return rows


# --- saved sources ----------------------------------------------------------------------


def bib_key_for(authors: list[str], year: str | int | None, taken: set[str] | None = None) -> str:
    """ "santhanam2022", made unique against `taken` with a letter suffix."""
    first = _last_word(surname(authors[0])) if authors else ""
    base = f"{first or 'source'}{year or ''}"
    key, suffix = base, "b"
    while taken and key in taken:
        key = base + suffix
        suffix = chr(ord(suffix) + 1)
    return key


def latex_escape(text: str) -> str:
    """Text safe inside a BibTeX value: "A & B" is "A \\& B" and "Müller" is "M\\"uller"."""
    return unicode_to_latex(text, unknown_char_policy="keep")  # a character with no LaTeX form stays


def bibtex_for(result: dict, key: str | None = None) -> str:
    """A BibTeX entry for a saved source, LaTeX-escaped."""
    key = key or result.get("key") or bib_key_for(result.get("authorsList", []), result.get("year"))
    venue = (result.get("venue") or "").lower()
    kind = "article" if any(w in venue for w in ("journal", "transactions", "letters")) else "inproceedings"
    fields = {
        "title": latex_escape(result.get("title", "")),
        "author": " and ".join(latex_escape(name) for name in result.get("authorsList", [])),
        "year": str(result.get("year") or ""),
    }
    if result.get("venue"):
        fields["journal" if kind == "article" else "booktitle"] = latex_escape(result["venue"])
    if result.get("doi"):
        fields["doi"] = result["doi"]
    if result.get("arxiv"):
        fields["eprint"] = result["arxiv"]
    if result.get("url") and not result.get("doi"):
        fields["url"] = result["url"]
    return serialize_bib({"type": kind, "key": key, "fields": {k: v for k, v in fields.items() if v}})


# --- report -----------------------------------------------------------------------------


def _esc(text: object) -> str:
    return html.escape(str(text))


VERDICT_WORDS = {
    "supports": "Source backs it",
    "refutes": "Source contradicts",
    "insufficient": "Source is silent",
    "unavailable": "Source unavailable",
    "unchecked": "Not checked",
}


def report_html(draft: dict, check: dict) -> str:
    """The verification report: every citation, its verdict and the passage it rests on."""
    citations = check.get("citations", [])
    status = summarize(citations)
    when = check.get("finishedAt") or check.get("startedAt") or ""
    rows = []
    for i, c in enumerate(citations, 1):
        ref = c.get("sourceRef") or {}
        evidence = c.get("evidence") or {}
        rows.append(
            f"<h3>{i}. \\cite{{{_esc(c['key'])}}} — "
            f"{_esc(VERDICT_WORDS.get(c.get('verdict'), c.get('verdict')))}</h3>"
            f"<p><i>{_esc(c.get('file'))} L{_esc(c.get('line'))}"
            + (f" · {_esc(c['section'])}" if c.get("section") else "")
            + "</i></p>"
            f"<p><b>Sentence.</b> {_esc(c.get('claim') or c.get('sentence') or '')}</p>"
            + (
                f"<p><b>Source.</b> {_esc(ref.get('authors', ''))} ({_esc(ref.get('year', ''))}). "
                f"{_esc(ref.get('title', ''))}</p>"
                if ref
                else ""
            )
            + (
                f"<p><b>Passage</b> ({_esc(evidence.get('pdf', ''))} p.{_esc(evidence.get('page', ''))}). "
                f"“{_esc(evidence.get('passage', ''))}”</p>"
                if evidence.get("passage")
                else ""
            )
            + (f"<p><b>Why.</b> {_esc(c['explanation'])}</p>" if c.get("explanation") else "")
            + (
                f"<p><b>Could not check.</b> {_esc(short_message(c['message']))}</p>"
                if c.get("message") and c.get("verdict") in ("unavailable", "unchecked")
                else ""
            )
            + (
                f"<p><b>Author's note.</b> {_esc(c['resolution'].get('note', ''))}</p>"
                if c.get("resolution", {}).get("note")
                else ""
            )
        )
    # "· 2 unavailable" is already the end of the counts line (#727).
    after = label_after_counts(status)
    label = f" · {_esc(after)}" if after else ""
    return (
        "<html><body>"
        f"<h1>SecretSource verification report</h1>"
        f"<p>{_esc(draft.get('title', ''))} · v{_esc(check.get('version', draft.get('version', 1)))}"
        f" · {_esc(when)}</p>"
        f"<p>{_esc(counts_line(status))}{label}</p>"
        + "".join(rows)
        + "</body></html>"
    )
