(function () {
  const $ = (selector, root = document) => root.querySelector(selector);

  function slugFromPath() {
    const file = window.location.pathname.split("/").pop() || "";
    return file.replace(/\.html?$/i, "") || "template";
  }

  function rootPrefix() {
    return window.location.pathname.includes("/people/") ? "../" : "";
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\\_/g, "_")
      .replace(/[.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function escapeHTML(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value || "";
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
        const char = text[end];
        if (char === "{") depth += 1;
        if (char === "}") depth -= 1;
        if (depth === 0) {
          end += 1;
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
        const start = pos + 1;
        let end = start;
        for (; end < body.length; end++) {
          if (body[end] === "{") depth += 1;
          if (body[end] === "}") {
            if (depth === 0) break;
            depth -= 1;
          }
        }
        value = body.slice(start, end);
        pos = end + 1;
      } else if (body[pos] === '"') {
        const start = pos + 1;
        let end = start;
        while (end < body.length && body[end] !== '"') end += 1;
        value = body.slice(start, end);
        pos = end + 1;
      } else {
        let end = pos;
        while (end < body.length && body[end] !== ",") end += 1;
        value = body.slice(pos, end).trim();
        pos = end;
      }

      fields[name] = value
        .replace(/\\_/g, "_")
        .replace(/\\&/g, "&")
        .replace(/\\%/g, "%")
        .replace(/\s+/g, " ")
        .trim();

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

  function authorVariants(name) {
    const raw = String(name || "").trim();
    const variants = new Set();
    const add = (value) => {
      const normalized = normalize(value);
      if (normalized) variants.add(normalized);
    };

    add(raw);

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
        const surname = parts[parts.length - 1];
        const given = parts.slice(0, -1).join(" ");
        add(`${given} ${surname}`);
        add(`${surname} ${given}`);
      }
    }

    return Array.from(variants);
  }

  function namesMatch(name, alias) {
    const names = authorVariants(name);
    const aliases = authorVariants(alias);
    return names.some((a) =>
      aliases.some((b) => {
        if (!a || !b) return false;
        if (a === b) return true;
        return a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a));
      })
    );
  }

  function entryMatchesProfile(entry, profile) {
    const aliases = profile.aliases || [];
    const maplabPeople = entry.fields.maplab_people || entry.fields.maplab_person || "";
    const mapped = maplabPeople
      .split(/\s*(?:;|\||, and | and )\s*/i)
      .map((item) => item.trim())
      .filter(Boolean);

    if (mapped.some((name) => aliases.some((alias) => namesMatch(name, alias)))) {
      return true;
    }

    const authors = String(entry.fields.author || "")
      .split(/\s+and\s+/i)
      .map((name) => name.trim())
      .filter(Boolean);

    return authors.some((name) => aliases.some((alias) => namesMatch(name, alias)));
  }

  function formatAuthors(authorField) {
    return String(authorField || "")
      .split(/\s+and\s+/i)
      .map((name) => {
        const parts = name.split(",").map((part) => part.trim()).filter(Boolean);
        if (parts.length >= 2) return `${parts.slice(1).join(" ")} ${parts[0]}`.replace(/\s+/g, " ");
        return name.trim();
      })
      .filter(Boolean)
      .join(", ");
  }

  function bibYear(entry) {
    const match = String(entry.fields.year || "").match(/(19|20)\d{2}/);
    return match ? Number.parseInt(match[0], 10) : 0;
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
    const title = escapeHTML(f.title || "Untitled publication");
    const authors = escapeHTML(formatAuthors(f.author));
    const venue = escapeHTML(venueLine(entry));
    const year = escapeHTML(f.year || "n.d.");
    const doi = String(f.doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
    const url = f.url || (doi ? `https://doi.org/${doi}` : "");
    const search = escapeHTML(normalize(`${f.title} ${formatAuthors(f.author)} ${venueLine(entry)} ${f.year} ${doi}`));
    const titleHTML = url ? `<a href="${escapeHTML(url)}">${title}</a>` : title;

    return `
      <li class="publication" data-search="${search}">
        <div class="publication-title">${titleHTML}</div>
        ${authors ? `<div class="publication-authors">${authors}</div>` : ""}
        <div class="publication-meta">${[venue, year].filter(Boolean).join(" · ")}</div>
        ${doi ? `<div class="publication-links"><a href="https://doi.org/${escapeHTML(doi)}">DOI</a></div>` : ""}
      </li>
    `;
  }

  function renderGroupedPublications(entries) {
    const groups = entries.reduce((acc, entry) => {
      const year = entry.fields.year || "n.d.";
      if (!acc[year]) acc[year] = [];
      acc[year].push(entry);
      return acc;
    }, {});

    return Object.keys(groups)
      .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10))
      .map((year) => {
        const items = groups[year].sort((a, b) =>
          normalize(a.fields.title).localeCompare(normalize(b.fields.title))
        );
        const count = items.length;
        return `
          <section class="publication-year" data-publication-year data-year="${escapeHTML(year)}">
            <h3><span>${escapeHTML(year)}</span><small>${count} publication${count === 1 ? "" : "s"}</small></h3>
            <ol class="year-publications">
              ${items.map(publicationHTML).join("")}
            </ol>
          </section>
        `;
      })
      .join("");
  }

  function renderYearFilter(entries, onChange) {
    const container = $("[data-year-filter]");
    if (!container) return;

    const years = Array.from(new Set(entries.map((entry) => entry.fields.year || "n.d.")))
      .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));

    container.innerHTML = "";

    if (years.length <= 1) return;

    ["all", ...years].forEach((year) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "year-filter-button";
      button.dataset.year = year;
      button.textContent = year === "all" ? "All" : year;
      button.setAttribute("aria-pressed", year === "all" ? "true" : "false");
      if (year === "all") button.classList.add("is-active");
      container.appendChild(button);
    });

    container.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-year]");
      if (!button) return;
      container.querySelectorAll("button").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", active ? "true" : "false");
      });
      onChange(button.dataset.year || "all");
    });
  }

  async function fetchJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return response.json();
  }

  function renderNav(people) {
    const nav = $("[data-people-nav]");
    if (!nav) return;
    const current = slugFromPath();
    nav.innerHTML = people.map((person) => {
      const href = `${person.slug}.html`;
      const active = person.slug === current ? " is-current" : "";
      return `<a class="${active.trim()}" href="${href}">${escapeHTML(person.shortName || person.slug)}</a>`;
    }).join("");
  }

  function renderProfile(profile) {
    document.title = `${profile.name} | Florence MAPLab`;

    setText("[data-profile-name]", profile.name);
    setText("[data-profile-role]", profile.role);
    setText("[data-profile-summary]", profile.summary);
    setText("[data-profile-department]", profile.department);
    setText("[data-profile-ssd]", profile.ssd);
    setText("[data-profile-research]", profile.research);
    setText("[data-profile-teaching]", profile.teaching && profile.teaching.text);
    setText("[data-profile-topics]", profile.topics);

    const photo = $("[data-profile-photo]");
    if (photo) {
      photo.src = profile.photo || "";
      photo.alt = profile.photo ? `Photo of ${profile.name}` : "";
    }
    setText("[data-profile-photo-credit]", profile.photoCredit ? `Photo: ${profile.photoCredit}` : "");

    const email = $("[data-profile-email]");
    if (email && profile.email) {
      email.innerHTML = `<a href="mailto:${escapeHTML(profile.email)}">${escapeHTML(profile.email)}</a>`;
    }

    const links = $("[data-profile-links]");
    if (links) {
      links.innerHTML = (profile.links || [])
        .map((link) => `<a href="${escapeHTML(link.url)}">${escapeHTML(link.label)}</a>`)
        .join("");
    }

    const teachingLinks = $("[data-profile-teaching-links]");
    if (teachingLinks) {
      teachingLinks.innerHTML = ((profile.teaching && profile.teaching.links) || [])
        .map((link) => `<a href="${escapeHTML(link.url)}">${escapeHTML(link.label)}</a>`)
        .join("");
    }

    const interests = $("[data-profile-interests]");
    if (interests) {
      interests.innerHTML = (profile.interests || [])
        .map((item) => `<li>${escapeHTML(item)}</li>`)
        .join("");
    }

    const cv = $("[data-profile-cv]");
    if (cv) {
      cv.innerHTML = (profile.cv || [])
        .map((item) => `<li>${escapeHTML(item)}</li>`)
        .join("");
    }
  }

  async function init() {
    const slug = slugFromPath();
    const prefix = rootPrefix();
    const indexURL = document.body.dataset.peopleIndex || `${prefix}data/people/people.json`;
    const bibURL = document.body.dataset.bibUrl || `${prefix}data/publications.bib`;

    try {
      const people = await fetchJSON(indexURL);
      renderNav(people);

      const profile = await fetchJSON(`${prefix}data/people/${slug}.json`);
      renderProfile(profile);

      const response = await fetch(bibURL);
      if (!response.ok) throw new Error(`Could not load ${bibURL}`);
      const bibText = await response.text();

      const entries = parseBibTeX(bibText)
        .filter((entry) => entryMatchesProfile(entry, profile))
        .sort((a, b) => bibYear(b) - bibYear(a) || normalize(a.fields.title).localeCompare(normalize(b.fields.title)));

      const list = $("[data-publications-list]");
      const count = $("[data-publications-count]");
      const input = $("[data-publications-search]");
      let activeYear = "all";

      if (!entries.length) {
        if (list) list.innerHTML = `<div class="note">No publications found for this profile. Check aliases in <code>data/people/${escapeHTML(slug)}.json</code> and the shared BibTeX file.</div>`;
        if (count) count.textContent = "0 publications";
        return;
      }

      if (list) list.innerHTML = renderGroupedPublications(entries);

      function updateVisibility() {
        const query = normalize(input ? input.value : "");
        let visible = 0;

        document.querySelectorAll("[data-publication-year]").forEach((group) => {
          const yearMatches = activeYear === "all" || group.dataset.year === activeYear;
          let groupVisible = 0;

          group.querySelectorAll(".publication").forEach((item) => {
            const textMatches = !query || item.dataset.search.includes(query);
            const show = yearMatches && textMatches;
            item.hidden = !show;
            if (show) {
              visible += 1;
              groupVisible += 1;
            }
          });

          group.hidden = groupVisible === 0;
        });

        if (count) {
          const label = visible === 1 ? "publication" : "publications";
          count.textContent = activeYear === "all" ? `${visible} ${label}` : `${visible} ${label} in ${activeYear}`;
        }
      }

      renderYearFilter(entries, (year) => {
        activeYear = year;
        updateVisibility();
      });

      if (input) input.addEventListener("input", updateVisibility);
      updateVisibility();
    } catch (error) {
      console.error(error);
      const list = $("[data-publications-list]");
      if (list) list.innerHTML = `<div class="note">Could not load this profile. Check the JSON file name and paths.</div>`;
    }
  }

  init();
})();
