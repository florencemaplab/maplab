(function () {
  "use strict";

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function htmlEscape(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function unescapeBibTeX(value) {
    return String(value || "")
      .replace(/\\&/g, "&")
      .replace(/\\%/g, "%")
      .replace(/\\\$/g, "$")
      .replace(/\\#/g, "#")
      .replace(/\\_/g, "_")
      .replace(/\\\{/g, "{")
      .replace(/\\\}/g, "}")
      .replace(/\\textbackslash\{\}/g, "\\")
      .replace(/\\textasciitilde\{\}/g, "~")
      .replace(/\\textasciicircum\{\}/g, "^")
      .replace(/[{}]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function readBalanced(text, startIndex, openChar, closeChar) {
    let depth = 0;
    let escaped = false;
    for (let i = startIndex; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === openChar) depth += 1;
      if (ch === closeChar) depth -= 1;
      if (depth === 0) return { value: text.slice(startIndex + 1, i), end: i + 1 };
    }
    return { value: text.slice(startIndex + 1), end: text.length };
  }

  function parseFields(body) {
    const fields = {};
    let i = 0;

    while (i < body.length) {
      while (i < body.length && /[\s,]/.test(body[i])) i += 1;
      const nameStart = i;
      while (i < body.length && /[A-Za-z0-9_:-]/.test(body[i])) i += 1;
      const fieldName = body.slice(nameStart, i).trim().toLowerCase();
      if (!fieldName) break;

      while (i < body.length && /\s/.test(body[i])) i += 1;
      if (body[i] !== "=") break;
      i += 1;
      while (i < body.length && /\s/.test(body[i])) i += 1;

      let value = "";
      if (body[i] === "{") {
        const parsed = readBalanced(body, i, "{", "}");
        value = parsed.value;
        i = parsed.end;
      } else if (body[i] === '"') {
        const parsed = readBalanced(body, i, '"', '"');
        value = parsed.value;
        i = parsed.end;
      } else {
        const valueStart = i;
        while (i < body.length && body[i] !== ",") i += 1;
        value = body.slice(valueStart, i);
      }

      fields[fieldName] = unescapeBibTeX(value);
      while (i < body.length && body[i] !== ",") i += 1;
      if (body[i] === ",") i += 1;
    }

    return fields;
  }

  function parseBibTeX(text) {
    const entries = [];
    let i = 0;

    while (i < text.length) {
      const at = text.indexOf("@", i);
      if (at === -1) break;
      const typeMatch = /^@\s*([A-Za-z]+)\s*\{/.exec(text.slice(at));
      if (!typeMatch) {
        i = at + 1;
        continue;
      }

      const type = typeMatch[1].toLowerCase();
      const openIndex = at + typeMatch[0].lastIndexOf("{");
      const parsed = readBalanced(text, openIndex, "{", "}");
      const content = parsed.value;
      const comma = content.indexOf(",");
      if (comma !== -1) {
        const key = content.slice(0, comma).trim();
        const body = content.slice(comma + 1);
        entries.push({ type, key, fields: parseFields(body) });
      }
      i = parsed.end;
    }

    return entries;
  }

  function nameVariants(name) {
    const raw = String(name || "").trim();
    const out = new Set();
    if (!raw) return [];

    out.add(normalize(raw));

    if (raw.includes(",")) {
      const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const surname = parts[0];
        const given = parts.slice(1).join(" ");
        out.add(normalize(`${given} ${surname}`));
        const initials = given
          .split(/\s+/)
          .filter(Boolean)
          .map((part) => part[0])
          .join(" ");
        if (initials) out.add(normalize(`${initials} ${surname}`));
      }
    } else {
      const parts = raw.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const surname = parts[parts.length - 1];
        const given = parts.slice(0, -1).join(" ");
        out.add(normalize(`${surname}, ${given}`));
        const initials = parts.slice(0, -1).map((part) => part[0]).join(" ");
        if (initials) out.add(normalize(`${surname}, ${initials}`));
      }
    }

    return Array.from(out).filter(Boolean);
  }

  function namesMatch(candidate, alias) {
    const candidates = nameVariants(candidate);
    const aliases = nameVariants(alias);
    return candidates.some((candidateVariant) =>
      aliases.some((aliasVariant) => {
        if (!candidateVariant || !aliasVariant) return false;
        if (candidateVariant === aliasVariant) return true;
        return (
          candidateVariant.length >= 8 &&
          aliasVariant.length >= 8 &&
          (candidateVariant.includes(aliasVariant) || aliasVariant.includes(candidateVariant))
        );
      })
    );
  }

  function splitPeopleField(value) {
    return String(value || "")
      .split(/\s+and\s+|[|;]/i)
      .map((name) => name.trim())
      .filter(Boolean);
  }

  function splitAuthorField(value) {
    return String(value || "")
      .split(/\s+and\s+/i)
      .map((name) => name.trim())
      .filter(Boolean);
  }

  function entryBelongsToPerson(entry, aliases) {
    const people = splitPeopleField(entry.fields.maplab_people || "");
    if (people.some((person) => aliases.some((alias) => namesMatch(person, alias)))) return true;

    const authors = splitAuthorField(entry.fields.author || "");
    return authors.some((authorName) => aliases.some((alias) => namesMatch(authorName, alias)));
  }

  function formatAuthors(authorField) {
    return splitAuthorField(authorField)
      .map((name) => {
        const parts = name.split(",").map((part) => part.trim()).filter(Boolean);
        if (parts.length >= 2) return `${parts.slice(1).join(" ")} ${parts[0]}`.replace(/\s+/g, " ");
        return name;
      })
      .join(", ");
  }

  function bibYear(entry) {
    const match = String(entry.fields.year || "").match(/(19|20)\d{2}/);
    return match ? Number(match[0]) : 0;
  }

  function venueLine(entry) {
    const f = entry.fields;
    const parts = [];
    if (f.journal) parts.push(f.journal);
    if (f.booktitle) parts.push(f.booktitle);
    if (f.volume) parts.push(f.volume);
    if (f.number) parts.push(`(${f.number})`);
    if (f.pages) parts.push(f.pages);
    if (f.year) parts.push(f.year);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function renderPublication(entry) {
    const f = entry.fields;
    const title = htmlEscape(f.title || "Untitled");
    const authors = htmlEscape(formatAuthors(f.author || ""));
    const venue = htmlEscape(venueLine(entry));
    const doi = f.doi || "";
    const url = f.url || (doi ? `https://doi.org/${doi}` : "");
    const searchText = htmlEscape(normalize(`${f.title} ${formatAuthors(f.author)} ${venueLine(entry)} ${doi}`));

    return `
      <article class="publication" data-search="${searchText}">
        <div class="publication-title">${url ? `<a href="${htmlEscape(url)}" target="_blank" rel="noopener">${title}</a>` : title}</div>
        ${authors ? `<div class="publication-authors">${authors}</div>` : ""}
        ${venue ? `<div class="publication-venue">${venue}</div>` : ""}
        ${doi ? `<div class="publication-links"><a href="${htmlEscape(`https://doi.org/${doi}`)}" target="_blank" rel="noopener">DOI</a></div>` : ""}
      </article>
    `;
  }

  function renderGroupedPublications(entries) {
    const groups = new Map();
    entries.forEach((entry) => {
      const year = String(bibYear(entry) || "n.d.");
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(entry);
    });

    return Array.from(groups.entries())
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([year, items]) => `
        <section class="publication-year" data-publication-year data-year="${htmlEscape(year)}">
          <h3>${htmlEscape(year)}</h3>
          ${items.map(renderPublication).join("")}
        </section>
      `)
      .join("");
  }

  function countLabel(number, activeYear) {
    const base = `${number} publication${number === 1 ? "" : "s"}`;
    return activeYear && activeYear !== "all" ? `${base} in ${activeYear}` : base;
  }

  function renderYearFilters(entries, activeYear, onChange) {
    const tools = document.querySelector(".publication-tools");
    if (!tools) return;

    let filters = tools.querySelector(".year-filters");
    if (!filters) {
      filters = document.createElement("div");
      filters.className = "year-filters";
      tools.appendChild(filters);
    }

    const years = Array.from(new Set(entries.map((entry) => String(bibYear(entry) || "n.d.")))).sort((a, b) => Number(b) - Number(a));
    filters.innerHTML = ["all"].concat(years).map((year) => {
      const label = year === "all" ? "All years" : year;
      const selected = activeYear === year;
      return `<button type="button" class="year-filter${selected ? " active" : ""}" data-year-filter="${htmlEscape(year)}">${htmlEscape(label)}</button>`;
    }).join("");

    filters.querySelectorAll("[data-year-filter]").forEach((button) => {
      button.addEventListener("click", () => onChange(button.dataset.yearFilter || "all"));
    });
  }

  async function initPublications() {
    const list = document.querySelector("[data-publications-list]");
    if (!list) return;

    const count = document.querySelector("[data-publications-count]");
    const input = document.querySelector("[data-publications-search]");
    const bibUrl = document.body.dataset.bibUrl || "../data/publications.bib";
    const aliases = String(document.body.dataset.authorAliases || "")
      .split("|")
      .map((alias) => alias.trim())
      .filter(Boolean);

    let activeYear = "all";

    function updateVisibility() {
      const query = normalize(input ? input.value : "");
      let visible = 0;

      list.querySelectorAll("[data-publication-year]").forEach((group) => {
        const yearMatches = activeYear === "all" || group.dataset.year === activeYear;
        let groupVisible = 0;
        group.querySelectorAll(".publication").forEach((item) => {
          const textMatches = item.dataset.search.includes(query);
          const show = yearMatches && textMatches;
          item.hidden = !show;
          if (show) {
            visible += 1;
            groupVisible += 1;
          }
        });
        group.hidden = groupVisible === 0;
      });

      if (count) count.textContent = countLabel(visible, activeYear);
    }

    try {
      const response = await fetch(bibUrl);
      if (!response.ok) throw new Error(`Could not load ${bibUrl}`);
      const bibText = await response.text();
      const entries = parseBibTeX(bibText)
        .filter((entry) => entryBelongsToPerson(entry, aliases))
        .sort((a, b) => bibYear(b) - bibYear(a));

      if (!entries.length) {
        list.innerHTML = `<div class="note">No publications found for this author in <code>${htmlEscape(bibUrl)}</code>.</div>`;
        if (count) count.textContent = "0 publications";
        return;
      }

      const changeYear = (year) => {
        activeYear = year;
        renderYearFilters(entries, activeYear, changeYear);
        updateVisibility();
      };

      list.innerHTML = renderGroupedPublications(entries);
      renderYearFilters(entries, activeYear, changeYear);
      if (input) input.addEventListener("input", updateVisibility);
      updateVisibility();
    } catch (error) {
      list.innerHTML = `<div class="note">Could not load publications from <code>${htmlEscape(bibUrl)}</code>: ${htmlEscape(error.message)}</div>`;
      if (count) count.textContent = "Publications unavailable";
    }
  }

  document.addEventListener("DOMContentLoaded", initPublications);
})();
