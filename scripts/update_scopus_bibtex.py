#!/usr/bin/env python3
"""
Update data/publications.bib from Elsevier Scopus.

Expected secrets/environment variables:
  SCOPUS_API_KEY      required
  SCOPUS_INST_TOKEN   optional, only if your institution provides one

Typical use:
  python scripts/update_scopus_bibtex.py \
    --authors scripts/scopus_authors.json \
    --output data/publications.bib
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
from collections import OrderedDict
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

SCOPUS_SEARCH_URL = "https://api.elsevier.com/content/search/scopus"
DEFAULT_COUNT = 25
DEFAULT_MAX_RESULTS_PER_AUTHOR = 500


class ScopusError(RuntimeError):
    pass


def load_authors(path: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError(f"{path} must contain a JSON list of authors")
    for author in data:
        if "name" not in author:
            raise ValueError(f"Each author in {path} needs a 'name' field")
    return data


def scopus_headers(api_key: str, inst_token: Optional[str] = None) -> Dict[str, str]:
    headers = {
        "Accept": "application/json",
        "X-ELS-APIKey": api_key,
    }
    if inst_token:
        headers["X-ELS-Insttoken"] = inst_token
    return headers


def build_query(author: Dict[str, Any]) -> str:
    """Prefer Scopus Author ID; fall back to explicit query or author-name query."""
    scopus_id = str(author.get("scopus_author_id", "")).strip()
    if scopus_id:
        ids = [item.strip() for item in re.split(r"[,;\s]+", scopus_id) if item.strip()]
        return " OR ".join(f"AU-ID({item})" for item in ids)

    explicit = str(author.get("search_query", "")).strip()
    if explicit:
        return explicit

    name = author["name"].strip()
    parts = name.split()
    if len(parts) < 2:
        raise ValueError(
            f"Author {name!r} has no scopus_author_id and no search_query. "
            "Add one in scripts/scopus_authors.json."
        )
    first = parts[0]
    last = parts[-1]
    affiliation = str(author.get("affiliation_filter", "Florence")).strip()
    if affiliation:
        return f"AUTHLASTNAME({last}) AND AUTHFIRST({first}) AND AFFIL({affiliation})"
    return f"AUTHLASTNAME({last}) AND AUTHFIRST({first})"


def request_json(session: requests.Session, url: str, params: Dict[str, Any], retries: int = 3) -> Dict[str, Any]:
    for attempt in range(1, retries + 1):
        response = session.get(url, params=params, timeout=40)
        if response.status_code in {429, 500, 502, 503, 504} and attempt < retries:
            wait_seconds = 2 * attempt
            print(f"Scopus returned {response.status_code}; retrying in {wait_seconds}s...", file=sys.stderr)
            time.sleep(wait_seconds)
            continue

        if not response.ok:
            detail = response.text[:1000].replace("\n", " ")
            raise ScopusError(f"Scopus request failed: HTTP {response.status_code}: {detail}")

        try:
            return response.json()
        except ValueError as exc:
            raise ScopusError("Scopus returned non-JSON content") from exc

    raise ScopusError("Scopus request failed after retries")


def fetch_entries_for_author(
    session: requests.Session,
    query: str,
    max_results: int = DEFAULT_MAX_RESULTS_PER_AUTHOR,
    view: str = "STANDARD",
) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    start = 0
    count = DEFAULT_COUNT
    total: Optional[int] = None

    while start < max_results:
        params = {
            "query": query,
            "start": start,
            "count": min(count, max_results - start),
            "view": view,
            "sort": "-coverDate",
        }
        payload = request_json(session, SCOPUS_SEARCH_URL, params)
        results = payload.get("search-results", {})

        if total is None:
            total_text = results.get("opensearch:totalResults", "0")
            try:
                total = int(total_text)
            except (TypeError, ValueError):
                total = 0

        page_entries = [entry for entry in results.get("entry", []) if "error" not in entry]
        entries.extend(page_entries)

        if not page_entries:
            break

        start += len(page_entries)
        if total is not None and start >= total:
            break

    return entries


def normalize_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_key_text(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def clean_title(title: str) -> str:
    title = normalize_space(title)
    # Scopus sometimes returns trailing punctuation in titles.
    return title.rstrip(" .")


def first_value(entry: Dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = normalize_space(entry.get(key))
        if value:
            return value
    return ""


def parse_year(entry: Dict[str, Any]) -> str:
    cover_date = first_value(entry, "prism:coverDate", "prism:coverDisplayDate")
    match = re.search(r"(19|20)\d{2}", cover_date)
    if match:
        return match.group(0)
    return first_value(entry, "prism:coverDisplayDate") or "n.d."


def author_to_bibtex_name(author: Dict[str, Any]) -> str:
    surname = normalize_space(author.get("surname"))
    given = normalize_space(author.get("given-name") or author.get("initials"))
    authname = normalize_space(author.get("authname") or author.get("ce:indexed-name"))

    if surname and given:
        return f"{surname}, {given}"
    if authname:
        # Typical Scopus authname is "Surname, Initials"; keep it as valid BibTeX.
        return authname
    return normalize_space(author)


def extract_authors(entry: Dict[str, Any]) -> str:
    authors = entry.get("author")
    if isinstance(authors, list) and authors:
        names = [author_to_bibtex_name(item) for item in authors if isinstance(item, dict)]
        names = [name for name in names if name]
        if names:
            return " and ".join(names)

    creator = first_value(entry, "dc:creator")
    if creator:
        return creator
    return "Unknown"


def entry_type(entry: Dict[str, Any]) -> str:
    subtype = normalize_space(entry.get("subtypeDescription")).lower()
    aggregation = normalize_space(entry.get("prism:aggregationType")).lower()

    if "conference" in subtype or "conference" in aggregation:
        return "inproceedings"
    if "book chapter" in subtype or "book" in aggregation:
        return "incollection"
    if "book" in subtype:
        return "book"
    return "article"


def bib_escape(value: str) -> str:
    """Escape characters that commonly break BibTeX while keeping UTF-8 text readable."""
    value = normalize_space(value)
    replacements = OrderedDict(
        [
            ("\\", r"\textbackslash{}"),
            ("&", r"\&"),
            ("%", r"\%"),
            ("$", r"\$"),
            ("#", r"\#"),
            ("_", r"\_"),
            ("{", r"\{"),
            ("}", r"\}"),
            ("~", r"\textasciitilde{}"),
            ("^", r"\textasciicircum{}"),
        ]
    )
    for old, new in replacements.items():
        value = value.replace(old, new)
    return value


def doi_url(doi: str) -> str:
    doi = doi.strip()
    if not doi:
        return ""
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi, flags=re.I)
    return f"https://doi.org/{doi}"


def dedupe_id(entry: Dict[str, Any]) -> str:
    doi = first_value(entry, "prism:doi").lower()
    if doi:
        doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi, flags=re.I)
        return f"doi:{doi}"

    eid = first_value(entry, "eid")
    if eid:
        return f"eid:{eid}"

    scopus_id = first_value(entry, "dc:identifier")
    if scopus_id:
        return f"scopus:{scopus_id}"

    title = normalize_key_text(first_value(entry, "dc:title"))
    year = parse_year(entry)
    return f"title:{year}:{title}"


def first_author_last_name(author_field: str) -> str:
    first_author = re.split(r"\s+and\s+", author_field, maxsplit=1)[0].strip()
    if "," in first_author:
        return first_author.split(",", 1)[0].strip()
    parts = first_author.split()
    return parts[-1] if parts else "publication"


def make_base_key(fields: Dict[str, str]) -> str:
    last = normalize_key_text(first_author_last_name(fields.get("author", "publication"))).replace(" ", "")
    year = re.sub(r"[^0-9]", "", fields.get("year", "")) or "nd"
    title_words = [w for w in normalize_key_text(fields.get("title", "publication")).split() if len(w) > 2]
    title_part = "".join(word[:12] for word in title_words[:3]) or "publication"
    key = f"{last}{year}{title_part}"
    key = re.sub(r"[^A-Za-z0-9_:-]", "", key)
    return key[:80] or "publication"


def make_unique_keys(records: List[Tuple[str, Dict[str, str]]]) -> List[Tuple[str, Dict[str, str]]]:
    used: Dict[str, int] = {}
    output: List[Tuple[str, Dict[str, str]]] = []
    for typ, fields in records:
        base = make_base_key(fields)
        count = used.get(base, 0)
        used[base] = count + 1
        key = base if count == 0 else f"{base}{chr(ord('a') + count - 1)}"
        output.append((typ, {**fields, "_key": key}))
    return output


def scopus_entry_to_record(entry: Dict[str, Any]) -> Tuple[str, Dict[str, str]]:
    typ = entry_type(entry)
    title = clean_title(first_value(entry, "dc:title"))
    year = parse_year(entry)
    doi = first_value(entry, "prism:doi")
    url = doi_url(doi) or first_value(entry, "prism:url", "link")

    fields: Dict[str, str] = {
        "author": extract_authors(entry),
        "title": title,
        "year": year,
    }

    publication_name = first_value(entry, "prism:publicationName")
    if typ in {"inproceedings", "incollection"}:
        if publication_name:
            fields["booktitle"] = publication_name
    else:
        if publication_name:
            fields["journal"] = publication_name

    optional_map = {
        "volume": "prism:volume",
        "number": "prism:issueIdentifier",
        "pages": "prism:pageRange",
        "doi": "prism:doi",
        "issn": "prism:issn",
        "isbn": "prism:isbn",
        "scopus_eid": "eid",
        "scopus_id": "dc:identifier",
    }
    for bib_key, scopus_key in optional_map.items():
        value = first_value(entry, scopus_key)
        if value:
            fields[bib_key] = value

    if url:
        fields["url"] = url

    subtype = first_value(entry, "subtypeDescription")
    if subtype:
        fields["note"] = f"Scopus: {subtype}"

    return typ, fields


def sort_records(records: List[Tuple[str, Dict[str, str]]]) -> List[Tuple[str, Dict[str, str]]]:
    def sort_key(item: Tuple[str, Dict[str, str]]) -> Tuple[int, str, str]:
        _typ, fields = item
        year_text = fields.get("year", "0")
        try:
            year = int(re.search(r"(19|20)\d{2}", year_text).group(0))  # type: ignore[union-attr]
        except Exception:
            year = 0
        return (-year, normalize_key_text(fields.get("author", "")), normalize_key_text(fields.get("title", "")))

    return sorted(records, key=sort_key)


def bibtex_record(typ: str, fields: Dict[str, str]) -> str:
    key = fields["_key"]
    output = [f"@{typ}{{{key},"]
    ordered = [
        "author",
        "title",
        "journal",
        "booktitle",
        "year",
        "volume",
        "number",
        "pages",
        "doi",
        "url",
        "issn",
        "isbn",
        "note",
        "scopus_eid",
        "scopus_id",
    ]
    for field in ordered:
        value = fields.get(field)
        if value:
            output.append(f"  {field} = {{{bib_escape(value)}}},")

    # Include any extra fields not listed above, except internal fields.
    for field in sorted(fields):
        if field.startswith("_") or field in ordered:
            continue
        value = fields[field]
        if value:
            output.append(f"  {field} = {{{bib_escape(value)}}},")

    # Remove trailing comma on last field for tidy BibTeX.
    if len(output) > 1 and output[-1].endswith(","):
        output[-1] = output[-1][:-1]
    output.append("}")
    return "\n".join(output)


def write_bibtex(path: str, records: List[Tuple[str, Dict[str, str]]], source_authors: Iterable[Dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    author_names = ", ".join(author["name"] for author in source_authors)
    header = [
        "% This file is generated automatically from Scopus.",
        "% Do not edit it by hand unless you disable the GitHub Action.",
        f"% Last generated: {timestamp}",
        f"% Authors: {author_names}",
        "",
    ]
    body = "\n\n".join(bibtex_record(typ, fields) for typ, fields in records)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(header))
        if body:
            handle.write(body)
            handle.write("\n")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Update a shared BibTeX bibliography from Scopus.")
    parser.add_argument("--authors", default="scripts/scopus_authors.json", help="JSON config with authors")
    parser.add_argument("--output", default="data/publications.bib", help="Output BibTeX file")
    parser.add_argument("--max-results-per-author", type=int, default=DEFAULT_MAX_RESULTS_PER_AUTHOR)
    parser.add_argument("--view", default="STANDARD", choices=["STANDARD", "COMPLETE"], help="Scopus Search API view")
    parser.add_argument("--sleep", type=float, default=0.25, help="Pause between author queries, in seconds")
    args = parser.parse_args(argv)

    api_key = os.environ.get("SCOPUS_API_KEY", "").strip()
    if not api_key:
        print(
            "Missing SCOPUS_API_KEY. Add it as a GitHub repository secret or export it locally.",
            file=sys.stderr,
        )
        return 2

    inst_token = os.environ.get("SCOPUS_INST_TOKEN", "").strip() or None
    authors = load_authors(args.authors)

    session = requests.Session()
    session.headers.update(scopus_headers(api_key, inst_token))

    deduped: OrderedDict[str, Dict[str, Any]] = OrderedDict()
    source_counts: Dict[str, int] = {}

    for author in authors:
        query = build_query(author)
        print(f"Fetching Scopus publications for {author['name']}: {query}")
        entries = fetch_entries_for_author(
            session=session,
            query=query,
            max_results=args.max_results_per_author,
            view=args.view,
        )
        source_counts[author["name"]] = len(entries)
        for entry in entries:
            key = dedupe_id(entry)
            if key not in deduped:
                deduped[key] = entry
        time.sleep(args.sleep)

    records = [scopus_entry_to_record(entry) for entry in deduped.values()]
    records = sort_records(records)
    records = make_unique_keys(records)
    write_bibtex(args.output, records, authors)

    print(f"Wrote {len(records)} unique BibTeX entries to {args.output}")
    for name, count in source_counts.items():
        print(f"  {name}: {count} Scopus records before deduplication")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
