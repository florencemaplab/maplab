(function () {
  "use strict";

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
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
      .replace(/'/g, "&#039;");
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

    for (let i = startIndex; i < text.length; i += 1) {
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
      if (depth === 0) {
        return { value: text.slice(startIndex + 1, i), end: i + 1 };
      }
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
        entries.push({
          type,
          key: content.slice(0, comma).trim(),
          fields: parseFields(content.slice(comma + 1))
        });
      }

      i = parsed.end;
    }

    return entries;
  }

  function splitNames(value) {
    return String(value || "")
      .split(/\s+and\s+|[|;]/i)
      .map((name) => name.trim())
      .filter(Boolean);
  }

  function nameVariants(name) {
    const raw = String(name || "").trim();
    const variants = new Set();
    if (!raw) return [];

    variants.add(normalize(raw));

    if (raw.includes(",")) {
      const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const surname = parts[0];
        const given = parts.slice(1).join(" ");
        variants.add(normalize(`${given} ${surname}`));
        variants.add(normalize(`${surname} ${given}`));
        const initials = given.split(/\s+/).filter(Boolean).map((part) => part[0]).join(" ");
        if (initials) {
          variants.add(normalize(`${initials} ${surname}`));
          variants.add(normalize(`${surname} ${initials}`));
        }
      }
    } else {
      const parts = raw.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const surname = parts[parts.length - 1];
        const given = parts.slice(0, -1).join(" ");
        variants.add(normalize(`${surname}, ${given}`));
        variants.add(normalize(`${surname} ${given}`));
        const initials = parts.slice(0, -1).map((part) => part[0]).join(" ");
        if (initials) {
          variants.add(normalize(`${surname}, ${initials}`));
          variants.add(normalize(`${surname} ${initials}`));
          variants.add(normalize(`${initials} ${surname}`));
        }
      }
    }

    return Array.from(variants).filter(Boolean);
  }

  function namesMatch(candidate, alias) {
    const candidateVariants = nameVariants(candidate);
    const aliasVariants = nameVariants(alias);

    return candidateVariants.some((candidateVariant) =>
      aliasVariants.some((aliasVariant) => {
        if (!candidateVariant || !aliasVariant) return false;
        if (candidateVariant === aliasVariant) return true;
        if (candidateVariant.length >= 8 && aliasVariant.length >= 8) {
          return candidateVariant.includes(aliasVariant) || aliasVariant.includes(candidateVariant);
        }
        return false;
      })
    );
  }

  function entryBelongsToPerson(entry, aliases) {
    const maplabPeople = splitNames(entry.fields.maplab_people || "");
    if (maplabPeople.some((person) => aliases.some((alias) => namesMatch(person, alias)))) {
      return true;
    }

    const authors = splitNames(entry.fields.author || "");
    return authors.some((author) => aliases.some((alias) => namesMatch(author, alias)));
  }

  function formatAuthors(authorField) {
    return splitNames(authorField)
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
    const title = htmlEscape(f.title || "Untitled publication");
    const authors = htmlEscape(formatAuthors(f.author || ""));
    const venue = htmlEscape(venueLine(entry));
    const doi = String(f.doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
    const url = f.url || (doi ? `https://doi.org/${doi}` : "");
    const searchable = htmlEscape(normalize(`${f.title} ${formatAuthors(f.author)} ${f.maplab_people} ${venueLine(entry)} ${doi}`));
    const linkedTitle = url ? `<a href="${htmlEscape(url)}">${title}</a>` : title;

    return `
      <li class="publication" data-search="${searchable}">
        <div class="publication-title">${linkedTitle}</div>
        ${authors ? `<div class="publication-authors">${authors}</div>` : ""}
        ${venue ? `<div class="publication-meta">${venue}</div>` : ""}
        ${doi ? `<div class="publication-links"><a href="https://doi.org/${htmlEscape(doi)}">DOI</a></div>` : ""}
      </li>
    `;
  }

  function groupEntriesByYear(entries) {
    return entries.reduce((groups, entry) => {
      const year = String(bibYear(entry) || "n.d.");
      if (!groups[year]) groups[year] = [];
      groups[year].push(entry);
      return groups;
    }, {});
  }

  function sortedYearsFromEntries(entries) {
    return Array.from(new Set(entries.map((entry) => String(bibYear(entry) || "n.d."))))
      .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));
  }

  function renderGroupedPublications(entries) {
    const groups = groupEntriesByYear(entries);
    const years = Object.keys(groups).sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));

    return years.map((year) => {
      const items = groups[year].sort((a, b) => normalize(a.fields.title).localeCompare(normalize(b.fields.title)));
      return `
        <section class="publication-year" data-publication-year data-year="${htmlEscape(year)}">
          <h3><span>${htmlEscape(year)}</span><small>${items.length} publication${items.length === 1 ? "" : "s"}</small></h3>
          <ol class="year-publications">
            ${items.map(renderPublication).join("")}
          </ol>
        </section>
      `;
    }).join("");
  }

  function renderYearFilter(years) {
    if (years.length <= 1) return null;
    const wrapper = document.createElement("div");
    wrapper.className = "year-filter";
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", "Filter publications by year");

    ["all", ...years].forEach((year) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "year-filter-button";
      button.dataset.year = year;
      button.textContent = year === "all" ? "All years" : year;
      button.setAttribute("aria-pressed", year === "all" ? "true" : "false");
      if (year === "all") button.classList.add("is-active");
      wrapper.appendChild(button);
    });

    return wrapper;
  }

  function countLabel(number, activeYear) {
    const base = `${number} publication${number === 1 ? "" : "s"}`;
    return activeYear && activeYear !== "all" ? `${base} in ${activeYear}` : base;
  }

  async function initPublications() {
    const list = document.querySelector("[data-publications-list]");
    if (!list) return;

    const count = document.querySelector("[data-publications-count]");
    const input = document.querySelector("[data-publications-search]");
    const tools = document.querySelector(".publication-tools");
    const bibUrl = document.body.dataset.bibUrl || "../data/publications.bib";
    const aliases = String(document.body.dataset.authorAliases || "")
      .split("|")
      .map((alias) => alias.trim())
      .filter(Boolean);

    let activeYear = "all";

    function updatePublicationsVisibility() {
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
      const separator = bibUrl.includes("?") ? "&" : "?";
      const response = await fetch(`${bibUrl}${separator}t=${Date.now()}`, { cache: "no-store" });
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

      list.innerHTML = renderGroupedPublications(entries);

      const years = sortedYearsFromEntries(entries);
      const filter = renderYearFilter(years);
      if (filter && tools) {
        const oldFilter = tools.querySelector(".year-filter");
        if (oldFilter) oldFilter.remove();
        tools.insertBefore(filter, count || null);

        filter.addEventListener("click", (event) => {
          const button = event.target.closest("button[data-year]");
          if (!button) return;

          activeYear = button.dataset.year || "all";
          filter.querySelectorAll("button[data-year]").forEach((item) => {
            const selected = item === button;
            item.classList.toggle("is-active", selected);
            item.setAttribute("aria-pressed", selected ? "true" : "false");
          });
          updatePublicationsVisibility();
        });
      }

      if (input) input.addEventListener("input", updatePublicationsVisibility);
      updatePublicationsVisibility();
    } catch (error) {
      list.innerHTML = `<div class="note">Could not load publications from <code>${htmlEscape(bibUrl)}</code>: ${htmlEscape(error.message)}</div>`;
      if (count) count.textContent = "Publications unavailable";
      console.error(error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPublications);
  } else {
    initPublications();
  }
})();
