#!/usr/bin/env python3
"""
Update data/publications.bib from Scopus.

This version accepts --skip-abstract-retrieval and avoids noisy optional
Abstract Retrieval warnings. It gets publications from Scopus Search and can
optionally use Crossref as a fallback source for full author lists.
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
SCOPUS_ABSTRACT_EID_URL = "https://api.elsevier.com/content/abstract/eid/{eid}"
CROSSREF_WORKS_URL = "https://api.crossref.org/works/{doi}"

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


def normalize_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_key_text(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def clean_title(title: str) -> str:
    return normalize_space(title).rstrip(" .")


def first_value(entry: Dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = normalize_space(entry.get(key))
        if value:
            return value
    return ""


def scopus_headers(api_key: str, inst_token: Optional[str] = None) -> Dict[str, str]:
    headers = {
        "Accept": "application/json",
        "X-ELS-APIKey": api_key,
    }
    if inst_token:
        headers["X-ELS-Insttoken"] = inst_token
    return headers


def build_query(author: Dict[str, Any]) -> str:
    scopus_id = normalize_space(author.get("scopus_author_id"))
    if scopus_id:
        ids = [item.strip() for item in re.split(r"[,;\s]+", scopus_id) if item.strip()]
        return " OR ".join(f"AU-ID({item})" for item in ids)

    explicit = normalize_space(author.get("search_query"))
    if explicit:
        return explicit

    name = normalize_space(author.get("name"))
    parts = name.split()
    if len(parts) < 2:
        raise ValueError(
            f"Author {name!r} has no scopus_author_id and no search_query. "
            "Add one in scripts/scopus_authors.json."
        )

    first = parts[0]
    last = parts[-1]
    affiliation = normalize_space(author.get("affiliation_filter", "Florence"))
    if affiliation:
        return f"AUTHLASTNAME({last}) AND AUTHFIRST({first}) AND AFFIL({affiliation})"
    return f"AUTHLASTNAME({last}) AND AUTHFIRST({first})"


def request_json(
    session: requests.Session,
    url: str,
    params: Optional[Dict[str, Any]] = None,
    retries: int = 3,
    fail_soft: bool = False,
    quiet_optional: bool = False,
) -> Optional[Dict[str, Any]]:
    for attempt in range(1, retries + 1):
        response = session.get(url, params=params or {}, timeout=45)

        if response.status_code in {429, 500, 502, 503, 504} and attempt < retries:
            wait_seconds = 2 * attempt
            print(f"Scopus returned {response.status_code}; retrying in {wait_seconds}s...", file=sys.stderr)
            time.sleep(wait_seconds)
            continue

        if not response.ok:
            detail = response.text[:800].replace("\n", " ")
            if fail_soft:
                if not quiet_optional:
                    print(f"Warning: optional request failed: HTTP {response.status_code}: {detail}", file=sys.stderr)
                return None
            raise ScopusError(f"Scopus request failed: HTTP {response.status_code}: {detail}")

        try:
            return response.json()
        except ValueError as exc:
            if fail_soft:
                if not quiet_optional:
                    print("Warning: optional request returned non-JSON content", file=sys.stderr)
                return None
            raise ScopusError("Scopus returned non-JSON content") from exc

    if fail_soft:
        return None
    raise ScopusError("Scopus request failed after retries")


def fetch_entries_for_author(
    session: requests.Session,
    query: str,
    max_results: int = DEFAULT_MAX_RESULTS_PER_AUTHOR,
    view: str = "STANDARD",
) -> List[Dict[str, Any]]:
    def fetch_with_view(selected_view: str) -> List[Dict[str, Any]]:
        entries: List[Dict[str, Any]] = []
        start = 0
        total: Optional[int] = None

        while start < max_results:
            params = {
                "query": query,
                "start": start,
                "count": min(DEFAULT_COUNT, max_results - start),
                "view": selected_view,
                "sort": "-coverDate",
            }
            payload = request_json(session, SCOPUS_SEARCH_URL, params)
            results = (payload or {}).get("search-results", {})

            if total is None:
                try:
                    total = int(results.get("opensearch:totalResults", "0"))
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

    try:
        return fetch_with_view(view)
    except ScopusError as exc:
        message = str(exc)
        if view != "STANDARD" and (
            "View parameter entered is not valid" in message
            or "AUTHORIZATION_ERROR" in message
            or "not authorized" in message
        ):
            print(f"Scopus Search view {view!r} is unavailable; falling back to STANDARD.", file=sys.stderr)
            return fetch_with_view("STANDARD")
        raise


def as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def find_first_key(obj: Any, wanted_keys: Iterable[str]) -> Any:
    wanted = set(wanted_keys)
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in wanted:
                return value
        for value in obj.values():
            found = find_first_key(value, wanted)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = find_first_key(item, wanted)
            if found is not None:
                return found
    return None


def author_to_bibtex_name(author: Any) -> str:
    if isinstance(author, str):
        return normalize_space(author)

    if not isinstance(author, dict):
        return ""

    surname = normalize_space(author.get("surname") or author.get("ce:surname"))
    given = normalize_space(
        author.get("given-name")
        or author.get("ce:given-name")
        or author.get("initials")
        or author.get("ce:initials")
    )
    authname = normalize_space(
        author.get("authname")
        or author.get("ce:indexed-name")
        or author.get("indexed-name")
    )

    preferred = author.get("preferred-name")
    if isinstance(preferred, dict):
        preferred_surname = normalize_space(preferred.get("ce:surname") or preferred.get("surname"))
        preferred_given = normalize_space(preferred.get("ce:given-name") or preferred.get("given-name"))
        preferred_indexed = normalize_space(preferred.get("ce:indexed-name") or preferred.get("indexed-name"))
        if preferred_surname and preferred_given:
            return f"{preferred_surname}, {preferred_given}"
        if preferred_indexed:
            return preferred_indexed

    if surname and given:
        return f"{surname}, {given}"
    if authname:
        return authname

    return ""


def extract_authors_from_scopus_entry(entry: Dict[str, Any]) -> List[str]:
    authors = entry.get("author")
    names: List[str] = []

    if isinstance(authors, list):
        names = [author_to_bibtex_name(item) for item in authors]
    elif isinstance(authors, dict):
        names = [author_to_bibtex_name(authors)]

    names = [name for name in names if name]
    if names:
        return names

    creator = first_value(entry, "dc:creator")
    return [creator] if creator else []


def authors_from_abstract_payload(payload: Optional[Dict[str, Any]]) -> List[str]:
    if not payload:
        return []

    authors_obj = find_first_key(payload, {"author"})
    names: List[str] = []
    for item in as_list(authors_obj):
        name = author_to_bibtex_name(item)
        if name:
            names.append(name)

    # Deduplicate while preserving order.
    out: List[str] = []
    seen = set()
    for name in names:
        key = normalize_key_text(name)
        if key and key not in seen:
            seen.add(key)
            out.append(name)

    return out


def abstract_text_from_payload(payload: Optional[Dict[str, Any]]) -> str:
    if not payload:
        return ""

    coredata = find_first_key(payload, {"coredata"})
    if isinstance(coredata, dict):
        desc = first_value(coredata, "dc:description", "description")
        if desc:
            return desc

    for key in ["dc:description", "description", "abstract", "ce:para"]:
        value = find_first_key(payload, {key})
        if isinstance(value, str) and normalize_space(value):
            return normalize_space(value)
        if isinstance(value, list):
            text = " ".join(normalize_space(item) for item in value if isinstance(item, str))
            if text:
                return text
    return ""


def fetch_abstract_metadata(
    session: requests.Session,
    eid: str,
    abstract_view: str = "META_ABS",
) -> Tuple[List[str], str]:
    if not eid:
        return [], ""

    # Do not print one warning per paper: entitlement varies by Scopus account.
    variants: List[Dict[str, Any]] = []
    if abstract_view:
        variants.append({"view": abstract_view})
    for item in [{"view": "META_ABS"}, {"view": "FULL"}, {}]:
        if item not in variants:
            variants.append(item)

    for params in variants:
        payload = request_json(
            session,
            SCOPUS_ABSTRACT_EID_URL.format(eid=eid),
            params=params,
            fail_soft=True,
            quiet_optional=True,
        )
        if payload:
            authors = authors_from_abstract_payload(payload)
            abstract = abstract_text_from_payload(payload)
            if authors or abstract:
                return authors, abstract

    return [], ""


def crossref_author_to_name(author: Dict[str, Any]) -> str:
    family = normalize_space(author.get("family"))
    given = normalize_space(author.get("given"))
    name = normalize_space(author.get("name"))
    if family and given:
        return f"{family}, {given}"
    if family:
        return family
    return name


def fetch_crossref_authors(doi: str, mailto: str = "") -> List[str]:
    doi = normalize_space(doi)
    if not doi:
        return []

    headers = {"Accept": "application/json"}
    if mailto:
        headers["User-Agent"] = f"MAPLab publication updater (mailto:{mailto})"

    url = CROSSREF_WORKS_URL.format(doi=doi)
    try:
        response = requests.get(url, headers=headers, timeout=25)
        if not response.ok:
            return []
        payload = response.json()
    except Exception:
        return []

    message = payload.get("message", {})
    authors = message.get("author", [])
    if not isinstance(authors, list):
        return []

    names = [crossref_author_to_name(item) for item in authors if isinstance(item, dict)]
    return [name for name in names if name]


def parse_year(entry: Dict[str, Any]) -> str:
    cover_date = first_value(entry, "prism:coverDate", "prism:coverDisplayDate")
    match = re.search(r"(19|20)\d{2}", cover_date)
    if match:
        return match.group(0)
    return first_value(entry, "prism:coverDisplayDate") or "n.d."


def entry_type(entry: Dict[str, Any]) -> str:
    subtype = normalize_space(entry.get("subtypeDescription")).lower()
    aggregation = normalize_space(entry.get("prism:aggregationType")).lower()

    if "conference" in subtype or "conference" in aggregation:
        return "inproceedings"
    if "book chapter" in subtype or "book chapter" in aggregation:
        return "incollection"
    if "book" in subtype and "chapter" not in subtype:
        return "book"
    return "article"


def bib_escape(value: str) -> str:
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
        suffix = "" if count == 0 else chr(ord("a") + count - 1)
        output.append((typ, {**fields, "_key": f"{base}{suffix}"}))

    return output


def merge_entry(existing: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    # Keep the entry with more raw author metadata, while preserving source people.
    existing_sources = set(existing.get("_maplab_people", []))
    incoming_sources = set(incoming.get("_maplab_people", []))
    existing_slugs = set(existing.get("_maplab_slugs", []))
    incoming_slugs = set(incoming.get("_maplab_slugs", []))

    existing_author_count = len(extract_authors_from_scopus_entry(existing))
    incoming_author_count = len(extract_authors_from_scopus_entry(incoming))
    merged = incoming if incoming_author_count > existing_author_count else existing

    merged["_maplab_people"] = sorted(existing_sources | incoming_sources)
    merged["_maplab_slugs"] = sorted(existing_slugs | incoming_slugs)
    return merged


def scopus_entry_to_record(entry: Dict[str, Any]) -> Tuple[str, Dict[str, str]]:
    typ = entry_type(entry)
    title = clean_title(first_value(entry, "dc:title"))
    year = parse_year(entry)
    doi = first_value(entry, "prism:doi")
    url = doi_url(doi) or first_value(entry, "prism:url", "link")

    authors = entry.get("_enriched_authors") or extract_authors_from_scopus_entry(entry)
    author_field = " and ".join(authors) if authors else "Unknown"

    fields: Dict[str, str] = {
        "author": author_field,
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

    maplab_people = entry.get("_maplab_people") or []
    maplab_slugs = entry.get("_maplab_slugs") or []
    if maplab_people:
        fields["maplab_people"] = "; ".join(maplab_people)
    if maplab_slugs:
        fields["maplab_slugs"] = "; ".join(maplab_slugs)

    return typ, fields


def sort_records(records: List[Tuple[str, Dict[str, str]]]) -> List[Tuple[str, Dict[str, str]]]:
    def sort_key(item: Tuple[str, Dict[str, str]]) -> Tuple[int, str, str]:
        _typ, fields = item
        year_text = fields.get("year", "0")
        try:
            match = re.search(r"(19|20)\d{2}", year_text)
            year = int(match.group(0)) if match else 0
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
        "maplab_people",
        "maplab_slugs",
    ]

    for field in ordered:
        value = fields.get(field)
        if value:
            output.append(f"  {field} = {{{bib_escape(value)}}},")

    for field in sorted(fields):
        if field.startswith("_") or field in ordered:
            continue
        value = fields[field]
        if value:
            output.append(f"  {field} = {{{bib_escape(value)}}},")

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


def enrich_entries(
    session: requests.Session,
    entries: List[Dict[str, Any]],
    skip_abstract_retrieval: bool,
    abstract_view: str,
    crossref_mailto: str,
    sleep: float,
) -> None:
    total = len(entries)
    for index, entry in enumerate(entries, start=1):
        eid = first_value(entry, "eid")
        doi = first_value(entry, "prism:doi")

        print(f"Enriching authors {index}/{total}: {eid or doi or 'unknown'}")

        current_authors = extract_authors_from_scopus_entry(entry)
        enriched_authors: List[str] = []

        if not skip_abstract_retrieval and eid:
            enriched_authors, abstract = fetch_abstract_metadata(session, eid, abstract_view=abstract_view)
            if abstract:
                entry["_abstract"] = abstract

        if not enriched_authors and crossref_mailto and doi:
            enriched_authors = fetch_crossref_authors(doi, mailto=crossref_mailto)

        # Use enrichment only if it improves the author list.
        if len(enriched_authors) > len(current_authors):
            entry["_enriched_authors"] = enriched_authors

        time.sleep(min(sleep, 0.1))


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Update a shared BibTeX bibliography from Scopus.")
    parser.add_argument("--authors", default="scripts/scopus_authors.json", help="JSON config with authors")
    parser.add_argument("--output", default="data/publications.bib", help="Output BibTeX file")
    parser.add_argument("--max-results-per-author", type=int, default=DEFAULT_MAX_RESULTS_PER_AUTHOR)
    parser.add_argument("--view", default="STANDARD", choices=["STANDARD", "COMPLETE"], help="Scopus Search API view")
    parser.add_argument("--abstract-view", default="META_ABS", help="Scopus Abstract Retrieval view, used only if abstract retrieval is enabled")
    parser.add_argument("--skip-abstract-retrieval", action="store_true", help="Do not call Scopus Abstract Retrieval")
    parser.add_argument("--crossref-mailto", default="", help="Email for polite Crossref fallback requests")
    parser.add_argument("--sleep", type=float, default=0.25, help="Pause between author queries, in seconds")
    args = parser.parse_args(argv)

    api_key = normalize_space(os.environ.get("SCOPUS_API_KEY"))
    if not api_key:
        print("Missing SCOPUS_API_KEY. Add it as a GitHub repository secret or export it locally.", file=sys.stderr)
        return 2

    inst_token = normalize_space(os.environ.get("SCOPUS_INST_TOKEN")) or None
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
            entry = dict(entry)
            entry["_maplab_people"] = [author["name"]]
            if normalize_space(author.get("slug")):
                entry["_maplab_slugs"] = [normalize_space(author.get("slug"))]

            key = dedupe_id(entry)
            if key in deduped:
                deduped[key] = merge_entry(deduped[key], entry)
            else:
                deduped[key] = entry

        time.sleep(args.sleep)

    entries = list(deduped.values())
    print(f"Found {len(entries)} unique Scopus records before author enrichment")

    enrich_entries(
        session=session,
        entries=entries,
        skip_abstract_retrieval=args.skip_abstract_retrieval,
        abstract_view=args.abstract_view,
        crossref_mailto=args.crossref_mailto,
        sleep=args.sleep,
    )

    records = [scopus_entry_to_record(entry) for entry in entries]
    records = sort_records(records)
    records = make_unique_keys(records)
    write_bibtex(args.output, records, authors)

    print(f"Wrote {len(records)} unique BibTeX entries to {args.output}")
    for name, count in source_counts.items():
        print(f"  {name}: {count} Scopus records before deduplication")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
