"""A draft's figures (SCRUM-463): the .png, .jpg, .svg and .pdf files its \\includegraphics
name, kept so the editor's preview can draw them.

The bytes live on disk, one folder per draft under DRAFT_IMAGES_DIR, each file named by its
content (<16 hex of sha256>.<ext>). The draft row lists them as {name, file, size}: `name` is
the path the LaTeX uses ("figures/posv.png"), `file` the stored file. They are not part of the
draft's `files`, so they never change its text hash or version, and a check never reads them.

Only the draft's owner reads them: the router loads the draft through its owner check first,
as for every other draft route.
"""

import hashlib
import os
import re
import shutil
import uuid
import zipfile
from pathlib import Path

from fastapi import HTTPException

from app.config import DRAFT_IMAGES_DIR

# What each kept extension is served as. EPS and GIF are left out: a browser cannot draw EPS,
# and pdflatex cannot include a GIF.
IMAGE_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "svg": "image/svg+xml",
    "pdf": "application/pdf",
}
MAX_IMAGE_FILE = 5 * 1024 * 1024  # one figure
MAX_DRAFT_IMAGES = 25 * 1024 * 1024  # all of one draft's figures together
MAX_IMAGES = 100

# Any name a LaTeX path can hold ("figure (1).png", "résumé.png"): the stored file is named by
# its hash, so the name never reaches the filesystem. Control characters, a backslash and the
# characters Windows refuses in a name are out, so the name survives an export and an unzip.
_NAME = re.compile(r'[^\x00-\x1f\x7f\\:*?"<>|]+\.(png|jpe?g|svg|pdf)', flags=re.I)
_DRAFT_ID = re.compile(r"[A-Za-z0-9_-]+")


def is_image_name(name: str) -> bool:
    return name.lower().endswith(tuple(f".{ext}" for ext in IMAGE_TYPES))


def safe_image_name(name: str) -> str:
    """A figure's path inside a draft: relative, no traversal, one of the kept extensions."""
    name = name.replace("\\", "/").strip().lstrip("/")
    while name.startswith("./"):
        name = name[2:]
    if not name or ".." in name.split("/") or "//" in name or not _NAME.fullmatch(name):
        raise HTTPException(400, "an image is a .png, .jpg, .svg or .pdf name, without ..")
    return name


def _extension(name: str) -> str:
    ext = name.rsplit(".", 1)[-1].lower()
    return "jpg" if ext == "jpeg" else ext


def looks_like(name: str, content: bytes) -> bool:
    """Whether the bytes are the kind of image the name says, by their first bytes."""
    ext = _extension(name)
    if ext == "png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if ext == "jpg":
        return content.startswith(b"\xff\xd8\xff")
    if ext == "pdf":
        return content.startswith(b"%PDF")
    head = content[:4096].lstrip(b"\xef\xbb\xbf").lstrip().lower()
    return b"\x00" not in head and head.startswith(b"<") and b"<svg" in head


def media_type(name: str) -> str:
    return IMAGE_TYPES[name.rsplit(".", 1)[-1].lower()]


def _folder(draft_id: str) -> Path:
    if not _DRAFT_ID.fullmatch(draft_id):
        raise HTTPException(400, "not a draft id")
    return DRAFT_IMAGES_DIR / draft_id


def stored_path(draft_id: str, image: dict) -> Path:
    return _folder(draft_id) / image["file"]


def view(images: list[dict]) -> list[dict]:
    """What the browser is told about a draft's figures: the path, the size, and the content
    hash, which tells the editor a figure was replaced under the same name."""
    return [{"name": i["name"], "size": i["size"], "hash": i["file"].split(".", 1)[0]} for i in images]


def add(draft: dict, uploads: list[tuple[str, bytes]], strict: bool = True) -> list[str]:
    """Stores each (name, bytes) for the draft and lists it on the row; a name it already has is
    replaced. With `strict`, a wrong file is refused (400/413) and nothing is added; without it
    (a zip's figures) a file that is not the image it says, is too big, or would go past the
    draft's caps is skipped. Answers the names left out. The caller holds the draft's lock and
    saves the row."""
    images = {i["name"]: i for i in draft.get("images", [])}
    skipped = []
    for name, content in uploads:
        try:
            name = safe_image_name(name)
            if len(content) > MAX_IMAGE_FILE:
                raise HTTPException(413, f"an image must be under {MAX_IMAGE_FILE // (1024 * 1024)}MB")
            if not looks_like(name, content):
                raise HTTPException(400, f"{name} is not a {_extension(name).upper()} image")
            others = [i for n, i in images.items() if n != name]
            if len(others) >= MAX_IMAGES:
                raise HTTPException(413, f"a draft keeps at most {MAX_IMAGES} images")
            if sum(i["size"] for i in others) + len(content) > MAX_DRAFT_IMAGES:
                raise HTTPException(
                    413, f"a draft's images must be under {MAX_DRAFT_IMAGES // (1024 * 1024)}MB together"
                )
        except HTTPException:
            if strict:
                raise
            skipped.append(name)
            continue
        stored = _write(draft["id"], content, _extension(name))
        images[name] = {"name": name, "file": stored, "size": len(content)}
    draft["images"] = sorted(images.values(), key=lambda i: i["name"])
    remove_unused(draft)
    return skipped


def _write(draft_id: str, content: bytes, ext: str) -> str:
    file = f"{hashlib.sha256(content).hexdigest()[:16]}.{ext}"
    path = _folder(draft_id) / file
    if not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        # Written aside, then renamed: a read never gets half a file.
        partial = path.with_name(f".{file}.{uuid.uuid4().hex}.part")
        partial.write_bytes(content)
        os.replace(partial, path)
    return file


def remove(draft: dict, name: str) -> None:
    """Takes one figure off the draft (404 when it has none of that name). The caller holds the
    draft's lock and saves the row."""
    images = draft.get("images", [])
    kept = [i for i in images if i["name"] != name]
    if len(kept) == len(images):
        raise HTTPException(404, "no such image")
    draft["images"] = kept
    remove_unused(draft)


def remove_unused(draft: dict) -> None:
    """Deletes the stored files the row no longer lists (a replaced or removed figure). Two
    names with the same bytes share one file, so a file goes only when no name uses it."""
    folder = _folder(draft["id"])
    if not folder.is_dir():
        return
    used = {i["file"] for i in draft.get("images", [])}
    for path in folder.iterdir():
        if path.name not in used and not path.name.startswith("."):
            path.unlink(missing_ok=True)


def delete_all(draft_id: str) -> None:
    """Every stored figure of a deleted draft."""
    shutil.rmtree(_folder(draft_id), ignore_errors=True)


def from_zip(archive: zipfile.ZipFile, infos: list[zipfile.ZipInfo]) -> list[tuple[str, bytes]]:
    """The figures among a zip's entries, as (path, bytes). An entry over the per-file cap is
    not read, nor one past the draft's caps, so a large export never sits in memory whole:
    ZipExtFile stops at the declared size, so a forged size cannot read more either."""
    found = []
    total = 0
    for info in infos:
        name = info.filename.replace("\\", "/")
        if info.is_dir() or not is_image_name(name) or info.file_size > MAX_IMAGE_FILE:
            continue
        if name.startswith("__MACOSX/") or ".." in name.split("/"):
            continue
        if len(found) >= MAX_IMAGES or total + info.file_size > MAX_DRAFT_IMAGES:
            continue
        try:
            with archive.open(info) as entry:
                content = entry.read(MAX_IMAGE_FILE + 1)
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError):
            # A bad CRC, an encrypted entry, a compression zipfile cannot read: left out, like
            # a file that is not the image it says, not a failed upload.
            continue
        total += len(content)
        found.append((name, content))
    return found
