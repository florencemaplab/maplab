(function () {
  const $ = (selector, root = document) => root.querySelector(selector);

  const NAV_CATEGORIES = [
    {
      id: "faculty",
      label: "Faculty"
    },
    {
      id: "postdoc",
      label: "Post-doc"
    },
    {
      id: "phd",
      label: "Graduate"
    }
  ];

  const FALLBACK_CATEGORIES = {
    "giovanni-anobile": "faculty",
    "roberto-arrighi": "faculty",
    "alessandro-benedetto": "faculty",
    "elisa-castaldi": "faculty",
    "serena-castellotti": "postdoc",
    "irene-burgio": "phd"
  };

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

  function normalizeCategory(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");

    if (["faculty", "staff"].includes(normalized)) return "faculty";
    if (["postdoc", "postdoctoral", "postdoctoralresearcher"].includes(normalized)) return "postdoc";
    if (["phd", "phdstudent", "graduate", "graduatestudent", "doctoral", "doctoralstudent"].includes(normalized)) return "phd";
    return "";
  }

  function navCategoryFor(person) {
    return (
      normalizeCategory(person.category) ||
      normalizeCategory(person.group) ||
      FALLBACK_CATEGORIES[person.slug] ||
      "faculty"
    );
  }

  function injectNavStyles() {
    if ($("#people-nav-dropdown-styles")) return;

    const style = document.createElement("style");
    style.id = "people-nav-dropdown-styles";
    style.textContent = `
      .nav-links {
        align-items: center;
      }

      .people-menu {
        position: relative;
      }

      .people-menu summary {
        list-style: none;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        color: var(--muted, #5d6a75);
        padding: 0.48rem 0.72rem;
        border-radius: 999px;
        border: 1px solid transparent;
        font-size: 0.91rem;
        font-weight: 650;
        cursor: pointer;
        user-select: none;
      }

      .people-menu summary::-webkit-details-marker {
        display: none;
      }

      .people-menu summary::after {
        content: "▾";
        font-size: 0.7rem;
        line-height: 1;
        transform: translateY(1px);
      }

      .people-menu[open] summary,
      .people-menu summary:hover,
      .people-menu summary:focus {
        color: var(--navy, #153e5c);
        background: var(--accent-soft, #e8f3f7);
        border-color: rgba(31, 108, 148, 0.14);
        outline: none;
      }

      .people-menu-panel {
        position: absolute;
        right: 0;
        top: calc(100% + 0.55rem);
        z-index: 60;
        width: min(320px, calc(100vw - 2rem));
        padding: 0.85rem;
        border: 1px solid rgba(220, 227, 234, 0.95);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: var(--shadow, 0 16px 38px rgba(19, 32, 43, 0.075));
      }

      .people-menu-section + .people-menu-section {
        margin-top: 0.72rem;
        padding-top: 0.72rem;
        border-top: 1px solid rgba(220, 227, 234, 0.9);
      }

      .people-menu-title {
        margin: 0 0 0.42rem;
        color: var(--subtle, #7b8893);
        font-size: 0.72rem;
        font-weight: 830;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .people-menu-names {
        display: grid;
        gap: 0.18rem;
      }

      .nav-links .people-menu-names a {
        display: block;
        border-radius: 11px;
        padding: 0.42rem 0.55rem;
        color: var(--ink, #13202b);
        font-size: 0.91rem;
        font-weight: 700;
      }

      .nav-links .people-menu-names a:hover,
      .nav-links .people-menu-names a.is-current {
        background: var(--accent-soft, #e8f3f7);
        color: var(--navy, #153e5c);
        text-decoration: none;
      }

      .pub-count {
        display: none !important;
      }

      @media (max-width: 640px) {
        .people-menu {
          width: 100%;
        }

        .people-menu summary {
          width: fit-content;
        }

        .people-menu-panel {
          left: 0;
          right: auto;
        }
      }
    `;
    document.head.appendChild(style);
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
        return `
          <section class="publication-year" data-publication-year data-year="${escapeHTML(year)}">
            <h3><span>${escapeHTML(year)}</span></h3>
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
    injectNavStyles();

    const grouped = NAV_CATEGORIES.map((category) => ({
      ...category,
      people: people.filter((person) => navCategoryFor(person) === category.id)
    })).filter((category) => category.people.length);

    nav.innerHTML = `
      <a class="main-site-link" href="https://maplab.unifi.it/">MAPLab main site</a>
      <details class="people-menu">
        <summary>People</summary>
        <div class="people-menu-panel">
          ${grouped.map((category) => `
            <section class="people-menu-section">
              <h3 class="people-menu-title">${escapeHTML(category.label)}</h3>
              <div class="people-menu-names">
                ${category.people.map((person) => {
                  const active = person.slug === current ? " is-current" : "";
                  return `<a class="${active.trim()}" href="${escapeHTML(person.slug)}.html">${escapeHTML(person.shortName || person.slug)}</a>`;
                }).join("")}
              </div>
            </section>
          `).join("")}
        </div>
      </details>
    `;
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


  function injectScopusAnalyticsStyles() {
    if ($("#scopus-analytics-styles")) return;

    const style = document.createElement("style");
    style.id = "scopus-analytics-styles";
    style.textContent = `
      .scopus-analytics {
        margin-top: 1.05rem;
        padding-top: 1rem;
        border-top: 1px solid rgba(220, 227, 234, 0.92);
      }

      .scopus-analytics-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.8rem;
        margin-bottom: 0.82rem;
      }

      .scopus-analytics-header h3 {
        margin: 0;
        font-size: 1.02rem;
      }

      .scopus-analytics-updated {
        color: var(--subtle, #7b8893);
        font-size: 0.78rem;
        white-space: nowrap;
      }

      .scopus-metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(120px, 1fr));
        gap: 0.65rem;
        margin-bottom: 0.95rem;
        max-width: 360px;
      }

      .scopus-metric {
        padding: 0.72rem 0.78rem;
        border: 1px solid rgba(31, 108, 148, 0.15);
        border-radius: 15px;
        background:
          radial-gradient(circle at top right, rgba(43, 127, 136, 0.10), transparent 55%),
          linear-gradient(180deg, #ffffff, #f7fbfd);
      }

      .scopus-metric-value {
        display: block;
        color: var(--navy, #153e5c);
        font-size: 1.42rem;
        line-height: 1.05;
        font-weight: 850;
        letter-spacing: -0.04em;
      }

      .scopus-metric-label {
        display: block;
        margin-top: 0.24rem;
        color: var(--subtle, #7b8893);
        font-size: 0.72rem;
        line-height: 1.2;
        font-weight: 830;
        letter-spacing: 0.09em;
        text-transform: uppercase;
      }

      .scopus-visuals {
        display: grid;
        grid-template-columns: minmax(0, 1.05fr) minmax(280px, 0.95fr);
        gap: 0.9rem;
        align-items: stretch;
      }

      .word-cloud-card,
      .coauthor-card {
        min-width: 0;
        padding: 0.95rem;
        border: 1px solid rgba(220, 227, 234, 0.92);
        border-radius: 18px;
        background:
          radial-gradient(circle at top left, rgba(31, 108, 148, 0.07), transparent 45%),
          #fff;
      }

      .word-cloud-card h4,
      .coauthor-card h4 {
        margin: 0 0 0.65rem;
        color: var(--ink, #13202b);
        font-size: 0.94rem;
        letter-spacing: 0;
      }

      .word-cloud-svg {
        width: 100%;
        height: auto;
        display: block;
        overflow: visible;
      }

      .word-cloud-word {
        font-family: inherit;
        font-weight: 820;
        dominant-baseline: middle;
        text-anchor: middle;
        paint-order: stroke;
        stroke: rgba(255, 255, 255, 0.78);
        stroke-width: 3px;
        stroke-linejoin: round;
        cursor: default;
        transition: opacity 0.16s ease, transform 0.16s ease;
      }

      .word-cloud-word:hover {
        opacity: 1;
      }

      .coauthor-map-wrap {
        position: relative;
      }

      .coauthor-map {
        width: 100%;
        height: auto;
        min-height: 250px;
        display: block;
        overflow: visible;
      }

      .coauthor-map .edge {
        stroke: rgba(31, 108, 148, 0.20);
        stroke-linecap: round;
        transition: stroke 0.16s ease, stroke-opacity 0.16s ease;
      }

      .coauthor-map .node-center {
        fill: var(--navy, #153e5c);
      }

      .coauthor-map .node-coauthor {
        fill: #ffffff;
        stroke: var(--blue, #1f6c94);
        stroke-width: 1.4;
        transition: fill 0.16s ease, stroke-width 0.16s ease, transform 0.16s ease;
        cursor: pointer;
      }

      .coauthor-map .coauthor-node:hover .node-coauthor,
      .coauthor-map .coauthor-node:focus .node-coauthor {
        fill: var(--accent-soft, #e8f3f7);
        stroke-width: 2.2;
      }

      .coauthor-map .coauthor-label {
        opacity: 0;
        pointer-events: none;
        font-family: inherit;
        font-size: 11px;
        font-weight: 760;
        fill: var(--ink, #13202b);
        paint-order: stroke;
        stroke: rgba(255, 255, 255, 0.92);
        stroke-width: 4px;
        stroke-linejoin: round;
        transition: opacity 0.16s ease;
      }

      .coauthor-map .coauthor-node:hover .coauthor-label,
      .coauthor-map .coauthor-node:focus .coauthor-label {
        opacity: 1;
      }

      .coauthor-tooltip {
        margin-top: 0.45rem;
        min-height: 1.25rem;
        color: var(--muted, #5d6a75);
        font-size: 0.84rem;
      }

      .coauthor-tooltip strong {
        color: var(--navy, #153e5c);
      }

      .scopus-note {
        margin-top: 0.58rem;
        color: var(--subtle, #7b8893);
        font-size: 0.78rem;
      }

      @media (max-width: 900px) {
        .scopus-visuals {
          grid-template-columns: 1fr;
        }

        .scopus-metrics {
          max-width: none;
        }
      }    `;
    document.head.appendChild(style);
  }

  function compactDate(value) {
    const text = String(value || "");
    const match = text.match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : text;
  }

  function numberOrDash(value) {
    if (value === null || value === undefined || value === "") return "–";
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("en-US") : String(value);
  }

  function metricCard(label, value) {
    const hasValue = value !== null && value !== undefined && value !== "";
    return `
      <div class="scopus-metric">
        <span class="scopus-metric-value">${escapeHTML(hasValue ? numberOrDash(value) : "–")}</span>
        <span class="scopus-metric-label">${escapeHTML(label)}</span>
      </div>
    `;
  }

  function valueOfKeyword(item) {
    return Number(item.value || item.count || 0);
  }

  function keywordColor(index) {
    const colors = [
      "var(--navy, #153e5c)",
      "var(--blue, #1f6c94)",
      "var(--teal, #2b7f88)",
      "#315f75",
      "#247080"
    ];
    return colors[index % colors.length];
  }

  function wordCloudHTML(keywords) {
    const words = (keywords || [])
      .filter((item) => item && item.text)
      .slice(0, 34);

    if (!words.length) {
      return `<p class="scopus-note">No keyword data available yet. The next Scopus update will use titles and abstracts when available.</p>`;
    }

    const values = words.map(valueOfKeyword).filter(Number.isFinite);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const cx = 300;
    const cy = 160;

    const placed = words.map((item, index) => {
      const value = valueOfKeyword(item);
      const ratio = max === min ? 0.65 : (value - min) / (max - min);
      const size = 12 + ratio * 22;
      const angle = index * 2.399963229728653; // golden angle
      const radius = index === 0 ? 0 : 18 + Math.sqrt(index) * 32;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius * 0.62;
      const rotate = index > 8 && index % 7 === 0 ? -8 : index > 8 && index % 5 === 0 ? 8 : 0;

      return { item, value, size, x, y, rotate };
    });

    return `
      <svg class="word-cloud-svg" viewBox="0 0 600 320" role="img" aria-label="Keyword cloud generated from Scopus titles and abstracts">
        ${placed.map((word, index) => `
          <text
            class="word-cloud-word"
            x="${word.x.toFixed(1)}"
            y="${word.y.toFixed(1)}"
            fill="${keywordColor(index)}"
            font-size="${word.size.toFixed(1)}"
            opacity="${(0.58 + Math.min(0.42, word.size / 70)).toFixed(2)}"
            transform="rotate(${word.rotate} ${word.x.toFixed(1)} ${word.y.toFixed(1)})"
          >
            <title>${escapeHTML(word.item.text)} · ${escapeHTML(numberOrDash(word.value))}</title>
            ${escapeHTML(word.item.text)}
          </text>
        `).join("")}
      </svg>
    `;
  }

  function shortLabel(name) {
    const text = String(name || "").trim();
    if (text.length <= 22) return text;
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const initials = parts.slice(0, -1).map((part) => `${part[0]}.`).join(" ");
      return `${initials} ${last}`;
    }
    return `${text.slice(0, 21)}…`;
  }

  function coauthorNetworkHTML(profileName, coauthors) {
    const items = (coauthors || [])
      .filter((item) => item && (item.name || item.label || item.id))
      .slice(0, 18);

    if (!items.length) {
      return `<p class="scopus-note">No coauthor network available yet.</p>`;
    }

    const cx = 260;
    const cy = 145;
    const maxCount = Math.max(...items.map((item) => Number(item.count || item.value || 1)));

    const nodes = items.map((item, index) => {
      const ring = index < 8 ? 1 : 2;
      const ringIndex = ring === 1 ? index : index - 8;
      const ringSize = ring === 1 ? Math.min(8, items.length) : Math.max(1, items.length - 8);
      const angle = (Math.PI * 2 * ringIndex) / ringSize - Math.PI / 2 + (ring === 2 ? Math.PI / 9 : 0);
      const radius = ring === 1 ? 82 : 118;
      const count = Number(item.count || item.value || 1);
      const r = 5.5 + Math.sqrt(count / maxCount) * 10.5;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius * 0.78;
      const labelY = y - r - 8;
      return { ...item, x, y, r, labelY, count };
    });

    const centerName = shortLabel(profileName);

    return `
      <div class="coauthor-map-wrap">
        <svg class="coauthor-map" viewBox="0 0 520 300" role="img" aria-label="Interactive coauthor network map">
          ${nodes.map((node, index) => `<line class="edge edge-${index}" x1="${cx}" y1="${cy}" x2="${node.x.toFixed(1)}" y2="${node.y.toFixed(1)}" stroke-width="${Math.max(0.8, Math.min(4.5, Math.sqrt(node.count / maxCount) * 4)).toFixed(1)}"></line>`).join("")}
          <circle class="node-center" cx="${cx}" cy="${cy}" r="18"></circle>
          <text x="${cx}" y="${cy + 37}" text-anchor="middle" font-size="11" font-weight="820">${escapeHTML(centerName)}</text>

          ${nodes.map((node, index) => {
            const name = node.name || node.label || node.id;
            return `
              <g class="coauthor-node" tabindex="0" data-coauthor="${escapeHTML(name)}" data-count="${escapeHTML(node.count)}">
                <title>${escapeHTML(name)} · ${escapeHTML(numberOrDash(node.count))} shared publication${node.count === 1 ? "" : "s"}</title>
                <circle class="node-coauthor" cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${node.r.toFixed(1)}"></circle>
                <text class="coauthor-label" x="${node.x.toFixed(1)}" y="${node.labelY.toFixed(1)}" text-anchor="middle">${escapeHTML(shortLabel(name))}</text>
              </g>
            `;
          }).join("")}
        </svg>
        <div class="coauthor-tooltip" data-coauthor-tooltip>Hover over a node to see the coauthor name.</div>
      </div>
    `;
  }

  function activateCoauthorTooltip(root) {
    const tooltip = root.querySelector("[data-coauthor-tooltip]");
    if (!tooltip) return;

    root.querySelectorAll(".coauthor-node").forEach((node) => {
      const show = () => {
        const name = node.dataset.coauthor || "";
        const count = node.dataset.count || "";
        tooltip.innerHTML = `<strong>${escapeHTML(name)}</strong>${count ? ` · ${escapeHTML(count)} shared publication${Number(count) === 1 ? "" : "s"}` : ""}`;
      };
      const clear = () => {
        tooltip.textContent = "Hover over a node to see the coauthor name.";
      };
      node.addEventListener("mouseenter", show);
      node.addEventListener("focus", show);
      node.addEventListener("mouseleave", clear);
      node.addEventListener("blur", clear);
    });
  }

  async function renderScopusAnalytics(prefix, slug, profile) {
    injectScopusAnalyticsStyles();

    const interestsList = $("[data-profile-interests]");
    const panel = interestsList ? interestsList.closest(".panel") : null;
    if (!panel) return;

    let data;
    try {
      const response = await fetch(`${prefix}data/scopus/${slug}.json`);
      if (!response.ok) return;
      data = await response.json();
    } catch (error) {
      console.info("Scopus analytics unavailable", error);
      return;
    }

    const existing = panel.querySelector(".scopus-analytics");
    if (existing) existing.remove();

    const metrics = data.metrics || {};
    const keywordCount = (data.keywords || []).length;
    const coauthorCount = (data.coauthors || []).length;
    if (!keywordCount && !coauthorCount && !Object.keys(metrics).length) return;

    const wrapper = document.createElement("div");
    wrapper.className = "scopus-analytics";
    wrapper.innerHTML = `
      <div class="scopus-analytics-header">
        <h3>Scopus research signals</h3>
        ${data.generated_at ? `<span class="scopus-analytics-updated">Updated ${escapeHTML(compactDate(data.generated_at))}</span>` : ""}
      </div>

      <div class="scopus-metrics">
        ${metricCard("Citations", metrics.citation_count || metrics.cited_by_count)}
        ${metricCard("h-index", metrics.h_index)}
      </div>

      <div class="scopus-visuals">
        <div class="word-cloud-card">
          <h4>Keyword cloud</h4>
          ${wordCloudHTML(data.keywords)}
          <p class="scopus-note">Generated from Scopus titles and abstracts when accessible.</p>
        </div>

        <div class="coauthor-card">
          <h4>Coauthor network</h4>
          ${coauthorNetworkHTML(profile.name, data.coauthors)}
        </div>
      </div>
    `;

    panel.appendChild(wrapper);
    activateCoauthorTooltip(wrapper);
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
      renderScopusAnalytics(prefix, slug, profile);

      const response = await fetch(bibURL);
      if (!response.ok) throw new Error(`Could not load ${bibURL}`);
      const bibText = await response.text();

      const entries = parseBibTeX(bibText)
        .filter((entry) => entryMatchesProfile(entry, profile))
        .sort((a, b) => bibYear(b) - bibYear(a) || normalize(a.fields.title).localeCompare(normalize(b.fields.title)));

      const list = $("[data-publications-list]");
      const count = $("[data-publications-count]");
      if (count) count.hidden = true;
      const input = $("[data-publications-search]");
      let activeYear = "all";

      if (!entries.length) {
        if (list) list.innerHTML = `<div class="note">No publications found for this profile. Check aliases in <code>data/people/${escapeHTML(slug)}.json</code> and the shared BibTeX file.</div>`;
        if (count) count.hidden = true;
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
        if (count) count.hidden = true;
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
