(function () {
  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function splitBibEntries(text) {
    const entries = [];
    let i = 0;
    while (i < text.length) {
      const at = text.indexOf("@", i);
      if (at === -1) break;
      const brace = text.indexOf("{", at);
      if (brace === -1) break;
      let depth = 0;
      let end = brace;
      for (; end < text.length; end++) {
        if (text[end] === "{") depth++;
        if (text[end] === "}") depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
      entries.push(text.slice(at, end));
      i = end;
    }
    return entries;
  }

  function parseFields(body) {
    const fields = {};
    let pos = 0;

    while (pos < body.length) {
      const match = body.slice(pos).match(/\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*/);
      if (!match) break;
      pos += match.index + match[0].length;
      const name = match[1].toLowerCase();
      let value = "";

      if (body[pos] === "{") {
        let depth = 0;
        let start = pos + 1;
        let end = start;
        for (; end < body.length; end++) {
          if (body[end] === "{") depth++;
          if (body[end] === "}") {
            if (depth === 0) break;
            depth--;
          }
        }
        value = body.slice(start, end);
        pos = end + 1;
      } else if (body[pos] === '"') {
        let start = pos + 1;
        let end = start;
        while (end < body.length && body[end] !== '"') end++;
        value = body.slice(start, end);
        pos = end + 1;
      } else {
        let end = pos;
        while (end < body.length && body[end] !== ",") end++;
        value = body.slice(pos, end).trim();
        pos = end;
      }

      fields[name] = value.replace(/\s+/g, " ").trim();
      const comma = body.indexOf(",", pos);
      if (comma === -1) break;
      pos = comma + 1;
    }
    return fields;
  }

  function parseBibTeX(text) {
    return splitBibEntries(text)
      .map((raw) => {
        const header = raw.match(/^@([^{]+)\{\s*([^,]+),/);
        if (!header) return null;
        const body = raw.slice(header[0].length, -1);
        return {
          type: header[1].trim().toLowerCase(),
          key: header[2].trim(),
          fields: parseFields(body)
        };
      })
      .filter(Boolean);
  }

  function authorNameVariants(name) {
    const raw = String(name || "").trim();
    const variants = new Set();
    const add = (value) => {
      const normalized = normalize(value);
      if (normalized) variants.add(normalized);
    };

    add(raw);

    // BibTeX often stores authors as "Surname, Given Names".
    // Page aliases are usually "Given Names Surname". Keep both orders.
    if (raw.includes(",")) {
      const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const surname = parts[0];
        const given = parts.slice(1).join(" ");
        add(`${given} ${surname}`);
        add(`${surname} ${given}`);
      }
    } else {
      const parts = raw.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const given = parts.slice(0, -1).join(" ");
        const surname = parts[parts.length - 1];
        add(`${surname} ${given}`);
        add(`${given} ${surname}`);
      }
    }

    return Array.from(variants);
  }

  function namesMatch(authorName, alias) {
    const authorVariants = authorNameVariants(authorName);
    const aliasVariants = authorNameVariants(alias);

    return authorVariants.some((authorVariant) =>
      aliasVariants.some((aliasVariant) => {
        if (!authorVariant || !aliasVariant) return false;
        if (authorVariant === aliasVariant) return true;
        // Allow middle names/initials without making very short aliases unsafe.
        return (
          aliasVariant.length >= 8 &&
          authorVariant.length >= 8 &&
          (authorVariant.includes(aliasVariant) || aliasVariant.includes(authorVariant))
        );
      })
    );
  }

  function authorsContain(entry, aliases) {
    const authorField = entry.fields.author || "";
    const authors = authorField
      .split(/\s+and\s+/i)
      .map((name) => name.trim())
      .filter(Boolean);

    return authors.some((authorName) =>
      aliases.some((alias) => namesMatch(authorName, alias))
    );
  }

  function formatAuthors(authorField) {
    if (!authorField) return "";
    return authorField
      .split(/\s+and\s+/i)
      .map((name) => {
        const parts = name.split(",").map((part) => part.trim());
        if (parts.length >= 2) return `${parts[1]} ${parts[0]}`.replace(/\s+/g, " ");
        return name.trim();
      })
      .join(", ");
  }

  function htmlEscape(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function bibYear(entry) {
    const year = Number.parseInt(entry.fields.year, 10);
    return Number.isFinite(year) ? year : 0;
  }

  function venueLine(entry) {
    const f = entry.fields;
    const venue = f.journal || f.booktitle || f.publisher || "";
    const volume = f.volume || "";
    const number = f.number || "";
    const pages = f.pages || "";
    const volumeIssue = volume && number ? `${volume}(${number})` : volume;
    return [venue, volumeIssue, pages].filter(Boolean).join(", ");
  }

  function publicationHTML(entry) {
    const f = entry.fields;
    const title = htmlEscape(f.title || "Untitled publication");
    const authors = htmlEscape(formatAuthors(f.author));
    const venue = htmlEscape(venueLine(entry));
    const year = htmlEscape(f.year || "n.d.");
    const doi = (f.doi || "").replace(/^https?:\/\/doi.org\//i, "");
    const url = f.url || (doi ? `https://doi.org/${doi}` : "");
    const searchable = htmlEscape(normalize(`${f.title} ${formatAuthors(f.author)} ${venueLine(entry)} ${f.year} ${doi}`));

    const linkedTitle = url
      ? `<a href="${htmlEscape(url)}">${title}</a>`
      : title;

    const links = [];
    if (doi) links.push(`<a href="https://doi.org/${htmlEscape(doi)}">DOI</a>`);
    else if (url) links.push(`<a href="${htmlEscape(url)}">Link</a>`);

    return `
      <li class="publication" data-search="${searchable}">
        <div class="publication-title">${linkedTitle}</div>
        <div class="publication-authors">${authors}</div>
        <div class="publication-meta">${[venue, year].filter(Boolean).join(" · ")}</div>
        ${links.length ? `<div class="publication-links">${links.join(" ")}</div>` : ""}
      </li>
    `;
  }

  function groupEntriesByYear(entries) {
    return entries.reduce((groups, entry) => {
      const year = entry.fields.year || "n.d.";
      if (!groups[year]) groups[year] = [];
      groups[year].push(entry);
      return groups;
    }, {});
  }

  function sortedYearsFromEntries(entries) {
    return Array.from(new Set(entries.map((entry) => entry.fields.year || "n.d.")))
      .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));
  }

  function renderGroupedPublications(entries) {
    const groups = groupEntriesByYear(entries);
    const years = Object.keys(groups).sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));

    return years
      .map((year) => {
        const items = groups[year].sort((a, b) => {
          const titleA = normalize(a.fields.title || "");
          const titleB = normalize(b.fields.title || "");
          return titleA.localeCompare(titleB);
        });
        const count = items.length;
        return `
          <section class="publication-year" data-publication-year data-year="${htmlEscape(year)}">
            <h3>
              <span>${htmlEscape(year)}</span>
              <small>${count} publication${count === 1 ? "" : "s"}</small>
            </h3>
            <ol class="year-publications">
              ${items.map(publicationHTML).join("")}
            </ol>
          </section>
        `;
      })
      .join("");
  }

  function renderYearFilter(years) {
    if (years.length <= 1) return null;

    const wrapper = document.createElement("div");
    wrapper.className = "year-filter";
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", "Filter publications by year");

    const buttons = ["all", ...years];
    buttons.forEach((year) => {
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
    const aliases = (document.body.dataset.authorAliases || "")
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
            visible++;
            groupVisible++;
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
        .filter((entry) => authorsContain(entry, aliases))
        .sort((a, b) => bibYear(b) - bibYear(a));

      if (!entries.length) {
        list.innerHTML = `<div class="note">No publications found for this author in <code>${htmlEscape(bibUrl)}</code>. Add BibTeX entries containing one of the author aliases in this page.</div>`;
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

          activeYear = button.dataset.year;
          filter.querySelectorAll("button[data-year]").forEach((item) => {
            const selected = item === button;
            item.classList.toggle("is-active", selected);
            item.setAttribute("aria-pressed", selected ? "true" : "false");
          });
          updatePublicationsVisibility();
        });
      }

      if (input) {
        input.addEventListener("input", updatePublicationsVisibility);
      }

      updatePublicationsVisibility();
    } catch (error) {
      list.innerHTML = `<div class="note">Could not load publications. Check that <code>${htmlEscape(bibUrl)}</code> exists and is published with the site.</div>`;
      if (count) count.textContent = "Publications unavailable";
      console.error(error);
    }
  }

  initPublications();
})();
