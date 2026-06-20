#!/usr/bin/env python3
"""
Build a static lab-wide coauthorship network for the MAPLab homepage.

Input:
- data/publications.bib
- data/people/people.json
- data/people/<slug>.json

Output:
- data/network/lab-network.json

This avoids client-side BibTeX parsing and avoids using stale/incomplete
data/scopus/lab.json.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter, OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Tuple


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
    "work", "works", "would", "analysis", "approach", "article", "case", "data",
    "evidence", "experimental", "findings", "method", "methods", "model", "models",
    "new", "performance", "possible", "process", "processing", "research", "response",
    "responses", "significant", "task", "tasks", "test", "toward", "towards",
}

# Single words that are too generic/noisy for a public-facing keyword cloud.
# They may still appear inside meaningful multi-word phrases.
NOISY_SINGLE_KEYWORDS = {
    "magnetic", "resonance", "imaging", "functional", "structural", "brain",
    "neural", "neuronal", "cortical", "cortex", "visual", "perceptual",
    "perception", "stimulus", "stimuli", "subject", "subjects", "observer",
    "observers", "healthy", "adult", "adults", "children", "patient", "patients",
    "modulation", "properties", "mechanisms", "system", "systems", "role",
    "relationship", "comparison", "different", "specific", "general",
    "eeg", "fmri", "mri"
}

# Phrases that read well as research themes. These are counted before generic
# n-grams so the cloud shows concepts, not fragments such as "magnetic".
CANONICAL_KEYWORD_PHRASES = {
    "active vision": [r"\bactive vision\b"],
    "adaptation": [r"\badaptation\b"],
    "attention": [r"\battention\b", r"\battentional\b"],
    "binocular vision": [r"\bbinocular vision\b"],
    "contrast sensitivity": [r"\bcontrast sensitivity\b"],
    "developmental dyslexia": [r"\bdevelopmental dyslexia\b", r"\bdyslexia\b"],
    "eye movements": [r"\beye movements?\b", r"\bsaccades?\b", r"\bmicrosaccades?\b"],
    "foveal vision": [r"\bfoveal\b", r"\bfoveola\b", r"\bfoveolar\b"],
    "magnetic resonance imaging": [
        r"\bmagnetic resonance imaging\b",
        r"\bfunctional magnetic resonance imaging\b",
        r"\bfmri\b",
        r"\bmri\b"
    ],
    "motion perception": [r"\bmotion perception\b", r"\bvisual motion\b"],
    "numerosity": [r"\bnumerosity\b", r"\bnumerical perception\b"],
    "psychophysics": [r"\bpsychophysics\b", r"\bpsychophysical\b"],
    "serial dependence": [r"\bserial dependence\b"],
    "spatial vision": [r"\bspatial vision\b", r"\bspatial resolution\b"],
    "symmetry perception": [r"\bsymmetry\b", r"\bsymmetrical\b"],
    "temporal processing": [r"\btemporal processing\b", r"\btemporal dynamics\b", r"\btemporal sensitivity\b"],
    "visual attention": [r"\bvisual attention\b"],
    "visual cortex": [r"\bvisual cortex\b", r"\bvisual cortical\b"],
    "visual perception": [r"\bvisual perception\b", r"\bperceptual organization\b"],
}



def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFD", normalize_space(value))
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.lower()
    value = re.sub(r"[.,]", " ", value)
    value = re.sub(r"[^a-z0-9 ]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


SURNAME_PARTICLES = {
    "da", "de", "del", "della", "di", "dos", "du", "la", "le",
    "van", "von", "der", "den", "ter", "ten", "st", "saint"
}


def author_signature(name: str) -> str:
    """Return a robust author signature: surname + first given-name initial.

    Examples:
    - "Burr, David C." -> "burr:d"
    - "David Burr" -> "burr:d"
    - "Del Viva, Maria Michela" -> "del viva:m"
    - "Maria Michela Del Viva" -> "del viva:m"
    - "De Vito, Giuseppe" -> "de vito:g"

    This intentionally ignores middle initials and small formatting differences.
    """
    raw = normalize_space(name)
    if not raw:
        return ""

    raw = re.sub(r"\b([A-Z])\.\s*", r"\1 ", raw)

    if "," in raw:
        parts = [normalize_space(part) for part in raw.split(",") if normalize_space(part)]
        surname_raw = parts[0] if parts else ""
        given_raw = " ".join(parts[1:]) if len(parts) > 1 else ""
    else:
        parts = [part for part in raw.split() if part]
        if not parts:
            return ""
        given_raw = parts[0]
        if len(parts) >= 2 and normalize_name(parts[-2]) in SURNAME_PARTICLES:
            surname_raw = " ".join(parts[-2:])
        else:
            surname_raw = parts[-1]

    surname = normalize_name(surname_raw)
    given = normalize_name(given_raw)
    first_initial = given[0] if given else ""

    if not surname:
        return ""
    return f"{surname}:{first_initial}" if first_initial else surname



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
        if at < 0:
            break
        brace = text.find("{", at)
        if brace < 0:
            break
        depth = 0
        end = brace
        while end < len(text):
            ch = text[end]
            if ch == "{":
                depth += 1
            elif ch == "}":
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
            start = pos
            end = start
            while end < len(body) and body[end] != ",":
                end += 1
            value = body[start:end]
            pos = end

        fields[name] = clean_bib_value(value)

        comma = body.find(",", pos)
        if comma < 0:
            break
        pos = comma + 1
    return fields


def parse_bibtex(text: str) -> List[Dict[str, Any]]:
    entries = []
    for raw in split_bib_entries(text):
        header = re.match(r"^@([^{]+)\{\s*([^,]+),", raw, flags=re.S)
        if not header:
            continue
        body = raw[header.end():-1]
        entries.append({
            "type": header.group(1).strip().lower(),
            "key": header.group(2).strip(),
            "fields": parse_bib_fields(body),
        })
    return entries


def split_bib_authors(author_field: str) -> List[str]:
    return [clean_bib_value(item).strip() for item in re.split(r"\s+and\s+", author_field or "", flags=re.I) if item.strip()]


def bib_author_display_name(author: str) -> str:
    author = clean_bib_value(author)
    if "," in author:
        parts = [part.strip() for part in author.split(",") if part.strip()]
        if len(parts) >= 2:
            return normalize_space(f"{' '.join(parts[1:])} {parts[0]}")
    return normalize_space(author)


def canonical_author_key(author: str) -> str:
    return author_signature(author)


def author_name_score(name: str) -> Tuple[int, int]:
    display = bib_author_display_name(name)
    full_parts = [part for part in re.split(r"\s+", display) if len(part.strip(".")) > 1]
    return (len(full_parts), len(display))


def aliases_for_profile(profile: Dict[str, Any]) -> List[str]:
    values = [profile.get("name"), profile.get("shortName")]
    aliases = profile.get("aliases", [])
    if isinstance(aliases, list):
        values.extend(aliases)
    out = []
    seen = set()
    for value in values:
        text = normalize_space(value)
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def name_matches_alias(name: str, aliases: List[str]) -> bool:
    name_sig = author_signature(name)
    if not name_sig:
        return False
    alias_sigs = {author_signature(alias) for alias in aliases if author_signature(alias)}
    return name_sig in alias_sigs



def normalize_keyword_text(text: str) -> str:
    text = unicodedata.normalize("NFD", normalize_space(text))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower()
    text = re.sub(r"[^a-z0-9à-ÿ\- ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def tokenize(text: str) -> List[str]:
    text = normalize_keyword_text(text)
    words = [word.strip("-") for word in text.split()]
    return [word for word in words if len(word) >= 4 and word not in STOPWORDS and not word.isdigit()]


def singularize_keyword(word: str) -> str:
    replacements = {
        "saccade": "eye movements",
        "saccades": "eye movements",
        "microsaccade": "eye movements",
        "microsaccades": "eye movements",
        "foveola": "foveal vision",
        "foveolar": "foveal vision",
        "foveal": "foveal vision",
        "psychophysical": "psychophysics",
        "attentional": "attention",
        "symmetrical": "symmetry perception",
        "numerosities": "numerosity",
    }
    if word in replacements:
        return replacements[word]
    if word.endswith("ies") and len(word) > 5:
        return word[:-3] + "y"
    if word.endswith("es") and len(word) > 5:
        return word[:-2]
    if word.endswith("s") and len(word) > 5:
        return word[:-1]
    return word


def keyword_counts(titles: List[str], max_keywords: int = 70) -> List[Dict[str, Any]]:
    """Extract public-facing research keywords from publication titles.

    The previous version counted single words too aggressively. That produced
    bad cloud entries such as "magnetic" instead of meaningful phrases such as
    "magnetic resonance imaging". This version prioritizes canonical phrases,
    then informative 2-3 word phrases, and uses single words only when they are
    domain-specific.
    """
    canonical: Counter[str] = Counter()
    ngrams: Counter[str] = Counter()
    unigrams: Counter[str] = Counter()

    for title in titles:
        normalized_title = normalize_keyword_text(title)

        for phrase, patterns in CANONICAL_KEYWORD_PHRASES.items():
            if any(re.search(pattern, normalized_title) for pattern in patterns):
                canonical[phrase] += 1

        words = [singularize_keyword(word) for word in tokenize(title)]
        # Remove multi-word replacements from the token stream before n-gramming.
        flat_words = []
        for word in words:
            if " " in word:
                canonical[word] += 1
                continue
            flat_words.append(word)

        words = flat_words

        for n in (3, 2):
            for gram in zip(*(words[i:] for i in range(n))):
                if len(set(gram)) < n:
                    continue
                phrase = " ".join(gram)
                if any(part in NOISY_SINGLE_KEYWORDS for part in gram) and n == 2:
                    continue
                if not any(part in NOISY_SINGLE_KEYWORDS for part in gram):
                    ngrams[phrase] += 1

        for word in words:
            if word in NOISY_SINGLE_KEYWORDS:
                continue
            unigrams[word] += 1

    combined: Counter[str] = Counter()

    # Canonical phrases should dominate because they are readable labels.
    for phrase, count in canonical.items():
        if count >= 1:
            combined[phrase] += count * 3

    # Add recurrent n-grams if they are not just fragments of already selected phrases.
    selected_phrases = set(combined)
    for phrase, count in ngrams.items():
        if count < 2:
            continue
        if any(phrase in selected or selected in phrase for selected in selected_phrases):
            continue
        combined[phrase] += count * 2

    # Add domain-specific unigrams only when they are not swallowed by a phrase.
    for word, count in unigrams.items():
        if count < 2:
            continue
        if any(word in phrase.split() for phrase in selected_phrases):
            continue
        combined[word] += count

    if not combined:
        for word, count in unigrams.items():
            if word not in NOISY_SINGLE_KEYWORDS:
                combined[word] += count

    # Avoid showing a noisy single word next to its meaningful phrase.
    for noisy in list(NOISY_SINGLE_KEYWORDS):
        combined.pop(noisy, None)

    return [
        {"text": text, "value": int(value)}
        for text, value in combined.most_common(max_keywords)
    ]


def load_profiles(people_index: Path, people_dir: Path) -> Dict[str, Dict[str, Any]]:
    profiles: Dict[str, Dict[str, Any]] = OrderedDict()
    for entry in load_json(people_index):
        slug = entry.get("slug")
        if not slug:
            continue
        path = people_dir / f"{slug}.json"
        if path.exists():
            profile = load_json(path)
        else:
            profile = dict(entry)
        profile["slug"] = slug
        profile.setdefault("name", entry.get("name") or entry.get("fullName") or slug)
        profile.setdefault("category", entry.get("category") or entry.get("group") or "")
        profiles[slug] = profile
    return profiles


def lab_profiles_for_entry(entry: Dict[str, Any], authors: List[str], profiles: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    fields = entry.get("fields", {})

    explicit_slugs = [
        item.strip()
        for item in re.split(r"\s*(?:;|\||,)\s*", fields.get("maplab_slugs", ""))
        if item.strip()
    ]
    matched = [profiles[slug] for slug in explicit_slugs if slug in profiles]
    if matched:
        return list(OrderedDict((profile["slug"], profile) for profile in matched).values())

    maplab_people = [
        item.strip()
        for item in re.split(r"\s*(?:;|\||, and | and )\s*", fields.get("maplab_people", "") or fields.get("maplab_person", ""), flags=re.I)
        if item.strip()
    ]
    matched = []
    for name in maplab_people:
        for profile in profiles.values():
            if name_matches_alias(name, aliases_for_profile(profile)):
                matched.append(profile)
    if matched:
        return list(OrderedDict((profile["slug"], profile) for profile in matched).values())

    matched = []
    for author in authors:
        for profile in profiles.values():
            if name_matches_alias(author, aliases_for_profile(profile)):
                matched.append(profile)
    return list(OrderedDict((profile["slug"], profile) for profile in matched).values())


def build_network(entries: List[Dict[str, Any]], profiles: Dict[str, Dict[str, Any]], max_external: int) -> Dict[str, Any]:
    nodes: Dict[str, Dict[str, Any]] = {}
    best_names: Dict[str, str] = {}
    edges: Counter[Tuple[str, str]] = Counter()
    titles: List[str] = []

    def ensure_node(node_id: str, name: str, node_type: str, category: str = "", cluster: int = 0) -> Dict[str, Any]:
        if node_id not in nodes:
            nodes[node_id] = {
                "id": node_id,
                "name": name,
                "type": node_type,
                "category": category,
                "documents": 0,
                "total_link_strength": 0,
                "cluster": cluster,
            }
        return nodes[node_id]

    def add_edge(a: str, b: str) -> None:
        if not a or not b or a == b:
            return
        pair = (a, b) if a < b else (b, a)
        edges[pair] += 1

    profile_slugs = list(profiles.keys())
    profile_cluster = {slug: idx for idx, slug in enumerate(profile_slugs)}

    for entry in entries:
        fields = entry.get("fields", {})
        if fields.get("title"):
            titles.append(fields["title"])

        authors = [bib_author_display_name(author) for author in split_bib_authors(fields.get("author", ""))]
        authors = [author for author in authors if author]

        lab_profiles = lab_profiles_for_entry(entry, authors, profiles)
        if not lab_profiles:
            continue

        participants: List[str] = []
        seen = set()

        for profile in lab_profiles:
            slug = profile["slug"]
            node = ensure_node(slug, profile.get("name", slug), "lab", profile.get("category", ""), profile_cluster.get(slug, 0))
            if slug not in seen:
                seen.add(slug)
                participants.append(slug)
                node["documents"] += 1

        for author in authors:
            matched_lab = None
            for profile in profiles.values():
                if name_matches_alias(author, aliases_for_profile(profile)):
                    matched_lab = profile
                    break

            if matched_lab is not None:
                slug = matched_lab["slug"]
                node = ensure_node(slug, matched_lab.get("name", slug), "lab", matched_lab.get("category", ""), profile_cluster.get(slug, 0))
                if slug not in seen:
                    seen.add(slug)
                    participants.append(slug)
                    node["documents"] += 1
                continue

            key = canonical_author_key(author)
            if not key:
                continue
            node_id = f"co:{key}"
            previous = best_names.get(node_id)
            if previous is None or author_name_score(author) > author_name_score(previous):
                best_names[node_id] = author

            node = ensure_node(node_id, best_names.get(node_id, author), "external", "", 0)
            node["name"] = best_names.get(node_id, author)

            if node_id not in seen:
                seen.add(node_id)
                participants.append(node_id)
                node["documents"] += 1

        if len(participants) < 2:
            continue

        for i, source in enumerate(participants):
            for target in participants[i + 1:]:
                add_edge(source, target)

    for (source, target), count in edges.items():
        if source in nodes:
            nodes[source]["total_link_strength"] += count
        if target in nodes:
            nodes[target]["total_link_strength"] += count

    lab_nodes = [nodes.get(slug) or ensure_node(slug, profile.get("name", slug), "lab", profile.get("category", ""), profile_cluster.get(slug, 0)) for slug, profile in profiles.items()]
    external_nodes = [node for node in nodes.values() if node.get("type") != "lab"]
    external_nodes.sort(key=lambda node: (-int(node.get("total_link_strength", 0)), -int(node.get("documents", 0)), normalize_name(node.get("name", ""))))
    external_nodes = external_nodes[:max_external]

    kept_ids = {node["id"] for node in lab_nodes + external_nodes}
    edge_list = [
        {"source": source, "target": target, "count": int(count), "type": "coauthorship"}
        for (source, target), count in edges.items()
        if source in kept_ids and target in kept_ids
    ]
    edge_list.sort(key=lambda item: (-item["count"], item["source"], item["target"]))

    # Assign external clusters by strongest connected lab member.
    lab_ids = {node["id"] for node in lab_nodes}
    strongest_lab: Dict[str, Tuple[str, int]] = {}
    for edge in edge_list:
        source, target, count = edge["source"], edge["target"], int(edge["count"])
        if source in lab_ids and target not in lab_ids:
            current = strongest_lab.get(target)
            if current is None or count > current[1]:
                strongest_lab[target] = (source, count)
        elif target in lab_ids and source not in lab_ids:
            current = strongest_lab.get(source)
            if current is None or count > current[1]:
                strongest_lab[source] = (target, count)

    for node in external_nodes:
        lab_id = strongest_lab.get(node["id"], (profile_slugs[0] if profile_slugs else "", 0))[0]
        node["cluster"] = profile_cluster.get(lab_id, 0)

    return {
        "nodes": lab_nodes + external_nodes,
        "edges": edge_list,
        "stats": {
            "lab_members": len(lab_nodes),
            "external_collaborators": len(external_nodes),
            "edges": len(edge_list),
        },
        "keywords": keyword_counts(titles),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build static MAPLab coauthorship network.")
    parser.add_argument("--bibtex", default="data/publications.bib")
    parser.add_argument("--people-index", default="data/people/people.json")
    parser.add_argument("--people-dir", default="data/people")
    parser.add_argument("--output", default="data/network/lab-network.json")
    parser.add_argument("--max-external", type=int, default=600)
    args = parser.parse_args()

    bib_path = Path(args.bibtex)
    if not bib_path.exists():
        raise FileNotFoundError(f"Missing BibTeX file: {bib_path}")

    profiles = load_profiles(Path(args.people_index), Path(args.people_dir))
    entries = parse_bibtex(bib_path.read_text(encoding="utf-8"))
    network = build_network(entries, profiles, args.max_external)

    output = {
        "slug": "lab",
        "name": "MAPLab",
        "source": "Static network generated from data/publications.bib",
        "title_based_keywords": True,
        "abstracts_used": False,
        "keywords": network.pop("keywords", []),
        "network": network,
    }
    write_json(Path(args.output), output)

    stats = output["network"]["stats"]
    print(
        f"Wrote {args.output}: {stats['lab_members']} lab members, "
        f"{stats['external_collaborators']} external collaborators, {stats['edges']} edges"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
