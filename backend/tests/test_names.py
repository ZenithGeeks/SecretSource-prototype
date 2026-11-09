"""Surnames follow BibTeX's name rules, whichever way the name is written."""

import pytest
from app.names import surname


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Omar Khattab", "Khattab"),
        ("Khattab, Omar", "Khattab"),
        ("Laurens van der Maaten", "van der Maaten"),
        ("Smith, Jr., John", "Smith"),
        ("John Smith Jr.", "Smith"),
        ("Wen-tau Yih", "Yih"),
        ("{OpenAI}", "{OpenAI}"),
        ("Smith, ", "Smith"),
        ("", ""),
    ],
)
def test_surname(name, expected):
    assert surname(name) == expected
