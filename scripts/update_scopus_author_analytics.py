#!/usr/bin/env python3
"""
Generate per-person Scopus analytics JSON files for the MAPLab people pages.

SURNAME_PARTICLES = {
    "da", "de", "del", "della", "di", "dos", "du", "la", "le",
    "van", "von", "der", "den", "ter", "ten", "st", "saint"
}


def author_signature_for_matching(name: str) -> str:
    raw = re.sub(r"\s+", " ", str(name or "")).strip()
    if not raw:
        return ""
    raw = re.sub(r"\b([A-Z])\.\s*", r"\1 ", raw)

    def norm(v):
        v = unicodedata.normalize("NFD", str(v or ""))
        v = "".join(ch for ch in v if unicodedata.category(ch) != "Mn")
        v = v.lower()
        v = re.sub(r"[.,]", " ", v)
        v = re.sub(r"[^a-z0-9 ]+", " ", v)
        return re.sub(r"\s+", " ", v).strip()

    if "," in raw:
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        surname_raw = parts[0] if parts else ""
        given_raw = " ".join(parts[1:]) if len(parts) > 1 else ""
    else:
        parts = [p for p in raw.split() if p]
        if not parts:
            return ""
        given_raw = parts[0]
        if len(parts) >= 2 and norm(parts[-2]) in SURNAME_PARTICLES:
            surname_raw = " ".join(parts[-2:])
        else:
            surname_raw = parts[-1]

    surname = norm(surname_raw)
    given = norm(given_raw)
    return f"{surname}:{given[0]}" if surname and given else surname


No Abstract Retrieval or Author Retrieval is used here, to avoid entitlement
errors. Metrics are derived from Scopus Search records; coauthors are counted
from data/publications.bib.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
from collections import Counter, OrderedDict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests


SCOPUS_SEARCH_URL = "https://api.elsevier.com/content/search/scopus"
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


def author_id_list(value: Any) -> List[str]:
    text = normalize_space(value)
    if not text:
        return []
    return [item for item in re.split(r"[,;\s]+", text) if item]


def scopus_headers(api_key: str, inst_token: Optional[str] = None) -> Dict[str, str]:
    headers = {"Accept": "application/json", "X-ELS-APIKey": api_key}
    if inst_token:
        headers["X-ELS-Insttoken"] = inst_token
    return headers


def request_json(session: requests.Session, url: str, params: Optional[Dict[str, Any]] = None, retries: int = 3) -> Dict[str, Any]:
    for attempt in range(1, retries + 1):
        response = session.get(url, params=params or {}, timeout=45)
        if response.status_code in {429, 500, 502, 503, 504} and attempt < retries:
            time.sleep(2 * attempt)
            continue
        if not response.ok:
            detail = response.text[:500].replace("\n", " ")
            raise RuntimeError(f"Request failed: HTTP {response.status_code}: {detail}")
        return response.json()
    raise RuntimeError("Request failed after retries")


def build_query(author: Dict[str, Any]) -> str:
    ids = author_id_list(author.get("scopus_author_id"))
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


def fetch_search_entries(session: requests.Session, query: str, max_results: int = DEFAULT_MAX_RESULTS_PER_AUTHOR) -> List[Dict[str, Any]]:
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
        results = payload.get("search-results", {})

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


def clean_bib_value(value: str) -> str:
    value = normalize_space(value)
    replacements = {
        r"\_": "_", r"\&": "&", r"\%": "%", r"\$": "$", r"\#": "#",
        r"\{": "{", r"\}": "}", r"\textbackslash{}": "\\",
        r"\textasciitilde{}": "~", r"\textasciicircum{}": "^",
    }
    for old, new in replacements.items():
        value = value.replace(old, new)
    return normalize_space(value)


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
        entries.append({"type": header.group(1).strip().lower(), "key": header.group(2).strip(), "fields": parse_bib_fields(body)})
    return entries


def split_bib_authors(author_field: str) -> List[str]:
    return [clean_bib_value(author).strip() for author in re.split(r"\s+and\s+", author_field or "", flags=re.I) if clean_bib_value(author).strip()]


def bib_author_display_name(author: str) -> str:
    author = clean_bib_value(author)
    if "," in author:
        parts = [part.strip() for part in author.split(",") if part.strip()]
        if len(parts) >= 2:
            return normalize_space(f"{' '.join(parts[1:])} {parts[0]}")
    return normalize_space(author)


def name_matches_alias(name: str, aliases: List[str]) -> bool:
    n = normalize_name(name)
    alias_variants = {normalize_name(alias) for alias in aliases if alias}
    if n in alias_variants:
        return True
    parts = n.split()
    if len(parts) >= 2:
        swapped = normalize_name(f"{parts[-1]} {' '.join(parts[:-1])}")
        if swapped in alias_variants:
            return True
    for alias in alias_variants:
        if len(n) >= 8 and len(alias) >= 8 and (n in alias or alias in n):
            return True
    return False


def canonical_author_key(author: str) -> str:
    return author_signature_for_matching(author)


def author_name_score(name: str) -> Tuple[int, int]:
    display = bib_author_display_name(name)
    full_parts = [part for part in re.split(r"\s+", display) if len(part.strip(".")) > 1]
    return (len(full_parts), len(display))


def bib_entry_matches_profile(entry: Dict[str, Any], aliases: List[str]) -> bool:
    fields = entry.get("fields", {})
    maplab_people = fields.get("maplab_people") or fields.get("maplab_person") or ""
    mapped_names = [item.strip() for item in re.split(r"\s*(?:;|\||, and | and )\s*", maplab_people, flags=re.I) if item.strip()]
    if any(name_matches_alias(name, aliases) for name in mapped_names):
        return True
    authors = split_bib_authors(fields.get("author", ""))
    return any(name_matches_alias(bib_author_display_name(author), aliases) for author in authors)


def coauthor_counts_from_bibtex(bib_entries: List[Dict[str, Any]], aliases: List[str], max_coauthors: int = 80) -> List[Dict[str, Any]]:
    counts: Counter[str] = Counter()
    best_names: Dict[str, str] = {}
    for entry in bib_entries:
        if not bib_entry_matches_profile(entry, aliases):
            continue
        seen_in_paper = set()
        for author in split_bib_authors(entry.get("fields", {}).get("author", "")):
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
    return [{"name": best_names.get(key, key), "count": int(count)} for key, count in counts.most_common(max_coauthors)]


def bib_titles_for_profile(bib_entries: List[Dict[str, Any]], aliases: List[str]) -> List[str]:
    return [entry.get("fields", {}).get("title", "") for entry in bib_entries if bib_entry_matches_profile(entry, aliases) and entry.get("fields", {}).get("title", "")]


def tokenize(text: str) -> List[str]:
    text = normalize_space(text).lower()
    text = re.sub(r"[^a-z0-9à-ÿ\- ]+", " ", text)
    words = [word.strip("-") for word in text.split()]
    return [word for word in words if len(word) >= 4 and word not in STOPWORDS and not word.isdigit()]


def keyword_counts(texts: List[str], max_keywords: int = 55) -> List[Dict[str, Any]]:
    unigram = Counter()
    bigram = Counter()
    for text in texts:
        words = tokenize(text)
        unigram.update(words)
        bigram.update(" ".join(pair) for pair in zip(words, words[1:]) if pair[0] != pair[1])
    combined: Counter[str] = Counter()
    for word, count in unigram.items():
        if count >= 2:
            combined[word] += count
    for phrase, count in bigram.items():
        if count >= 2:
            combined[phrase] += count + 1
    if not combined:
        combined.update(unigram)
    return [{"text": text, "value": int(count)} for text, count in combined.most_common(max_keywords)]


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
    slug = explicit_slug or slugify(name)
    return slug, {"slug": slug, "name": name, "aliases": [name]}


def aliases_for_profile(profile: Dict[str, Any]) -> List[str]:
    name = normalize_space(profile.get("name"))
    aliases = profile.get("aliases", [])
    if not isinstance(aliases, list):
        aliases = []
    return list(OrderedDict.fromkeys([name, *aliases]))


def lab_slugs_for_bib_entry(entry: Dict[str, Any], profiles: Dict[str, Dict[str, Any]]) -> List[str]:
    fields = entry.get("fields", {})
    explicit_slugs = fields.get("maplab_slugs", "")
    if explicit_slugs:
        slugs = [item.strip() for item in re.split(r"\s*(?:;|\||,)\s*", explicit_slugs) if item.strip()]
        return [slug for slug in slugs if slug in profiles]

    authors = [bib_author_display_name(author) for author in split_bib_authors(fields.get("author", ""))]
    slugs: List[str] = []
    for slug, profile in profiles.items():
        aliases = aliases_for_profile(profile)
        if any(name_matches_alias(author, aliases) for author in authors):
            slugs.append(slug)
    return slugs


def is_any_lab_member(author_name: str, profiles: Dict[str, Dict[str, Any]]) -> bool:
    return any(name_matches_alias(author_name, aliases_for_profile(profile)) for profile in profiles.values())


def build_lab_network_from_bibtex(
    bib_entries: List[Dict[str, Any]],
    profiles: Dict[str, Dict[str, Any]],
    max_external_nodes: int = 500,
) -> Dict[str, Any]:
    node_info: Dict[str, Dict[str, Any]] = {}
    edge_counts: Counter[Tuple[str, str]] = Counter()

    def ensure_node(node_id: str, name: str, node_type: str, category: str = "") -> Dict[str, Any]:
        if node_id not in node_info:
            node_info[node_id] = {
                "id": node_id,
                "name": name,
                "type": node_type,
                "category": category,
                "documents": 0,
                "total_link_strength": 0,
                "cluster": 0,
            }
        return node_info[node_id]

    def canonical_edge(a: str, b: str) -> Tuple[str, str]:
        return (a, b) if a < b else (b, a)

    for entry in bib_entries:
        authors = [bib_author_display_name(author) for author in split_bib_authors(entry.get("fields", {}).get("author", ""))]
        authors = [author for author in authors if author]
        if not authors:
            continue

        paper_nodes: List[str] = []
        seen_nodes = set()
        has_lab_member = False

        for author_name in authors:
            matched_slug = None
            matched_profile = None
            for slug, profile in profiles.items():
                if name_matches_alias(author_name, aliases_for_profile(profile)):
                    matched_slug = slug
                    matched_profile = profile
                    break

            if matched_slug and matched_profile is not None:
                has_lab_member = True
                node = ensure_node(
                    matched_slug,
                    matched_profile.get("name", matched_slug),
                    "lab",
                    normalize_space(matched_profile.get("category") or matched_profile.get("group")),
                )
                node_id = matched_slug
            else:
                key = canonical_author_key(author_name)
                if not key:
                    continue
                node_id = f"co:{key}"
                node = ensure_node(node_id, author_name, "external", "")

            if node_id not in seen_nodes:
                seen_nodes.add(node_id)
                paper_nodes.append(node_id)
                node["documents"] += 1

        if not has_lab_member:
            continue

        for source_index, source_id in enumerate(paper_nodes):
            for target_id in paper_nodes[source_index + 1:]:
                edge_counts[canonical_edge(source_id, target_id)] += 1

    for (source_id, target_id), count in edge_counts.items():
        node_info[source_id]["total_link_strength"] += count
        node_info[target_id]["total_link_strength"] += count

    lab_nodes = []
    external_nodes = []
    for slug, profile in profiles.items():
        node = node_info.get(slug)
        if node is None:
            node = ensure_node(
                slug,
                profile.get("name", slug),
                "lab",
                normalize_space(profile.get("category") or profile.get("group")),
            )
        lab_nodes.append(node)

    for node_id, node in node_info.items():
        if node_id not in profiles:
            external_nodes.append(node)

    external_nodes.sort(
        key=lambda node: (
            -int(node.get("total_link_strength", 0)),
            -int(node.get("documents", 0)),
            normalize_name(node.get("name", "")),
        )
    )
    kept_external = external_nodes[:max_external_nodes]
    kept_ids = {node["id"] for node in lab_nodes} | {node["id"] for node in kept_external}

    edges: List[Dict[str, Any]] = []
    adjacency: Dict[str, List[Tuple[str, int]]] = {node_id: [] for node_id in kept_ids}
    for (source_id, target_id), count in edge_counts.items():
        if source_id in kept_ids and target_id in kept_ids:
            edges.append({
                "source": source_id,
                "target": target_id,
                "count": int(count),
                "type": "coauthorship",
            })
            adjacency[source_id].append((target_id, int(count)))
            adjacency[target_id].append((source_id, int(count)))

    # Lightweight weighted label propagation to obtain VOSviewer-like clusters.
    labels: Dict[str, str] = {node_id: node_id for node_id in kept_ids}
    traversal = sorted(
        kept_ids,
        key=lambda node_id: (
            -int(node_info[node_id].get("total_link_strength", 0)),
            -int(node_info[node_id].get("documents", 0)),
            normalize_name(node_info[node_id].get("name", "")),
        ),
    )
    for _ in range(20):
        changed = False
        for node_id in traversal:
            if not adjacency.get(node_id):
                continue
            candidate_weights: Counter[str] = Counter()
            for neighbor_id, weight in adjacency[node_id]:
                candidate_weights[labels.get(neighbor_id, neighbor_id)] += int(weight)
            best_label = labels[node_id]
            best_weight = -1
            for label, weight in sorted(candidate_weights.items(), key=lambda item: (-item[1], item[0])):
                if weight > best_weight:
                    best_weight = weight
                    best_label = label
            if best_label != labels[node_id]:
                labels[node_id] = best_label
                changed = True
        if not changed:
            break

    cluster_roots = OrderedDict()
    cluster_id = 0
    nodes = lab_nodes + kept_external
    for node in nodes:
        root = labels.get(node["id"], node["id"])
        if root not in cluster_roots:
            cluster_roots[root] = cluster_id
            cluster_id += 1
        node["cluster"] = int(cluster_roots[root])

    edges.sort(key=lambda item: (-int(item.get("count", 0)), item["source"], item["target"]))

    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "lab_members": len(lab_nodes),
            "external_collaborators": len(kept_external),
            "edges": len(edges),
        },
    }


def build_lab_keyword_cloud(bib_entries: List[Dict[str, Any]], max_keywords: int = 70) -> List[Dict[str, Any]]:
    titles = [
        entry.get("fields", {}).get("title", "")
        for entry in bib_entries
        if entry.get("fields", {}).get("title", "")
    ]
    return keyword_counts(titles, max_keywords=max_keywords)


def write_labwide_analytics(
    output_dir: str | Path,
    profiles: Dict[str, Dict[str, Any]],
    bib_entries: List[Dict[str, Any]],
    generated_at: str,
) -> None:
    output = {
        "slug": "lab",
        "name": "MAPLab",
        "generated_at": generated_at,
        "source": "Shared BibTeX generated from Scopus Search; keyword cloud generated from publication titles",
        "title_based_keywords": True,
        "abstracts_used": False,
        "keywords": build_lab_keyword_cloud(bib_entries),
        "network": build_lab_network_from_bibtex(bib_entries, profiles),
    }
    write_json(Path(output_dir) / "lab.json", output)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Generate per-author Scopus analytics JSON.")
    parser.add_argument("--authors", default="scripts/scopus_authors.json")
    parser.add_argument("--people-index", default="data/people/people.json")
    parser.add_argument("--people-dir", default="data/people")
    parser.add_argument("--bibtex", default="data/publications.bib")
    parser.add_argument("--output-dir", default="data/scopus")
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

        print(f"Generating Scopus analytics for {name} ({slug}): {query}")

        try:
            entries = fetch_search_entries(session, query, max_results=args.max_results_per_author)
        except Exception as exc:
            print(f"Warning: could not fetch search entries for {name}: {exc}", file=sys.stderr)
            entries = []

        citation_counts = [parse_int(entry.get("citedby-count")) or 0 for entry in entries]
        titles = [normalize_space(entry.get("dc:title")) for entry in entries if normalize_space(entry.get("dc:title"))]
        bib_titles = bib_titles_for_profile(bib_entries, aliases)
        coauthors = coauthor_counts_from_bibtex(bib_entries, aliases)

        total_citations = sum(citation_counts) if citation_counts else None
        h_index = h_index_from_counts(citation_counts) if citation_counts else None

        output = {
            "slug": slug,
            "name": profile.get("name", name),
            "generated_at": now,
            "source": "Scopus Search API for citation counts; shared BibTeX for keywords/coauthor counts",
            "metrics": {
                "scopus_author_id": normalize_space(author.get("scopus_author_id")),
                "citation_count": total_citations,
                "cited_by_count": total_citations,
                "h_index": h_index,
            },
            "publications_analyzed": len(entries),
            "abstracts_found": 0,
            "keywords": keyword_counts(titles + bib_titles),
            "coauthors": coauthors,
        }

        write_json(Path(args.output_dir) / f"{slug}.json", output)
        time.sleep(args.sleep)

    write_labwide_analytics(
        output_dir=args.output_dir,
        profiles=profiles,
        bib_entries=bib_entries,
        generated_at=now,
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
