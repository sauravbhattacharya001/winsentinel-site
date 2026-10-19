#!/usr/bin/env python3
"""Shared inventory of public WinSentinel site pages.

A page is public when it is a complete HTML document in the repository and is
not a private template/partial (a filename beginning with ``_``). Keeping this
in one module prevents the SEO checker and sitemap generator from silently
using different hand-maintained page lists.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXCLUDED_DIRECTORIES = {"components", "node_modules", ".git"}


def discover_public_pages(root: Path = ROOT) -> list[Path]:
    """Return every public HTML document below ``root`` in stable order."""
    pages: list[Path] = []
    for path in root.rglob("*.html"):
        relative = path.relative_to(root)
        if path.name.startswith("_"):
            continue
        if any(part in EXCLUDED_DIRECTORIES or part.startswith(".") for part in relative.parts[:-1]):
            continue
        pages.append(path)
    return sorted(pages, key=lambda page: page.relative_to(root).as_posix())
