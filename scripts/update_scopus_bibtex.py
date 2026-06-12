#!/usr/bin/env python3
"""
Update data/publications.bib from Scopus and save complete author lists.

Important details:
- The Scopus Search API is used to find papers for each configured author.
- Each record is deduplicated by DOI/EID/Scopus ID.
- Full author lists are recovered from Crossref by DOI and/or Scopus Abstract
  Retrieval by EID. This avoids the common Scopus Search issue where dc:creator
  contains only the first author.
- A maplab_people field is written so the website can reliably show papers on
  personal pages even when the MAPLab person is not first author.

Expected environment variables:
  SCOPUS_API_KEY       required
  SCOPUS_INST_TOKEN    optional

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
import urllib.parse
from collections import OrderedDict
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

import requests

SCOPUS_SEARCH_URL = "https://api.elsevier.com/content/search/scopus"
SCOPUS_ABSTRACT_EID_URL = "https://api.elsevier.com/content/abstract/eid/{eid}"
SCOPUS_ABSTRACT_SCOPUS_ID_URL = "https://api.elsevier.com/content/abstract/scopus_id/{scopus_id}"
CROSSREF_WORKS_URL = "https://api.crossref.org/works/{doi}"

DEFAULT_COUNT = 25
DEFAULT_MAX_RESULTS_PER_AUTHOR = 500


class ScopusError(RuntimeError):
    pass


def normalize_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def listify(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def get_nested(obj: Any, *keys: str) -> Any:
    current = obj
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def load_authors(path: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError(f"{path} must contain a JSON list of authors")
    for author in data:
        if not isinstance(author, dict) or "name" not in author:
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
        if len(ids) == 1:
            return f"AU-ID({ids[0]})"
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


def request_json(
    session: requests.Session,
    url: str,
    params: Optional[Dict[str, Any]] = None,
    retries: int = 3,
    warn_only: bool = False,
) -> Optional[Dict[str, Any]]:
    for attempt in range(1, retries + 1):
        try:
            response = session.get(url, params=params or {}, timeout=45)
        except requests.RequestException as exc:
            if attempt < retries:
                time.sleep(2 * attempt)
                continue
            if warn_only:
                print(f"Warning: request failed for {url}: {exc}", file=sys.stderr)
                return None
            raise ScopusError(f"Request failed for {url}: {exc}") from exc

        if response.status_code in {429, 500, 502, 503, 504} and attempt < retries:
            wait_seconds = 2 * attempt
            print(f"API returned {response.status_code}; retrying in {wait_seconds}s...", file=sys.stderr)
            time.sleep(wait_seconds)
            continue

        if not response.ok:
            detail = response.text[:1000].replace("\n", " ")
            if warn_only:
                print(f"Warning: request failed: HTTP {response.status_code}: {detail}", file=sys.stderr)
                return None
            raise ScopusError(f"Request failed: HTTP {response.status_code}: {detail}")

        try:
            payload = response.json()
        except ValueError:
            if warn_only:
                print(f"Warning: non-JSON response from {url}", file=sys.stderr)
                return None
            raise ScopusError(f"Non-JSON response from {url}")
        return payload

    if warn_only:
        return None
    raise ScopusError("Request failed after retries")


def first_value(entry: Dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = entry.get(key)
        if isinstance(value, list):
            if value:
                value = value[0]
            else:
                value = ""
        if isinstance(value, dict):
            # Common link shape from Scopus Search API.
            value = value.get("@href") or value.get("$") or ""
        value = normalize_space(value)
        if value:
            return value
    return ""


def fetch_entries_for_author(
    session: requests.Session,
    query: str,
    max_results: int = DEFAULT_MAX_RESULTS_PER_AUTHOR,
    view: str = "STANDARD",
) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    start = 0
    total: Optional[int] = None

    while start < max_results:
        params = {
            "query": query,
            "start": start,
            "count": min(DEFAULT_COUNT, max_results - start),
            "view": view,
            "sort": "-coverDate",
        }
        try:
            payload = request_json(session, SCOPUS_SEARCH_URL, params)
        except ScopusError as exc:
            # Some Scopus API keys are valid for STANDARD view only.
            # If COMPLETE is not authorized, fall back instead of failing the whole workflow.
            if view != "STANDARD" and ("AUTHORIZATION_ERROR" in str(exc) or "not authorized" in str(exc).lower()):
                print("Warning: Scopus Search COMPLETE view is not authorized; retrying with STANDARD view.", file=sys.stderr)
                params["view"] = "STANDARD"
                payload = request_json(session, SCOPUS_SEARCH_URL, params)
            else:
                raise
        assert payload is not None
        results = payload.get("search-results", {})

        if total is None:
            total_text = results.get("opensearch:totalResults", "0")
            try:
                total = int(total_text)
            except (TypeError, ValueError):
                total = 0

        page_entries = [entry for entry in results.get("entry", []) if isinstance(entry, dict) and "error" not in entry]
        entries.extend(page_entries)

        if not page_entries:
            break
        start += len(page_entries)
        if total is not None and start >= total:
            break

    return entries


def normalize_key_text(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def clean_title(title: str) -> str:
    title = normalize_space(title)
    return title.rstrip(" .")


def parse_year(entry: Dict[str, Any]) -> str:
    cover_date = first_value(entry, "prism:coverDate", "prism:coverDisplayDate", "coverDate", "published-print", "published-online")
    match = re.search(r"(19|20)\d{2}", cover_date)
    if match:
        return match.group(0)
    return first_value(entry, "year", "prism:coverDisplayDate") or "n.d."


def doi_url(doi: str) -> str:
    doi = doi.strip()
    if not doi:
        return ""
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi, flags=re.I)
    return f"https://doi.org/{doi}"


def normalize_doi(doi: str) -> str:
    doi = normalize_space(doi)
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi, flags=re.I)
    return doi.strip()


def scopus_identifier_from_entry(entry: Dict[str, Any]) -> str:
    raw = first_value(entry, "dc:identifier", "prism:url")
    match = re.search(r"SCOPUS_ID:([0-9]+)", raw)
    if match:
        return match.group(1)
    match = re.search(r"/([0-9]{6,})$", raw)
    if match:
        return match.group(1)
    return ""


def dedupe_id(entry: Dict[str, Any]) -> str:
    doi = normalize_doi(first_value(entry, "prism:doi", "doi")).lower()
    if doi:
        return f"doi:{doi}"

    eid = first_value(entry, "eid")
    if eid:
        return f"eid:{eid}"

    scopus_id = first_value(entry, "dc:identifier")
    if scopus_id:
        return f"scopus:{scopus_id}"

    title = normalize_key_text(first_value(entry, "dc:title", "title"))
    year = parse_year(entry)
    return f"title:{year}:{title}"


def author_to_bibtex_name(author: Dict[str, Any]) -> str:
    # Crossref shape.
    family = normalize_space(author.get("family"))
    given = normalize_space(author.get("given"))
    if family and given:
        return f"{family}, {given}"
    if family:
        return family
    if normalize_space(author.get("name")):
        return normalize_space(author.get("name"))

    # Scopus Abstract/Search shapes.
    preferred = author.get("preferred-name")
    if isinstance(preferred, dict):
        surname = normalize_space(preferred.get("ce:surname") or preferred.get("surname"))
        given_name = normalize_space(preferred.get("ce:given-name") or preferred.get("given-name"))
        indexed = normalize_space(preferred.get("ce:indexed-name") or preferred.get("indexed-name"))
        initials = normalize_space(preferred.get("ce:initials") or preferred.get("initials"))
        if surname and given_name:
            return f"{surname}, {given_name}"
        if surname and initials:
            return f"{surname}, {initials}"
        if indexed:
            return indexed

    surname = normalize_space(
        author.get("surname")
        or author.get("ce:surname")
        or author.get("authlast")
        or author.get("authlastname")
    )
    given_name = normalize_space(
        author.get("given-name")
        or author.get("ce:given-name")
        or author.get("given")
        or author.get("forename")
        or author.get("ce:initials")
        or author.get("initials")
    )
    indexed = normalize_space(
        author.get("authname")
        or author.get("ce:indexed-name")
        or author.get("indexed-name")
    )

    if surname and given_name:
        return f"{surname}, {given_name}"
    if indexed:
        return indexed
    if surname:
        return surname
    return ""


def ordered_unique_names(names: Sequence[str]) -> List[str]:
    seen: Set[str] = set()
    output: List[str] = []
    for name in names:
        name = normalize_space(name)
        if not name:
            continue
        key = normalize_key_text(name)
        if key and key not in seen:
            seen.add(key)
            output.append(name)
    return output


def names_to_bibtex(names: Sequence[str]) -> str:
    return " and ".join(ordered_unique_names(names))


def extract_search_authors(entry: Dict[str, Any]) -> List[str]:
    authors = entry.get("author")
    names: List[str] = []
    for author in listify(authors):
        if isinstance(author, dict):
            name = author_to_bibtex_name(author)
            if name:
                names.append(name)
    return ordered_unique_names(names)


def extract_authors_from_author_group(author_group: Any) -> List[str]:
    names: List[str] = []
    for group in listify(author_group):
        if not isinstance(group, dict):
            continue
        authors = group.get("author")
        for author in listify(authors):
            if isinstance(author, dict):
                name = author_to_bibtex_name(author)
                if name:
                    names.append(name)
    return ordered_unique_names(names)


def extract_abstract_response(payload: Dict[str, Any]) -> Dict[str, Any]:
    response = payload.get("abstracts-retrieval-response")
    if isinstance(response, dict):
        return response
    return payload


def extract_abstract_authors(payload: Dict[str, Any]) -> List[str]:
    response = extract_abstract_response(payload)
    names: List[str] = []

    # Common JSON shape: abstracts-retrieval-response.authors.author[]
    authors = get_nested(response, "authors", "author")
    for author in listify(authors):
        if isinstance(author, dict):
            name = author_to_bibtex_name(author)
            if name:
                names.append(name)

    # Bibliographic record shape.
    if len(ordered_unique_names(names)) <= 1:
        author_group = get_nested(response, "item", "bibrecord", "head", "author-group")
        names.extend(extract_authors_from_author_group(author_group))

    # Alternative nested shapes occasionally seen in Abstract Retrieval payloads.
    if len(ordered_unique_names(names)) <= 1:
        author_group = get_nested(response, "bibrecord", "head", "author-group")
        names.extend(extract_authors_from_author_group(author_group))

    return ordered_unique_names(names)


def extract_coredata_from_abstract(payload: Dict[str, Any]) -> Dict[str, Any]:
    response = extract_abstract_response(payload)
    coredata = response.get("coredata") if isinstance(response.get("coredata"), dict) else {}
    result: Dict[str, Any] = {}
    for key, value in coredata.items():
        if value not in (None, ""):
            result[key] = value
    return result


def fetch_scopus_abstract_authors(session: requests.Session, entry: Dict[str, Any], abstract_view: str = "STANDARD") -> Tuple[List[str], Dict[str, Any]]:
    eid = first_value(entry, "eid")
    scopus_id = scopus_identifier_from_entry(entry)

    if eid:
        url = SCOPUS_ABSTRACT_EID_URL.format(eid=eid)
    elif scopus_id:
        url = SCOPUS_ABSTRACT_SCOPUS_ID_URL.format(scopus_id=scopus_id)
    else:
        return [], {}

    payload = request_json(session, url, params={"view": abstract_view}, retries=2, warn_only=True)
    if not payload:
        return [], {}
    return extract_abstract_authors(payload), extract_coredata_from_abstract(payload)


def fetch_crossref_authors(doi: str, mailto: str = "") -> Tuple[List[str], Dict[str, Any]]:
    doi = normalize_doi(doi)
    if not doi:
        return [], {}

    session = requests.Session()
    headers = {"Accept": "application/json", "User-Agent": "maplab-publications-updater/1.0"}
    if mailto:
        headers["User-Agent"] += f" (mailto:{mailto})"
    session.headers.update(headers)

    url = CROSSREF_WORKS_URL.format(doi=urllib.parse.quote(doi, safe=""))
    payload = request_json(session, url, retries=2, warn_only=True)
    if not payload:
        return [], {}
    message = payload.get("message", {}) if isinstance(payload.get("message"), dict) else {}

    authors = []
    for item in listify(message.get("author")):
        if isinstance(item, dict):
            name = author_to_bibtex_name(item)
            if name:
                authors.append(name)

    metadata: Dict[str, Any] = {}
    # Do not overwrite Scopus metadata unless Scopus is missing it.
    if isinstance(message.get("title"), list) and message["title"]:
        metadata["dc:title"] = message["title"][0]
    if isinstance(message.get("container-title"), list) and message["container-title"]:
        metadata["prism:publicationName"] = message["container-title"][0]
    if message.get("volume"):
        metadata["prism:volume"] = message["volume"]
    if message.get("issue"):
        metadata["prism:issueIdentifier"] = message["issue"]
    if message.get("page"):
        metadata["prism:pageRange"] = message["page"]
    if message.get("DOI"):
        metadata["prism:doi"] = message["DOI"]
    if message.get("URL"):
        metadata["prism:url"] = message["URL"]

    return ordered_unique_names(authors), metadata


def merge_entry_metadata(base: Dict[str, Any], extra: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base)
    for key, value in extra.items():
        if value in (None, ""):
            continue
        if not first_value(merged, key):
            merged[key] = value
    return merged


def enrich_entry(
    scopus_session: requests.Session,
    entry: Dict[str, Any],
    matched_people: Set[str],
    abstract_view: str,
    crossref_mailto: str = "",
) -> Dict[str, Any]:
    enriched = dict(entry)
    candidate_author_lists: List[Tuple[str, List[str]]] = []

    # Search API authors, if Scopus supplied a real list.
    search_authors = extract_search_authors(entry)
    if search_authors:
        candidate_author_lists.append(("Scopus Search", search_authors))

    # Scopus Abstract Retrieval.
    abstract_authors, abstract_metadata = fetch_scopus_abstract_authors(scopus_session, entry, abstract_view)
    enriched = merge_entry_metadata(enriched, abstract_metadata)
    if abstract_authors:
        candidate_author_lists.append(("Scopus Abstract", abstract_authors))

    # Crossref often has complete author lists when Scopus Search only exposes first author.
    doi = first_value(enriched, "prism:doi", "doi")
    crossref_authors, crossref_metadata = fetch_crossref_authors(doi, crossref_mailto)
    enriched = merge_entry_metadata(enriched, crossref_metadata)
    if crossref_authors:
        candidate_author_lists.append(("Crossref", crossref_authors))

    # Choose the longest available list, because dc:creator/search can be first-author only.
    best_source = ""
    best_authors: List[str] = []
    for source, authors in candidate_author_lists:
        if len(authors) > len(best_authors):
            best_source = source
            best_authors = authors

    if best_authors:
        enriched["_full_author_bibtex"] = names_to_bibtex(best_authors)
        enriched["_author_source"] = best_source
    else:
        creator = first_value(entry, "dc:creator")
        if creator:
            enriched["_full_author_bibtex"] = creator
            enriched["_author_source"] = "Scopus dc:creator only"

    enriched["_maplab_people"] = " and ".join(sorted(matched_people))
    return enriched


def extract_authors(entry: Dict[str, Any]) -> str:
    full_authors = normalize_space(entry.get("_full_author_bibtex"))
    if full_authors:
        return full_authors

    names = extract_search_authors(entry)
    if names:
        return names_to_bibtex(names)

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
    title = clean_title(first_value(entry, "dc:title", "title"))
    year = parse_year(entry)
    doi = normalize_doi(first_value(entry, "prism:doi", "doi"))
    url = doi_url(doi) or first_value(entry, "prism:url", "link")

    fields: Dict[str, str] = {
        "author": extract_authors(entry),
        "title": title,
        "year": year,
    }

    maplab_people = normalize_space(entry.get("_maplab_people"))
    if maplab_people:
        fields["maplab_people"] = maplab_people

    publication_name = first_value(entry, "prism:publicationName", "source-title")
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
            fields[bib_key] = normalize_doi(value) if bib_key == "doi" else value

    if url:
        fields["url"] = url

    subtype = first_value(entry, "subtypeDescription")
    source = normalize_space(entry.get("_author_source"))
    notes: List[str] = []
    if subtype:
        notes.append(f"Scopus: {subtype}")
    if source:
        notes.append(f"Authors: {source}")
    if notes:
        fields["note"] = "; ".join(notes)

    return typ, fields


def sort_records(records: List[Tuple[str, Dict[str, str]]]) -> List[Tuple[str, Dict[str, str]]]:
    def sort_key(item: Tuple[str, Dict[str, str]]) -> Tuple[int, str, str]:
        _typ, fields = item
        year_text = fields.get("year", "0")
        match = re.search(r"(19|20)\d{2}", year_text)
        year = int(match.group(0)) if match else 0
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
        "maplab_people",
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
        "% Full author lists are recovered from Scopus Abstract Retrieval and/or Crossref when available.",
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
    parser.add_argument("--abstract-view", default="STANDARD", help="Scopus Abstract Retrieval API view")
    parser.add_argument("--sleep", type=float, default=0.25, help="Pause between API calls, in seconds")
    parser.add_argument("--crossref-mailto", default=os.environ.get("CROSSREF_MAILTO", ""), help="Optional email for Crossref polite pool")
    args = parser.parse_args(argv)

    api_key = os.environ.get("SCOPUS_API_KEY", "").strip()
    if not api_key:
        print("Missing SCOPUS_API_KEY. Add it as a GitHub repository secret or export it locally.", file=sys.stderr)
        return 2

    inst_token = os.environ.get("SCOPUS_INST_TOKEN", "").strip() or None
    authors = load_authors(args.authors)

    scopus_session = requests.Session()
    scopus_session.headers.update(scopus_headers(api_key, inst_token))

    deduped: OrderedDict[str, Dict[str, Any]] = OrderedDict()
    matched_people_by_record: Dict[str, Set[str]] = {}
    source_counts: Dict[str, int] = {}

    for author in authors:
        person_name = normalize_space(author["name"])
        query = build_query(author)
        print(f"Fetching Scopus publications for {person_name}: {query}")
        entries = fetch_entries_for_author(
            session=scopus_session,
            query=query,
            max_results=args.max_results_per_author,
            view=args.view,
        )
        source_counts[person_name] = len(entries)
        for entry in entries:
            key = dedupe_id(entry)
            if key not in deduped:
                deduped[key] = entry
                matched_people_by_record[key] = set()
            matched_people_by_record[key].add(person_name)
        time.sleep(args.sleep)

    unique_items = list(deduped.items())
    print(f"Found {len(unique_items)} unique Scopus records before author enrichment")

    final_entries: List[Dict[str, Any]] = []
    for index, (key, entry) in enumerate(unique_items, start=1):
        label = first_value(entry, "eid") or normalize_doi(first_value(entry, "prism:doi")) or key
        print(f"Enriching authors {index}/{len(unique_items)}: {label}")
        final_entries.append(
            enrich_entry(
                scopus_session=scopus_session,
                entry=entry,
                matched_people=matched_people_by_record.get(key, set()),
                abstract_view=args.abstract_view,
                crossref_mailto=args.crossref_mailto,
            )
        )
        time.sleep(args.sleep)

    records = [scopus_entry_to_record(entry) for entry in final_entries]
    records = sort_records(records)
    records = make_unique_keys(records)
    write_bibtex(args.output, records, authors)

    print(f"Wrote {len(records)} unique BibTeX entries to {args.output}")
    for name, count in source_counts.items():
        print(f"  {name}: {count} Scopus records before deduplication")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
