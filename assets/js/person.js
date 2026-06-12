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
    return splitBibEntries(text).map((raw) => {
      const header = raw.match(/^@([^{]+)\{\s*([^,]+),/);
      if (!header) return null;
      const body = raw.slice(header[0].length, -1);
      return {
        type: header[1].trim().toLowerCase(),
        key: header[2].trim(),
        fields: parseFields(body)
      };
    }).filter(Boolean);
  }

  function authorsContain(entry, aliases) {
    const authorField = entry.fields.author || "";
    const normalizedAuthorField = normalize(authorField.replace(/\band\b/gi, " "));
    return aliases.some((alias) => normalizedAuthorField.includes(normalize(alias)));
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

  function publicationHTML(entry) {
    const f = entry.fields;
    const title = htmlEscape(f.title || "Untitled publication");
    const authors = htmlEscape(formatAuthors(f.author));
    const venue = htmlEscape(f.journal || f.booktitle || f.publisher || "");
    const year = htmlEscape(f.year || "");
    const volume = htmlEscape(f.volume || "");
    const number = htmlEscape(f.number || "");
    const pages = htmlEscape(f.pages || "");
    const doi = (f.doi || "").replace(/^https?:\/\/doi.org\//i, "");
    const url = f.url || (doi ? `https://doi.org/${doi}` : "");

    const venueBits = [venue, volume && (number ? `${volume}(${number})` : volume), pages].filter(Boolean).join(", ");
    const links = [];
    if (doi) links.push(`<a href="https://doi.org/${htmlEscape(doi)}">DOI</a>`);
    if (url && !doi) links.push(`<a href="${htmlEscape(url)}">Link</a>`);

    return `
      <article class="publication" data-search="${htmlEscape(normalize(`${title} ${authors} ${venue} ${year}`))}">
        <div class="publication-title">${title}</div>
        <div class="publication-meta">${authors}</div>
        <div class="publication-meta">${[venueBits, year].filter(Boolean).join(" · ")}</div>
        ${links.length ? `<div class="publication-links">${links.join(" ")}</div>` : ""}
      </article>
    `;
  }

  async function initPublications() {
    const list = document.querySelector("[data-publications-list]");
    if (!list) return;

    const count = document.querySelector("[data-publications-count]");
    const input = document.querySelector("[data-publications-search]");
    const bibUrl = document.body.dataset.bibUrl || "../data/publications.bib";
    const aliases = (document.body.dataset.authorAliases || "")
      .split("|")
      .map((alias) => alias.trim())
      .filter(Boolean);

    try {
      const response = await fetch(bibUrl);
      if (!response.ok) throw new Error(`Could not load ${bibUrl}`);
      const bibText = await response.text();
      const entries = parseBibTeX(bibText)
        .filter((entry) => authorsContain(entry, aliases))
        .sort((a, b) => Number(b.fields.year || 0) - Number(a.fields.year || 0));

      if (!entries.length) {
        list.innerHTML = `<div class="note">No publications found for this author in <code>${htmlEscape(bibUrl)}</code>. Add BibTeX entries containing one of the author aliases in this page.</div>`;
        if (count) count.textContent = "0 publications";
        return;
      }

      list.innerHTML = entries.map(publicationHTML).join("");
      if (count) count.textContent = `${entries.length} publication${entries.length === 1 ? "" : "s"}`;

      if (input) {
        input.addEventListener("input", () => {
          const query = normalize(input.value);
          let visible = 0;
          list.querySelectorAll(".publication").forEach((item) => {
            const show = item.dataset.search.includes(query);
            item.hidden = !show;
            if (show) visible++;
          });
          if (count) count.textContent = `${visible} publication${visible === 1 ? "" : "s"}`;
        });
      }
    } catch (error) {
      list.innerHTML = `<div class="note">Could not load publications. Check that <code>${htmlEscape(bibUrl)}</code> exists and is published with the site.</div>`;
      if (count) count.textContent = "Publications unavailable";
      console.error(error);
    }
  }

  initPublications();
})();
