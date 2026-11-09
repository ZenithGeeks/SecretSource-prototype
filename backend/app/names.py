"""Surnames from author names, split by BibTeX's name rules (bibtexparser).

GROBID, Crossref, OpenAlex and .bib files write names as "Omar Khattab", "Khattab, Omar" or
"Laurens van der Maaten"; BibTeX's rules read all three.
"""

from bibtexparser.middlewares.names import InvalidNameError, parse_single_name_into_parts

# BibTeX reads "John Smith Jr." as surname "Jr."; it wants "Smith, Jr., John".
NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def surname(name: str) -> str:
    """Return the surname with its particle: "van der Maaten" from "Laurens van der Maaten"."""
    name = name.strip()
    if not name:
        return ""
    try:
        parts = parse_single_name_into_parts(name)
    except InvalidNameError:  # "Smith, " or three commas: keep the last word
        return name.rstrip(", ").split()[-1] if name.rstrip(", ") else ""
    last = parts.last
    if last[-1].strip(".").lower() in NAME_SUFFIXES:
        # "Vincent van Gogh III" puts the suffix after the surname; "John Smith Jr." leaves
        # the surname as the last first name.
        last = last[:-1] or parts.first[-1:] or last
    return " ".join(parts.von + last)
