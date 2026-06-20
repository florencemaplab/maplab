#!/usr/bin/env python3
"""
Generate per-person Scopus analytics JSON files for the MAPLab people pages.

Outputs:
  data/scopus/<slug>.json

The browser reads these files to show:
  - Scopus author metrics
  - a keyword cloud from publication titles and abstracts when available
  - a coauthor connection map

This script does not expose the Scopus API key. It is designed to run in GitHub Actions.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import sys
import time
from collections import Counter, OrderedDict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests


SCOPUS_SEARCH_URL = "https://api.elsevier.com/content/search/scopus"
SCOPUS_AUTHOR_URL = "https://api.elsevier.com/content/author/author_id/{author_id}"
SCOPUS_ABSTRACT_EID_URL = "https://api.elsevier.com/content/abstract/eid/{eid}"

DEFAULT_COUNT = 25
DEFAULT_MAX_RESULTS_PER_AUTHOR = 300

STOPWORDS = {
    "a", "about", "above", "across", "after", "again", "against", "all", "also", "am",
    "an", "and", "any", "are", "as", "at", "based", "be", "because", "been", "before",
    "being", "between", "both", "but", "by", "can", "could", "did", "do", "does",
    "doing", "during", "each", "effect", "effects", "for", "from", "further", "had",
    "has", "have", "having", "how", "however", "human", "humans", "if", "in", "into",
    "is", "it", "its", "itself", "may", "more", "most", "no", "nor", "not", "of",
    "on", "once", "only", "or", "other", "our", "out", "over", "paper", "per",
    "results", "same", "show", "shows", "shown", "so", "some", "such", "study",
    "than", "that", "the", "their", "then", "there", "these", "this", "those",
    "through", "to", "under", "using", "very", "via", "was", "we", "were", "what",
    "when", "where", "which", "while", "who", "will", "with", "within", "without",
    "work", "works", "would",
    # Common publication/meta terms that are not useful in a visual neuroscience lab word cloud.
    "analysis", "approach", "article", "case", "data", "evidence", "experimental",
    "findings", "method", "methods", "model", "models", "new", "performance",
    "possible", "process", "processing", "research", "response", "responses",
    "significant", "task", "tasks", "test", "toward", "towards"
}


def load_json(path: str | Path) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: str | Path, data: Any) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def normalize_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_name(value: str) -> str:
    value = normalize_space(value).lower()
    value = value.replace(".", " ").replace(",", " ")
    value = re.sub(r"[^a-z0-9à-ÿ]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def slugify(value: str) -> str:
    value = normalize_name(value)
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "person"


def split_bib_entries(text: str) -> List[str]:
    entries: List[str] = []
    i = 0
    while i < len(text):
        at = text.find("@", i)
        if at == -1:
            break
        brace = text.find("{", at)
        if brace == -1:
            break

        depth = 0
        end = brace
        while end < len(text):
            char = text[end]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    end += 1
                    break
            end += 1

        entries.append(text[at:end])
        i = end
    return entries


def parse_bib_fields(body: str) -> Dict[str, str]:
    fields: Dict[str, str] = {}
    pos = 0

    while pos < len(body):
        match = re.search(r"\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*", body[pos:])
        if not match:
            break

        pos += match.start() + len(match.group(0))
        name = match.group(1).lower()
        value = ""

        if pos < len(body) and body[pos] == "{":
            depth = 0
            start = pos + 1
            end = start
            while end < len(body):
                if body[end] == "{":
                    depth += 1
                elif body[end] == "}":
                    if depth == 0:
                        break
                    depth -= 1
                end += 1
            value = body[start:end]
            pos = end + 1
        elif pos < len(body) and body[pos] == '"':
            start = pos + 1
            end = start
            while end < len(body) and body[end] != '"':
                end += 1
            value = body[start:end]
            pos = end + 1
        else:
            end = pos
            while end < len(body) and body[end] != ",":
                end += 1
            value = body[pos:end]
            pos = end

        fields[name] = clean_bib_value(value)

        comma = body.find(",", pos)
        if comma == -1:
            break
        pos = comma + 1

    return fields


def parse_bibtex(path: str | Path) -> List[Dict[str, Any]]:
    path = Path(path)
    if not path.exists():
        return []

    text = path.read_text(encoding="utf-8")
    entries: List[Dict[str, Any]] = []

    for raw in split_bib_entries(text):
        header = re.match(r"^@([^{]+)\{\s*([^,]+),", raw)
        if not header:
            continue
        body = raw[len(header.group(0)):-1]
        entries.append({
            "type": header.group(1).strip().lower(),
            "key": header.group(2).strip(),
            "fields": parse_bib_fields(body),
        })

    return entries


def clean_bib_value(value: str) -> str:
    value = normalize_space(value)
    replacements = {
        r"\_": "_",
        r"\&": "&",
        r"\%": "%",
        r"\$": "$",
        r"\#": "#",
        r"\{": "{",
        r"\}": "}",
        r"\textbackslash{}": "\\",
        r"\textasciitilde{}": "~",
        r"\textasciicircum{}": "^",
    }
    for old, new in replacements.items():
        value = value.replace(old, new)
    return normalize_space(value)


def split_bib_authors(author_field: str) -> List[str]:
    return [
        clean_bib_value(author).strip()
        for author in re.split(r"\s+and\s+", author_field or "", flags=re.I)
        if clean_bib_value(author).strip()
    ]


def bib_author_display_name(author: str) -> str:
    author = clean_bib_value(author)
    if "," in author:
        parts = [part.strip() for part in author.split(",") if part.strip()]
        if len(parts) >= 2:
            return normalize_space(f"{' '.join(parts[1:])} {parts[0]}")
    return normalize_space(author)


def canonical_author_key(author: str) -> str:
    display = bib_author_display_name(author)
    display = re.sub(r"\b([A-Z])\.\s*", r"\1 ", display)
    normalized = normalize_name(display)
    parts = normalized.split()
    if not parts:
        return ""

    # Merge common variants such as "David Burr", "D Burr", "David C Burr".
    surname = parts[-1]
    given_initials = "".join(part[0] for part in parts[:-1] if part)
    if given_initials:
        return f"{surname}:{given_initials[:2]}"
    return surname


def author_name_score(name: str) -> Tuple[int, int]:
    display = bib_author_display_name(name)
    # Prefer full names over initials-only forms.
    full_parts = [part for part in re.split(r"\s+", display) if len(part.strip(".")) > 1]
    return (len(full_parts), len(display))


def bib_entry_matches_profile(entry: Dict[str, Any], aliases: List[str]) -> bool:
    fields = entry.get("fields", {})
    maplab_people = fields.get("maplab_people") or fields.get("maplab_person") or ""
    mapped_names = [
        item.strip()
        for item in re.split(r"\s*(?:;|\||, and | and )\s*", maplab_people, flags=re.I)
        if item.strip()
    ]

    if any(name_matches_alias(name, aliases) for name in mapped_names):
        return True

    authors = split_bib_authors(fields.get("author", ""))
    return any(name_matches_alias(bib_author_display_name(author), aliases) for author in authors)


def coauthor_counts_from_bibtex(
    bib_entries: List[Dict[str, Any]],
    aliases: List[str],
    max_coauthors: int = 80,
) -> List[Dict[str, Any]]:
    counts: Counter[str] = Counter()
    best_names: Dict[str, str] = {}

    for entry in bib_entries:
        if not bib_entry_matches_profile(entry, aliases):
            continue

        authors = split_bib_authors(entry.get("fields", {}).get("author", ""))

        # Count a coauthor once per paper, even if a duplicated author string appears.
        seen_in_paper = set()

        for author in authors:
            display = bib_author_display_name(author)
            if not display or name_matches_alias(display, aliases):
                continue

            key = canonical_author_key(display)
            if not key or key in seen_in_paper:
                continue

            seen_in_paper.add(key)
            counts[key] += 1

            previous = best_names.get(key)
            if previous is None or author_name_score(display) > author_name_score(previous):
                best_names[key] = display

    return [
        {"name": best_names.get(key, key), "count": int(count)}
        for key, count in counts.most_common(max_coauthors)
    ]


def bib_titles_for_profile(bib_entries: List[Dict[str, Any]], aliases: List[str]) -> List[str]:
    titles: List[str] = []
    for entry in bib_entries:
        if bib_entry_matches_profile(entry, aliases):
            title = entry.get("fields", {}).get("title", "")
            if title:
                titles.append(title)
    return titles


def author_id_list(value: Any) -> List[str]:
    text = normalize_space(value)
    if not text:
        return []
    return [item for item in re.split(r"[,;\s]+", text) if item]


def scopus_headers(api_key: str, inst_token: Optional[str] = None) -> Dict[str, str]:
    headers = {
        "Accept": "application/json",
        "X-ELS-APIKey": api_key,
    }
    if inst_token:
        headers["X-ELS-Insttoken"] = inst_token
    return headers


def request_json(
    session: requests.Session,
    url: str,
    params: Optional[Dict[str, Any]] = None,
    retries: int = 3,
    fail_soft: bool = False,
) -> Optional[Dict[str, Any]]:
    for attempt in range(1, retries + 1):
        response = session.get(url, params=params or {}, timeout=45)

        if response.status_code in {429, 500, 502, 503, 504} and attempt < retries:
            wait_seconds = 2 * attempt
            print(f"Scopus returned {response.status_code}; retrying in {wait_seconds}s...", file=sys.stderr)
            time.sleep(wait_seconds)
            continue

        if not response.ok:
            detail = response.text[:500].replace("\n", " ")
            message = f"Request failed: HTTP {response.status_code}: {detail}"
            if fail_soft:
                # Optional metadata calls may be unavailable depending on the API
                # entitlement. Keep logs readable: only print non-view errors.
                if "View parameter entered is not valid" not in detail:
                    print(f"Warning: {message}", file=sys.stderr)
                return None
            raise RuntimeError(message)

        try:
            return response.json()
        except ValueError:
            if fail_soft:
                print("Warning: response was not JSON", file=sys.stderr)
                return None
            raise RuntimeError("Response was not JSON")

    return None


def build_query(author: Dict[str, Any]) -> str:
    ids = author_id_list(author.get("scopus_author_id", ""))
    if ids:
        return " OR ".join(f"AU-ID({item})" for item in ids)

    explicit = normalize_space(author.get("search_query"))
    if explicit:
        return explicit

    name = normalize_space(author.get("name"))
    parts = name.split()
    if len(parts) >= 2:
        return f"AUTHLASTNAME({parts[-1]}) AND AUTHFIRST({parts[0]})"
    raise ValueError(f"No usable Scopus query for author config: {author}")


def fetch_search_entries(
    session: requests.Session,
    query: str,
    max_results: int = DEFAULT_MAX_RESULTS_PER_AUTHOR,
) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    start = 0
    total: Optional[int] = None

    while start < max_results:
        params = {
            "query": query,
            "start": start,
            "count": min(DEFAULT_COUNT, max_results - start),
            "view": "STANDARD",
            "sort": "-coverDate",
        }
        payload = request_json(session, SCOPUS_SEARCH_URL, params)
        results = (payload or {}).get("search-results", {})

        if total is None:
            try:
                total = int(results.get("opensearch:totalResults", "0"))
            except (TypeError, ValueError):
                total = 0

        page = [entry for entry in results.get("entry", []) if "error" not in entry]
        entries.extend(page)

        if not page:
            break

        start += len(page)
        if total is not None and start >= total:
            break

    return entries


def first_value(mapping: Dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = mapping.get(key)
        if isinstance(value, str) and normalize_space(value):
            return normalize_space(value)
    return ""


def parse_int(value: Any) -> Optional[int]:
    text = normalize_space(value)
    if not text:
        return None
    match = re.search(r"-?\d+", text.replace(",", ""))
    return int(match.group(0)) if match else None


def h_index_from_counts(counts: Iterable[int]) -> int:
    sorted_counts = sorted((int(count) for count in counts if count is not None), reverse=True)
    h = 0
    for index, count in enumerate(sorted_counts, start=1):
        if count >= index:
            h = index
        else:
            break
    return h


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


def as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def author_name_from_scopus_author(author: Dict[str, Any]) -> str:
    preferred = normalize_space(author.get("preferred-name", {}).get("ce:indexed-name")) if isinstance(author.get("preferred-name"), dict) else ""
    indexed = first_value(author, "ce:indexed-name", "indexed-name", "authname")
    surname = first_value(author, "ce:surname", "surname")
    given = first_value(author, "ce:given-name", "given-name", "initials")

    if preferred:
        return preferred
    if indexed:
        return indexed
    if surname and given:
        return f"{given} {surname}"
    return surname or given


def authors_from_payload(payload: Optional[Dict[str, Any]]) -> List[str]:
    if not payload:
        return []

    authors_obj = find_first_key(payload, {"author"})
    names: List[str] = []
    for item in as_list(authors_obj):
        if isinstance(item, dict):
            name = author_name_from_scopus_author(item)
            if name:
                names.append(name)

    # Deduplicate while preserving order.
    out: List[str] = []
    seen = set()
    for name in names:
        key = normalize_name(name)
        if key and key not in seen:
            seen.add(key)
            out.append(name)
    return out


def abstract_from_payload(payload: Optional[Dict[str, Any]]) -> str:
    if not payload:
        return ""

    # Common Scopus locations.
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
            joined = " ".join(normalize_space(item) for item in value if isinstance(item, str))
            if joined:
                return joined

    return ""


def fetch_abstract_metadata(session: requests.Session, eid: str) -> Tuple[str, List[str]]:
    if not eid:
        return "", []

    # Abstract Retrieval does not accept the same views as Search/Author APIs.
    # META_ABS is the useful lightweight view for abstract text; FULL may require
    # institutional entitlement. Finally, try the endpoint default with no view.
    request_variants = [
        {"view": "META_ABS"},
        {"view": "FULL"},
        {},
    ]

    for params in request_variants:
        payload = request_json(
            session,
            SCOPUS_ABSTRACT_EID_URL.format(eid=eid),
            params=params,
            fail_soft=True,
        )
        if payload:
            abstract = abstract_from_payload(payload)
            authors = authors_from_payload(payload)
            if abstract or authors:
                return abstract, authors
    return "", []


def fetch_author_metrics(
    session: requests.Session,
    scopus_author_ids: List[str],
    fallback_citation_counts: Optional[List[int]] = None,
) -> Dict[str, Any]:
    fallback_citation_counts = fallback_citation_counts or []
    fallback_total_citations = sum(int(value) for value in fallback_citation_counts if value is not None)
    fallback_h_index = h_index_from_counts(fallback_citation_counts)

    metrics: Dict[str, Any] = {
        "scopus_author_id": ", ".join(scopus_author_ids),
        "citation_count": fallback_total_citations if fallback_total_citations else None,
        "cited_by_count": fallback_total_citations if fallback_total_citations else None,
        "h_index": fallback_h_index if fallback_h_index else None,
    }

    totals = Counter()
    h_values: List[int] = []

    for author_id in scopus_author_ids:
        # Author Retrieval does not support a METRICS view. STANDARD is safe;
        # the endpoint default is used as a fallback without adding a view.
        for params in [{"view": "STANDARD"}, {}]:
            payload = request_json(
                session,
                SCOPUS_AUTHOR_URL.format(author_id=author_id),
                params=params,
                fail_soft=True,
            )
            if not payload:
                continue

            responses = payload.get("author-retrieval-response")
            response = responses[0] if isinstance(responses, list) and responses else responses
            if not isinstance(response, dict):
                continue

            core = response.get("coredata", {})
            if not isinstance(core, dict):
                core = {}

            # Elsevier can expose these fields either in coredata or nested profile blocks.
            citation = (
                parse_int(core.get("citation-count"))
                or parse_int(core.get("cited-by-count"))
                or parse_int(find_first_key(response, {"citation-count"}))
                or parse_int(find_first_key(response, {"cited-by-count"}))
            )
            h_index = (
                parse_int(core.get("h-index"))
                or parse_int(find_first_key(response, {"h-index"}))
                or parse_int(find_first_key(response, {"hindex"}))
            )

            if citation is not None:
                totals["citation_count"] += citation
            if h_index is not None:
                h_values.append(h_index)

            if citation is not None or h_index is not None:
                break

    if "citation_count" in totals and totals["citation_count"] > 0:
        metrics["citation_count"] = totals["citation_count"]
        metrics["cited_by_count"] = totals["citation_count"]

    if h_values:
        metrics["h_index"] = max(h_values)

    return metrics


def tokenize(text: str) -> List[str]:
    text = normalize_space(text).lower()
    text = re.sub(r"[^a-z0-9à-ÿ\- ]+", " ", text)
    words = [word.strip("-") for word in text.split()]
    return [
        word
        for word in words
        if len(word) >= 4
        and word not in STOPWORDS
        and not word.isdigit()
    ]


def keyword_counts(texts: List[str], max_keywords: int = 55) -> List[Dict[str, Any]]:
    unigram = Counter()
    bigram = Counter()

    for text in texts:
        words = tokenize(text)
        unigram.update(words)
        bigram.update(" ".join(pair) for pair in zip(words, words[1:]) if pair[0] != pair[1])

    # Prefer a mix of strong unigrams and bigrams, but avoid overwhelming the cloud with rare bigrams.
    combined: Counter[str] = Counter()
    for word, count in unigram.items():
        if count >= 2:
            combined[word] += count
    for phrase, count in bigram.items():
        if count >= 2:
            combined[phrase] += count + 1

    if not combined:
        combined.update(unigram)

    return [
        {"text": text, "value": int(count)}
        for text, count in combined.most_common(max_keywords)
    ]


def name_matches_alias(name: str, aliases: List[str]) -> bool:
    n = normalize_name(name)
    variants = {n}

    if "," in name:
        parts = [part.strip() for part in name.split(",") if part.strip()]
        if len(parts) >= 2:
            variants.add(normalize_name(f"{parts[1]} {parts[0]}"))
            variants.add(normalize_name(f"{parts[0]} {parts[1]}"))
    else:
        parts = name.split()
        if len(parts) >= 2:
            variants.add(normalize_name(f"{parts[-1]} {' '.join(parts[:-1])}"))

    alias_variants = {normalize_name(alias) for alias in aliases}
    for left in variants:
        for right in alias_variants:
            if not left or not right:
                continue
            if left == right:
                return True
            if len(left) >= 8 and len(right) >= 8 and (left in right or right in left):
                return True
    return False


def coauthor_counts(author_lists: List[List[str]], aliases: List[str], max_coauthors: int = 45) -> List[Dict[str, Any]]:
    counts = Counter()

    for authors in author_lists:
        for author in authors:
            if not author or name_matches_alias(author, aliases):
                continue
            counts[author] += 1

    return [
        {"name": name, "count": int(count)}
        for name, count in counts.most_common(max_coauthors)
    ]


def build_people_profiles(people_index_path: Path, people_dir: Path) -> Dict[str, Dict[str, Any]]:
    people_index = load_json(people_index_path)
    profiles: Dict[str, Dict[str, Any]] = {}

    for entry in people_index:
        slug = entry.get("slug")
        if not slug:
            continue
        path = people_dir / f"{slug}.json"
        if not path.exists():
            continue
        profile = load_json(path)
        profile.setdefault("slug", slug)
        profiles[slug] = profile

    return profiles


def match_author_to_profile(author: Dict[str, Any], profiles: Dict[str, Dict[str, Any]]) -> Tuple[str, Dict[str, Any]]:
    explicit_slug = normalize_space(author.get("slug"))
    if explicit_slug and explicit_slug in profiles:
        return explicit_slug, profiles[explicit_slug]

    name = normalize_space(author.get("name"))
    for slug, profile in profiles.items():
        if normalize_name(profile.get("name", "")) == normalize_name(name):
            return slug, profile

    # Fall back to slugified name with minimal profile. The JSON will still be generated.
    slug = explicit_slug or slugify(name)
    return slug, {"slug": slug, "name": name, "aliases": [name]}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Generate per-author Scopus analytics JSON.")
    parser.add_argument("--authors", default="scripts/scopus_authors.json")
    parser.add_argument("--people-index", default="data/people/people.json")
    parser.add_argument("--people-dir", default="data/people")
    parser.add_argument("--output-dir", default="data/scopus")
    parser.add_argument("--bibtex", default="data/publications.bib", help="Shared BibTeX file used for accurate coauthor counts")
    parser.add_argument("--max-results-per-author", type=int, default=DEFAULT_MAX_RESULTS_PER_AUTHOR)
    parser.add_argument("--sleep", type=float, default=0.2)
    args = parser.parse_args(argv)

    api_key = normalize_space(os.environ.get("SCOPUS_API_KEY"))
    if not api_key:
        print("Missing SCOPUS_API_KEY; cannot update Scopus analytics.", file=sys.stderr)
        return 2

    inst_token = normalize_space(os.environ.get("SCOPUS_INST_TOKEN")) or None

    authors = load_json(args.authors)
    profiles = build_people_profiles(Path(args.people_index), Path(args.people_dir))
    bib_entries = parse_bibtex(args.bibtex)

    session = requests.Session()
    session.headers.update(scopus_headers(api_key, inst_token))

    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for author in authors:
        name = normalize_space(author.get("name"))
        if not name:
            continue

        slug, profile = match_author_to_profile(author, profiles)
        aliases = list(OrderedDict.fromkeys([profile.get("name", name), name, *profile.get("aliases", [])]))

        query = build_query(author)
        scopus_ids = author_id_list(author.get("scopus_author_id", ""))

        print(f"Generating Scopus analytics for {name} ({slug}): {query}")

        try:
            entries = fetch_search_entries(session, query, max_results=args.max_results_per_author)
        except Exception as exc:
            print(f"Warning: could not fetch search entries for {name}: {exc}", file=sys.stderr)
            entries = []

        texts: List[str] = []
        author_lists: List[List[str]] = []
        citation_counts: List[int] = []
        abstracts_found = 0

        seen_eids = set()
        for entry in entries:
            title = first_value(entry, "dc:title")
            cited_by = parse_int(entry.get("citedby-count"))
            if cited_by is not None:
                citation_counts.append(cited_by)
            abstract = ""
            full_authors: List[str] = []

            eid = first_value(entry, "eid")
            if eid and eid not in seen_eids:
                seen_eids.add(eid)
                try:
                    abstract, full_authors = fetch_abstract_metadata(session, eid)
                except Exception as exc:
                    print(f"Warning: abstract metadata failed for {eid}: {exc}", file=sys.stderr)

            if abstract:
                abstracts_found += 1

            if not full_authors:
                creator = first_value(entry, "dc:creator")
                if creator:
                    full_authors = [creator]

            texts.append(" ".join(part for part in [title, abstract] if part))
            if full_authors:
                author_lists.append(full_authors)

            time.sleep(args.sleep)

        metrics = fetch_author_metrics(session, scopus_ids, citation_counts) if scopus_ids else {
            "scopus_author_id": "",
            "citation_count": sum(citation_counts) if citation_counts else None,
            "cited_by_count": sum(citation_counts) if citation_counts else None,
            "h_index": h_index_from_counts(citation_counts) if citation_counts else None,
        }

        # Coauthor counts must come from the shared BibTeX bibliography, not from
        # Abstract Retrieval metadata: Scopus often returns partial author lists
        # there depending on entitlement. The BibTeX file is the source of truth
        # for what is displayed on the personal pages.
        bib_coauthors = coauthor_counts_from_bibtex(bib_entries, aliases)
        if not bib_coauthors:
            bib_coauthors = coauthor_counts(author_lists, aliases)

        keyword_texts = texts + bib_titles_for_profile(bib_entries, aliases)

        output = {
            "slug": slug,
            "name": profile.get("name", name),
            "generated_at": now,
            "source": "Scopus Search API for metrics/keywords; shared BibTeX for coauthor counts",
            "metrics": metrics,
            "publications_analyzed": len(entries),
            "abstracts_found": abstracts_found,
            "keywords": keyword_counts(keyword_texts),
            "coauthors": bib_coauthors,
        }

        write_json(Path(args.output_dir) / f"{slug}.json", output)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
