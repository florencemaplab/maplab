(function () {
  const $ = (selector, root = document) => root.querySelector(selector);

  const CATEGORIES = [
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

  function categoryFor(profile, indexEntry) {
    return (
      normalizeCategory(profile.category) ||
      normalizeCategory(profile.group) ||
      normalizeCategory(profile.peopleCategory) ||
      normalizeCategory(indexEntry.category) ||
      normalizeCategory(indexEntry.group) ||
      FALLBACK_CATEGORIES[indexEntry.slug] ||
      FALLBACK_CATEGORIES[profile.slug] ||
      "faculty"
    );
  }

  function initials(name) {
    return String(name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  async function fetchJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return response.json();
  }

  function injectPeopleStyles() {
    if ($("#people-planes-styles")) return;

    const style = document.createElement("style");
    style.id = "people-planes-styles";
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

      .nav-links .people-menu-names a:hover {
        background: var(--accent-soft, #e8f3f7);
        color: var(--navy, #153e5c);
        text-decoration: none;
      }

      .people-grid {
        grid-template-columns: 1fr !important;
        gap: 1rem !important;
      }

      .people-plane {
        position: relative;
        overflow: hidden;
        display: grid;
        gap: 0.9rem;
        padding: clamp(1rem, 2vw, 1.25rem);
        border: 1px solid rgba(220, 227, 234, 0.92);
        border-radius: var(--radius, 20px);
        background:
          radial-gradient(circle at top right, rgba(31, 108, 148, 0.10), transparent 20rem),
          rgba(255, 255, 255, 0.94);
        box-shadow: var(--shadow-soft, 0 7px 22px rgba(19, 32, 43, 0.05));
      }

      .people-plane + .people-plane {
        margin-top: -0.12rem;
      }

      .people-plane:nth-child(2) {
        transform: translateX(0.75rem);
        max-width: calc(100% - 0.75rem);
      }

      .people-plane:nth-child(3) {
        transform: translateX(1.5rem);
        max-width: calc(100% - 1.5rem);
      }

      .people-plane::before {
        content: "";
        position: absolute;
        inset: 0 auto 0 0;
        width: 5px;
        background: linear-gradient(180deg, var(--navy, #153e5c), var(--blue, #1f6c94));
        opacity: 0.82;
      }

      .people-plane-header {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 0.35rem;
      }

      .people-plane-title {
        margin: 0;
        color: var(--navy, #153e5c);
        font-size: clamp(1.15rem, 1.6vw, 1.45rem);
        font-weight: 830;
        letter-spacing: -0.035em;
      }

      .people-plane-names {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .people-plane-names a {
        display: inline-flex;
        align-items: center;
        padding: 0.32rem 0.58rem;
        border: 1px solid rgba(31, 108, 148, 0.16);
        border-radius: 999px;
        background: var(--accent-soft, #e8f3f7);
        color: var(--navy, #153e5c);
        font-size: 0.86rem;
        font-weight: 720;
      }

      .people-plane-names a:hover {
        background: #dceef5;
        text-decoration: none;
      }

      .people-plane-grid {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 1rem;
      }

      .people-plane[data-category="postdoc"] .people-plane-grid,
      .people-plane[data-category="phd"] .people-plane-grid {
        grid-template-columns: repeat(2, minmax(180px, 260px));
      }

      .person-placeholder {
        display: grid;
        place-items: center;
        width: 100%;
        aspect-ratio: 4 / 5;
        border-bottom: 1px solid rgba(220, 227, 234, 0.92);
        background:
          radial-gradient(circle at 28% 18%, rgba(31, 108, 148, 0.18), transparent 30%),
          linear-gradient(135deg, #edf3f8, #ffffff);
        color: var(--navy, #153e5c);
        font-size: clamp(1.8rem, 5vw, 3.2rem);
        font-weight: 850;
        letter-spacing: -0.05em;
      }

      @media (max-width: 980px) {
        .people-plane-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .people-plane[data-category="postdoc"] .people-plane-grid,
        .people-plane[data-category="phd"] .people-plane-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
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

        .people-plane:nth-child(2),
        .people-plane:nth-child(3) {
          transform: none;
          max-width: 100%;
        }

        .people-plane-grid,
        .people-plane[data-category="postdoc"] .people-plane-grid,
        .people-plane[data-category="phd"] .people-plane-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function navDropdownHTML(people, hrefPrefix) {
    const grouped = CATEGORIES.map((category) => ({
      ...category,
      people: people.filter((person) => categoryFor({}, person) === category.id)
    })).filter((category) => category.people.length);

    return `
      <a class="main-site-link" href="https://maplab.unifi.it/">MAPLab main site</a>
      <details class="people-menu">
        <summary>People</summary>
        <div class="people-menu-panel">
          ${grouped.map((category) => `
            <section class="people-menu-section">
              <h3 class="people-menu-title">${escapeHTML(category.label)}</h3>
              <div class="people-menu-names">
                ${category.people.map((person) => `
                  <a href="${hrefPrefix}${escapeHTML(person.slug)}.html">${escapeHTML(person.shortName || person.slug)}</a>
                `).join("")}
              </div>
            </section>
          `).join("")}
        </div>
      </details>
    `;
  }

  function renderNav(people) {
    const nav = $("[data-people-nav]");
    if (!nav) return;
    injectPeopleStyles();
    nav.innerHTML = navDropdownHTML(people, "people/");
  }

  function personCard(profile) {
    const slug = profile.slug || "";
    const name = profile.name || profile.shortName || slug;
    const photo = String(profile.photo || "").replace(/^\.\.\//, "");
    const image = photo
      ? `<img src="${escapeHTML(photo)}" alt="Photo of ${escapeHTML(name)}" loading="lazy">`
      : `<div class="person-placeholder" aria-hidden="true">${escapeHTML(initials(name))}</div>`;

    return `
      <a class="person-tile" data-category="${escapeHTML(profile.category)}" href="people/${escapeHTML(slug)}.html">
        ${image}
        <div>
          <h2>${escapeHTML(name)}</h2>
          <p>${escapeHTML(profile.role || "")}</p>
        </div>
      </a>
    `;
  }

  function peoplePlane(category, profiles) {
    const names = profiles
      .map((profile) => `
        <li>
          <a href="people/${escapeHTML(profile.slug)}.html">${escapeHTML(profile.name || profile.shortName || profile.slug)}</a>
        </li>
      `)
      .join("");

    return `
      <section class="people-plane" data-category="${escapeHTML(category.id)}" aria-labelledby="people-${escapeHTML(category.id)}">
        <header class="people-plane-header">
          <h2 class="people-plane-title" id="people-${escapeHTML(category.id)}">${escapeHTML(category.label)}</h2>
          <ul class="people-plane-names">${names}</ul>
        </header>
        <div class="people-plane-grid">
          ${profiles.map(personCard).join("")}
        </div>
      </section>
    `;
  }

  function renderPeopleDirectory(profiles) {
    const grid = $("[data-people-grid]");
    if (!grid) return;

    injectPeopleStyles();
    updatePeopleSectionLabel(grid);

    const profilesByCategory = CATEGORIES.reduce((acc, category) => {
      acc[category.id] = profiles.filter((profile) => profile.category === category.id);
      return acc;
    }, {});

    grid.innerHTML = CATEGORIES
      .filter((category) => profilesByCategory[category.id].length)
      .map((category) => peoplePlane(category, profilesByCategory[category.id]))
      .join("");
  }

  function updatePeopleSectionLabel(grid) {
    const section = grid.closest("section, article, main") || document;
    const headings = Array.from(section.querySelectorAll(".kicker"));
    const facultyLabel = headings.find((element) => normalizeText(element.textContent) === "faculty");
    if (facultyLabel) facultyLabel.textContent = "People";
  }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }


  function injectLabAtlasStyles() {
    if ($("#lab-atlas-styles")) return;

    const style = document.createElement("style");
    style.id = "lab-atlas-styles";
    style.textContent = `
      .lab-atlas {
        margin-top: 1.25rem;
      }

      .lab-atlas-shell {
        position: relative;
        overflow: hidden;
        padding: clamp(1rem, 2vw, 1.4rem);
        border: 1px solid rgba(220, 227, 234, 0.95);
        border-radius: 26px;
        background:
          radial-gradient(circle at 10% 0%, rgba(43, 127, 136, 0.12), transparent 34%),
          radial-gradient(circle at 92% 8%, rgba(31, 108, 148, 0.13), transparent 36%),
          linear-gradient(180deg, #ffffff, #f8fbfd);
        box-shadow: var(--shadow, 0 16px 38px rgba(19, 32, 43, 0.075));
      }

      .lab-atlas-head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 1rem;
        align-items: end;
        margin-bottom: 1rem;
      }

      .lab-atlas-head h2 {
        margin: 0.18rem 0 0;
        color: var(--ink, #13202b);
        font-size: clamp(1.3rem, 2.5vw, 2rem);
        letter-spacing: -0.04em;
      }

      .lab-atlas-head p {
        margin: 0.4rem 0 0;
        max-width: 74ch;
        color: var(--muted, #5d6a75);
      }

      .lab-atlas-date {
        color: var(--subtle, #7b8893);
        font-size: 0.8rem;
        white-space: nowrap;
      }

      .lab-atlas-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.25fr) minmax(310px, 0.75fr);
        gap: 1rem;
        align-items: stretch;
      }

      .lab-network-card,
      .lab-cloud-card {
        min-width: 0;
        border: 1px solid rgba(220, 227, 234, 0.95);
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.82);
        backdrop-filter: blur(8px);
      }

      .lab-network-card {
        padding: 0.75rem;
      }

      .lab-cloud-card {
        padding: 1rem;
      }

      .lab-card-title {
        display: flex;
        justify-content: space-between;
        gap: 0.8rem;
        align-items: baseline;
        margin: 0 0 0.7rem;
      }

      .lab-card-title h3 {
        margin: 0;
        font-size: 1rem;
        color: var(--ink, #13202b);
      }

      .lab-card-title span {
        color: var(--subtle, #7b8893);
        font-size: 0.78rem;
      }

      .lab-network-wrap {
        position: relative;
        min-height: 500px;
      }

      .lab-network-svg {
        width: 100%;
        height: auto;
        display: block;
        overflow: visible;
      }

      .labnet-edge {
        fill: none;
        stroke: rgba(31, 108, 148, 0.20);
        stroke-linecap: round;
        transition: opacity 0.18s ease, stroke 0.18s ease, stroke-width 0.18s ease;
      }

      .labnet-edge.labnet-internal {
        stroke: rgba(43, 127, 136, 0.34);
      }

      .labnet-node circle {
        cursor: pointer;
        transition: opacity 0.18s ease, stroke-width 0.18s ease, transform 0.18s ease;
        transform-box: fill-box;
        transform-origin: center;
      }

      .labnet-lab circle {
        fill: var(--navy, #153e5c);
        stroke: #fff;
        stroke-width: 3;
        filter: url(#labnet-shadow);
      }

      .labnet-coauthor circle {
        fill: #ffffff;
        stroke: var(--blue, #1f6c94);
        stroke-width: 1.4;
        filter: url(#labnet-soft-shadow);
      }

      .labnet-label {
        pointer-events: none;
        font-family: inherit;
        paint-order: stroke;
        stroke: rgba(255, 255, 255, 0.92);
        stroke-width: 4px;
        stroke-linejoin: round;
      }

      .labnet-lab .labnet-label {
        opacity: 1;
        fill: var(--ink, #13202b);
        font-size: 12px;
        font-weight: 850;
      }

      .labnet-coauthor .labnet-label {
        opacity: 0;
        fill: var(--ink, #13202b);
        font-size: 11px;
        font-weight: 760;
        transition: opacity 0.18s ease;
      }

      .lab-network-svg.has-active .labnet-edge,
      .lab-network-svg.has-active .labnet-node {
        opacity: 0.13;
      }

      .lab-network-svg.has-active .labnet-edge.is-active,
      .lab-network-svg.has-active .labnet-node.is-active {
        opacity: 1;
      }

      .lab-network-svg.has-active .labnet-edge.is-active {
        stroke: var(--teal, #2b7f88);
      }

      .labnet-node.is-active circle,
      .labnet-node:hover circle,
      .labnet-node:focus circle {
        stroke-width: 3;
        transform: scale(1.08);
      }

      .labnet-node.is-active .labnet-label,
      .labnet-node:hover .labnet-label,
      .labnet-node:focus .labnet-label {
        opacity: 1;
      }

      .lab-network-tooltip {
        position: absolute;
        left: 0.8rem;
        bottom: 0.8rem;
        max-width: min(410px, calc(100% - 1.6rem));
        padding: 0.62rem 0.75rem;
        border: 1px solid rgba(220, 227, 234, 0.95);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.94);
        color: var(--muted, #5d6a75);
        font-size: 0.84rem;
        box-shadow: 0 12px 26px rgba(19, 32, 43, 0.08);
      }

      .lab-network-tooltip strong {
        color: var(--navy, #153e5c);
      }

      .lab-cloud-svg {
        width: 100%;
        height: auto;
        display: block;
        overflow: visible;
      }

      .lab-cloud-word {
        font-family: inherit;
        font-weight: 840;
        dominant-baseline: middle;
        text-anchor: middle;
        paint-order: stroke;
        stroke: rgba(255, 255, 255, 0.78);
        stroke-width: 3px;
        stroke-linejoin: round;
      }

      .lab-atlas-note {
        margin: 0.72rem 0 0;
        color: var(--subtle, #7b8893);
        font-size: 0.8rem;
        line-height: 1.45;
      }

      @media (max-width: 980px) {
        .lab-atlas-head {
          grid-template-columns: 1fr;
        }

        .lab-atlas-grid {
          grid-template-columns: 1fr;
        }

        .lab-network-wrap {
          min-height: 420px;
        }
      }
    `;
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

  function labShortName(name) {
    const text = String(name || "").trim();
    if (text.length <= 23) return text;
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      return `${parts.slice(0, -1).map((part) => `${part[0]}.`).join(" ")} ${parts[parts.length - 1]}`;
    }
    return `${text.slice(0, 22)}…`;
  }

  function labKeywordColor(index) {
    const colors = [
      "var(--navy, #153e5c)",
      "var(--blue, #1f6c94)",
      "var(--teal, #2b7f88)",
      "#315f75",
      "#247080"
    ];
    return colors[index % colors.length];
  }

  function labKeywordCloudHTML(keywords) {
    const words = (keywords || []).filter((item) => item && item.text).slice(0, 42);
    if (!words.length) return `<div class="note">No lab keyword data available yet.</div>`;

    const values = words.map((item) => Number(item.value || item.count || 0)).filter(Number.isFinite);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const cx = 310;
    const cy = 185;

    return `
      <svg class="lab-cloud-svg" viewBox="0 0 620 370" role="img" aria-label="MAPLab keyword cloud generated from publication titles">
        ${words.map((item, index) => {
          const value = Number(item.value || item.count || 0);
          const ratio = max === min ? 0.65 : (value - min) / (max - min);
          const size = 13 + ratio * 28;
          const angle = index * 2.399963229728653;
          const radius = index === 0 ? 0 : 18 + Math.sqrt(index) * 35;
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius * 0.66;
          const rotate = index > 10 && index % 9 === 0 ? -7 : index > 10 && index % 6 === 0 ? 7 : 0;

          return `
            <text class="lab-cloud-word"
              x="${x.toFixed(1)}"
              y="${y.toFixed(1)}"
              fill="${labKeywordColor(index)}"
              font-size="${size.toFixed(1)}"
              opacity="${(0.58 + Math.min(0.42, size / 76)).toFixed(2)}"
              transform="rotate(${rotate} ${x.toFixed(1)} ${y.toFixed(1)})">
              <title>${escapeHTML(item.text)} · ${escapeHTML(numberOrDash(value))}</title>
              ${escapeHTML(item.text)}
            </text>
          `;
        }).join("")}
      </svg>
    `;
  }

  function labNetworkHTML(data) {
    const allNodes = data.nodes || [];
    const allEdges = data.edges || [];
    const labNodes = allNodes.filter((node) => node.type === "lab");
    const coauthorNodes = allNodes
      .filter((node) => node.type !== "lab")
      .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
      .slice(0, 72);

    if (!labNodes.length || !coauthorNodes.length) {
      return `<div class="note">No lab-wide collaboration network available yet.</div>`;
    }

    const visibleIds = new Set([...labNodes, ...coauthorNodes].map((node) => node.id));
    const edges = allEdges
      .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 145);

    const width = 920;
    const height = 560;
    const cx = width / 2;
    const cy = height / 2 + 8;
    const positions = {};
    const maxNodeWeight = Math.max(...coauthorNodes.map((node) => Number(node.weight || 1)), 1);
    const maxEdgeWeight = Math.max(...edges.map((edge) => Number(edge.count || 1)), 1);

    labNodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / labNodes.length - Math.PI / 2;
      positions[node.id] = {
        x: cx + Math.cos(angle) * 118,
        y: cy + Math.sin(angle) * 82,
        angle
      };
    });

    const strongestLabFor = {};
    edges.forEach((edge) => {
      const sourceIsLab = labNodes.some((node) => node.id === edge.source);
      const targetIsLab = labNodes.some((node) => node.id === edge.target);
      const labId = sourceIsLab ? edge.source : targetIsLab ? edge.target : "";
      const otherId = sourceIsLab ? edge.target : targetIsLab ? edge.source : "";
      if (!labId || !otherId || !visibleIds.has(otherId)) return;
      const current = strongestLabFor[otherId];
      if (!current || Number(edge.count || 0) > current.count) {
        strongestLabFor[otherId] = { labId, count: Number(edge.count || 0) };
      }
    });

    coauthorNodes.forEach((node, index) => {
      const strongest = strongestLabFor[node.id];
      const labPos = strongest ? positions[strongest.labId] : null;
      const baseAngle = labPos ? labPos.angle : (index * 2.399963229728653);
      const ring = index < 18 ? 1 : index < 44 ? 2 : 3;
      const spread = ((index % 9) - 4) * 0.13;
      const angle = baseAngle + spread + (ring - 1) * 0.08;
      const radius = ring === 1 ? 202 : ring === 2 ? 258 : 312;
      const yScale = 0.72;
      positions[node.id] = {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius * yScale,
        angle
      };
    });

    function pathFor(edge) {
      const a = positions[edge.source];
      const b = positions[edge.target];
      if (!a || !b) return "";
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const curve = 0.12;
      const qx = mx - dy * curve;
      const qy = my + dx * curve * 0.45;
      return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }

    const nodeById = Object.fromEntries([...labNodes, ...coauthorNodes].map((node) => [node.id, node]));
    const edgeMarkup = edges.map((edge) => {
      const source = nodeById[edge.source];
      const target = nodeById[edge.target];
      const count = Number(edge.count || 1);
      const sourceLab = source && source.type === "lab";
      const targetLab = target && target.type === "lab";
      const internal = sourceLab && targetLab;
      const width = 0.65 + Math.sqrt(count / maxEdgeWeight) * 5.2;
      return `
        <path class="labnet-edge ${internal ? "labnet-internal" : ""}"
          data-source="${escapeHTML(edge.source)}"
          data-target="${escapeHTML(edge.target)}"
          d="${pathFor(edge)}"
          stroke-width="${width.toFixed(2)}">
          <title>${escapeHTML(source ? source.name : edge.source)} — ${escapeHTML(target ? target.name : edge.target)} · ${escapeHTML(numberOrDash(count))} shared publication${count === 1 ? "" : "s"}</title>
        </path>
      `;
    }).join("");

    const labMarkup = labNodes.map((node) => {
      const p = positions[node.id];
      return `
        <g class="labnet-node labnet-lab" tabindex="0" data-node="${escapeHTML(node.id)}" data-name="${escapeHTML(node.name)}" data-weight="${escapeHTML(node.weight || 0)}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">
          <circle r="18"></circle>
          <text class="labnet-label" y="37" text-anchor="middle">${escapeHTML(labShortName(node.name))}</text>
        </g>
      `;
    }).join("");

    const coauthorMarkup = coauthorNodes.map((node) => {
      const p = positions[node.id];
      const weight = Number(node.weight || 1);
      const r = 4.8 + Math.sqrt(weight / maxNodeWeight) * 13;
      return `
        <g class="labnet-node labnet-coauthor" tabindex="0" data-node="${escapeHTML(node.id)}" data-name="${escapeHTML(node.name)}" data-weight="${escapeHTML(weight)}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">
          <circle r="${r.toFixed(1)}"></circle>
          <text class="labnet-label" y="${(-r - 8).toFixed(1)}" text-anchor="middle">${escapeHTML(labShortName(node.name))}</text>
        </g>
      `;
    }).join("");

    return `
      <div class="lab-network-wrap">
        <svg class="lab-network-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="MAPLab collaboration network">
          <defs>
            <filter id="labnet-shadow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="8" stdDeviation="6" flood-color="#13202b" flood-opacity="0.18"/>
            </filter>
            <filter id="labnet-soft-shadow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#13202b" flood-opacity="0.10"/>
            </filter>
          </defs>
          <rect x="0" y="0" width="${width}" height="${height}" rx="28" fill="url(#labnet-bg)"></rect>
          <defs>
            <radialGradient id="labnet-bg" cx="50%" cy="45%" r="70%">
              <stop offset="0%" stop-color="#ffffff"/>
              <stop offset="62%" stop-color="#f7fbfd"/>
              <stop offset="100%" stop-color="#edf5f8"/>
            </radialGradient>
          </defs>
          ${edgeMarkup}
          ${coauthorMarkup}
          ${labMarkup}
        </svg>
        <div class="lab-network-tooltip" data-lab-network-tooltip>
          Hover over a node to highlight collaborations.
        </div>
      </div>
    `;
  }

  function activateLabNetwork(section) {
    const svg = section.querySelector(".lab-network-svg");
    const tooltip = section.querySelector("[data-lab-network-tooltip]");
    if (!svg || !tooltip) return;

    const nodes = Array.from(svg.querySelectorAll(".labnet-node"));
    const edges = Array.from(svg.querySelectorAll(".labnet-edge"));

    function setActive(id, name, weight) {
      svg.classList.add("has-active");
      nodes.forEach((node) => {
        node.classList.toggle("is-active", node.dataset.node === id);
      });
      edges.forEach((edge) => {
        const active = edge.dataset.source === id || edge.dataset.target === id;
        edge.classList.toggle("is-active", active);
        if (active) {
          const other = edge.dataset.source === id ? edge.dataset.target : edge.dataset.source;
          const otherNode = nodes.find((node) => node.dataset.node === other);
          if (otherNode) otherNode.classList.add("is-active");
        }
      });
      tooltip.innerHTML = `<strong>${escapeHTML(name)}</strong>${weight ? ` · ${escapeHTML(numberOrDash(weight))} shared publication${Number(weight) === 1 ? "" : "s"}` : ""}`;
    }

    function clearActive() {
      svg.classList.remove("has-active");
      nodes.forEach((node) => node.classList.remove("is-active"));
      edges.forEach((edge) => edge.classList.remove("is-active"));
      tooltip.textContent = "Hover over a node to highlight collaborations.";
    }

    nodes.forEach((node) => {
      const show = () => setActive(node.dataset.node, node.dataset.name, node.dataset.weight);
      node.addEventListener("mouseenter", show);
      node.addEventListener("focus", show);
      node.addEventListener("mouseleave", clearActive);
      node.addEventListener("blur", clearActive);
    });
  }


  const LAB_STOPWORDS = new Set([
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
    "responses", "significant", "task", "tasks", "test", "toward", "towards"
  ]);

  function normalizeName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[.,]/g, " ")
      .replace(/[^a-zA-Z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function splitBibEntries(text) {
    const entries = [];
    let i = 0;

    while (i < text.length) {
      const at = text.indexOf("@", i);
      if (at < 0) break;
      const brace = text.indexOf("{", at);
      if (brace < 0) break;

      let depth = 0;
      let end = brace;
      while (end < text.length) {
        const char = text[end];
        if (char === "{") depth += 1;
        if (char === "}") {
          depth -= 1;
          if (depth === 0) {
            end += 1;
            break;
          }
        }
        end += 1;
      }

      entries.push(text.slice(at, end));
      i = end;
    }

    return entries;
  }

  function cleanBibValue(value) {
    return String(value || "")
      .replaceAll("\\_", "_")
      .replaceAll("\\&", "&")
      .replaceAll("\\%", "%")
      .replaceAll("\\$", "$")
      .replaceAll("\\#", "#")
      .replaceAll("\\{", "{")
      .replaceAll("\\}", "}")
      .replaceAll("\\textbackslash{}", "\\")
      .replaceAll("\\textasciitilde{}", "~")
      .replaceAll("\\textasciicircum{}", "^")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseBibFields(body) {
    const fields = {};
    let pos = 0;

    while (pos < body.length) {
      const rest = body.slice(pos);
      const match = rest.match(/\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*/);
      if (!match) break;

      pos += match.index + match[0].length;
      const name = match[1].toLowerCase();
      let value = "";

      if (body[pos] === "{") {
        let depth = 0;
        const start = pos + 1;
        let end = start;
        while (end < body.length) {
          if (body[end] === "{") depth += 1;
          if (body[end] === "}") {
            if (depth === 0) break;
            depth -= 1;
          }
          end += 1;
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
        const start = pos;
        let end = start;
        while (end < body.length && body[end] !== ",") end += 1;
        value = body.slice(start, end);
        pos = end;
      }

      fields[name] = cleanBibValue(value);

      const comma = body.indexOf(",", pos);
      if (comma < 0) break;
      pos = comma + 1;
    }

    return fields;
  }

  function parseBibTeXForLab(text) {
    return splitBibEntries(text).map((raw) => {
      const header = raw.match(/^@([^{]+)\{\s*([^,]+),/);
      if (!header) return null;
      const body = raw.slice(header[0].length, -1);
      return {
        type: header[1].trim().toLowerCase(),
        key: header[2].trim(),
        fields: parseBibFields(body)
      };
    }).filter(Boolean);
  }

  function splitBibAuthors(authorField) {
    return String(authorField || "")
      .split(/\s+and\s+/i)
      .map((author) => cleanBibValue(author).trim())
      .filter(Boolean);
  }

  function bibAuthorDisplayName(author) {
    const clean = cleanBibValue(author);
    if (clean.includes(",")) {
      const parts = clean.split(",").map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) return `${parts.slice(1).join(" ")} ${parts[0]}`.replace(/\s+/g, " ").trim();
    }
    return clean;
  }

  function nameMatchesAlias(name, aliases) {
    const n = normalizeName(name);
    const variants = new Set([n]);

    if (name.includes(",")) {
      const parts = name.split(",").map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        variants.add(normalizeName(`${parts[1]} ${parts[0]}`));
        variants.add(normalizeName(`${parts[0]} ${parts[1]}`));
      }
    } else {
      const parts = String(name || "").split(/\s+/).filter(Boolean);
      if (parts.length >= 2) variants.add(normalizeName(`${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`));
    }

    const aliasVariants = (aliases || []).map(normalizeName).filter(Boolean);
    return aliasVariants.some((alias) => {
      return Array.from(variants).some((variant) => {
        return variant === alias || (variant.length >= 8 && alias.length >= 8 && (variant.includes(alias) || alias.includes(variant)));
      });
    });
  }

  function profileAliases(profile) {
    return [profile.name, profile.shortName, ...(profile.aliases || [])].filter(Boolean);
  }

  function isLabMemberName(name, profiles) {
    return profiles.some((profile) => nameMatchesAlias(name, profileAliases(profile)));
  }

  function labSlugsForEntry(entry, profiles) {
    const fields = entry.fields || {};
    const explicit = fields.maplab_slugs || "";
    if (explicit) {
      const slugs = explicit.split(/\s*(?:;|\||,)\s*/).map((item) => item.trim()).filter(Boolean);
      return slugs.filter((slug) => profiles.some((profile) => profile.slug === slug));
    }

    const mappedNames = (fields.maplab_people || "")
      .split(/\s*(?:;|\||, and | and )\s*/i)
      .map((item) => item.trim())
      .filter(Boolean);

    const slugs = new Set();
    mappedNames.forEach((name) => {
      profiles.forEach((profile) => {
        if (nameMatchesAlias(name, profileAliases(profile))) slugs.add(profile.slug);
      });
    });

    if (slugs.size) return Array.from(slugs);

    const authors = splitBibAuthors(fields.author || "").map(bibAuthorDisplayName);
    profiles.forEach((profile) => {
      const aliases = profileAliases(profile);
      if (authors.some((author) => nameMatchesAlias(author, aliases))) slugs.add(profile.slug);
    });

    return Array.from(slugs);
  }

  function canonicalCoauthorKey(author) {
    const display = bibAuthorDisplayName(author).replace(/\b([A-Z])\.\s*/g, "$1 ");
    const parts = normalizeName(display).split(/\s+/).filter(Boolean);
    if (!parts.length) return "";
    const surname = parts[parts.length - 1];
    const initials = parts.slice(0, -1).map((part) => part[0]).join("");
    return initials ? `${surname}:${initials.slice(0, 2)}` : surname;
  }

  function betterName(current, candidate) {
    if (!current) return candidate;
    const score = (name) => {
      const parts = bibAuthorDisplayName(name).split(/\s+/).filter((part) => part.replace(/\./g, "").length > 1);
      return [parts.length, name.length];
    };
    const a = score(current);
    const b = score(candidate);
    return b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? candidate : current;
  }

  function tokenizeLabText(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9à-ÿ\- ]+/g, " ")
      .split(/\s+/)
      .map((word) => word.replace(/^-+|-+$/g, ""))
      .filter((word) => word.length >= 4 && !LAB_STOPWORDS.has(word) && !/^\d+$/.test(word));
  }

  function keywordCountsFromTitles(titles) {
    const counts = new Map();
    const add = (key, inc = 1) => counts.set(key, (counts.get(key) || 0) + inc);

    titles.forEach((title) => {
      const words = tokenizeLabText(title);
      words.forEach((word) => add(word, 1));
      words.slice(0, -1).forEach((word, index) => {
        const phrase = `${word} ${words[index + 1]}`;
        if (word !== words[index + 1]) add(phrase, 1.3);
      });
    });

    return Array.from(counts.entries())
      .filter(([, value]) => value >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 70)
      .map(([text, value]) => ({ text, value: Math.round(value) }));
  }

  function buildLabAtlasFromBibTeX(entries, profiles) {
    const nodeMap = new Map();
    const edgeMap = new Map();
    const titles = [];

    function ensureNode(id, name, type, category = "") {
      if (!nodeMap.has(id)) {
        nodeMap.set(id, {
          id,
          name,
          type,
          category,
          documents: 0,
          total_link_strength: 0,
          cluster: 0
        });
      }
      return nodeMap.get(id);
    }

    function edgeKey(a, b) {
      return [a, b].sort().join("||");
    }

    entries.forEach((entry) => {
      const fields = entry.fields || {};
      if (fields.title) titles.push(fields.title);

      const authorsRaw = splitBibAuthors(fields.author || "").map(bibAuthorDisplayName).filter(Boolean);
      if (!authorsRaw.length) return;

      const participants = [];
      const seen = new Set();
      const hasLab = authorsRaw.some((authorName) => profiles.some((profile) => nameMatchesAlias(authorName, profileAliases(profile))));
      if (!hasLab) return;

      authorsRaw.forEach((authorName) => {
        let matchedProfile = null;
        for (const profile of profiles) {
          if (nameMatchesAlias(authorName, profileAliases(profile))) {
            matchedProfile = profile;
            break;
          }
        }

        let nodeId;
        let node;
        if (matchedProfile) {
          nodeId = matchedProfile.slug;
          node = ensureNode(nodeId, matchedProfile.name, "lab", matchedProfile.category || "");
        } else {
          const canonical = canonicalCoauthorKey(authorName);
          if (!canonical) return;
          nodeId = `co:${canonical}`;
          node = ensureNode(nodeId, authorName, "external", "");
        }

        if (!seen.has(nodeId)) {
          seen.add(nodeId);
          node.documents += 1;
          participants.push(nodeId);
        }
      });

      for (let i = 0; i < participants.length; i += 1) {
        for (let j = i + 1; j < participants.length; j += 1) {
          const source = participants[i];
          const target = participants[j];
          const key = edgeKey(source, target);
          if (!edgeMap.has(key)) {
            edgeMap.set(key, { source, target, count: 0, type: "coauthorship" });
          }
          edgeMap.get(key).count += 1;
        }
      }
    });

    for (const edge of edgeMap.values()) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (a) a.total_link_strength += edge.count;
      if (b) b.total_link_strength += edge.count;
    }

    const labNodes = [];
    const externalNodes = [];
    for (const profile of profiles) {
      const node = nodeMap.get(profile.slug) || ensureNode(profile.slug, profile.name, "lab", profile.category || "");
      labNodes.push(node);
    }
    for (const node of nodeMap.values()) {
      if (node.type !== "lab") externalNodes.push(node);
    }

    externalNodes.sort((a, b) => (b.total_link_strength - a.total_link_strength) || (b.documents - a.documents) || a.name.localeCompare(b.name));
    const keptExternal = externalNodes.slice(0, 280);
    const keepIds = new Set([...labNodes, ...keptExternal].map((node) => node.id));

    const edges = Array.from(edgeMap.values())
      .filter((edge) => keepIds.has(edge.source) && keepIds.has(edge.target))
      .sort((a, b) => b.count - a.count);

    // Weighted label propagation for lightweight VOSviewer-like clusters.
    const adjacency = new Map();
    const nodes = [...labNodes, ...keptExternal];
    nodes.forEach((node) => adjacency.set(node.id, []));
    edges.forEach((edge) => {
      adjacency.get(edge.source)?.push({ id: edge.target, weight: edge.count });
      adjacency.get(edge.target)?.push({ id: edge.source, weight: edge.count });
    });

    const labels = new Map(nodes.map((node) => [node.id, node.id]));
    const order = [...nodes].sort((a, b) => (b.total_link_strength - a.total_link_strength) || (b.documents - a.documents));
    for (let iter = 0; iter < 18; iter += 1) {
      let changed = false;
      for (const node of order) {
        const neighborWeights = new Map();
        for (const neighbor of adjacency.get(node.id) || []) {
          const label = labels.get(neighbor.id) || neighbor.id;
          neighborWeights.set(label, (neighborWeights.get(label) || 0) + neighbor.weight);
        }
        if (!neighborWeights.size) continue;
        let bestLabel = labels.get(node.id);
        let bestWeight = -1;
        Array.from(neighborWeights.entries())
          .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
          .forEach(([label, weight]) => {
            if (weight > bestWeight) {
              bestWeight = weight;
              bestLabel = label;
            }
          });
        if (bestLabel !== labels.get(node.id)) {
          labels.set(node.id, bestLabel);
          changed = true;
        }
      }
      if (!changed) break;
    }

    const clusterMap = new Map();
    let clusterIndex = 0;
    nodes.forEach((node) => {
      const root = labels.get(node.id) || node.id;
      if (!clusterMap.has(root)) clusterMap.set(root, clusterIndex++);
      node.cluster = clusterMap.get(root);
    });

    return {
      slug: "lab",
      name: "MAPLab",
      generated_at: "",
      source: "Client-side fallback from data/publications.bib",
      title_based_keywords: true,
      abstracts_used: false,
      keywords: keywordCountsFromTitles(titles),
      network: {
        nodes,
        edges,
        stats: {
          lab_members: labNodes.length,
          external_collaborators: keptExternal.length,
          edges: edges.length
        }
      }
    };
  }

  async function ensureD3() {
    if (window.d3) return window.d3;
    if (window.__maplabD3Promise) return window.__maplabD3Promise;

    window.__maplabD3Promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js";
      script.async = true;
      script.onload = () => resolve(window.d3);
      script.onerror = () => reject(new Error("Could not load D3"));
      document.head.appendChild(script);
    });

    return window.__maplabD3Promise;
  }

  function injectLabAtlasVOSStyles() {
    if ($("#lab-atlas-vos-styles")) return;

    const style = document.createElement("style");
    style.id = "lab-atlas-vos-styles";
    style.textContent = `
      .lab-network-card {
        padding: clamp(0.85rem, 1.5vw, 1.1rem);
      }

      .lab-network-toolbar-deluxe {
        align-items: stretch;
        gap: 0.85rem;
        margin: 0 0 0.9rem;
      }

      .lab-network-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
        align-items: center;
      }

      .lab-network-controls label {
        min-height: 2.45rem;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.35rem 0.55rem;
        border: 1px solid rgba(220, 227, 234, 0.95);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.74);
        color: var(--muted, #5d6a75);
        font-size: 0.8rem;
        font-weight: 720;
      }

      .lab-network-controls label span:first-child {
        color: var(--subtle, #7b8893);
        font-size: 0.72rem;
        font-weight: 850;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .lab-search-label input {
        width: min(210px, 38vw);
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--ink, #13202b);
        font: inherit;
        font-weight: 650;
      }

      .lab-network-controls select {
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--navy, #153e5c);
        font: inherit;
        font-weight: 780;
      }

      .lab-network-controls input[type="range"] {
        width: 145px;
        accent-color: var(--blue, #1f6c94);
      }

      .lab-check-label {
        padding-right: 0.7rem !important;
      }

      .lab-check-label input {
        accent-color: var(--blue, #1f6c94);
      }

      .lab-network-actions {
        display: inline-flex;
        gap: 0.5rem;
        align-items: center;
        justify-content: flex-end;
      }

      .lab-network-actions button {
        border: 1px solid rgba(31, 108, 148, 0.15);
        border-radius: 999px;
        background: var(--accent-soft, #e8f3f7);
        color: var(--navy, #153e5c);
        padding: 0.55rem 0.75rem;
        font: inherit;
        font-size: 0.82rem;
        font-weight: 780;
        cursor: pointer;
      }

      .lab-network-actions button:hover {
        background: #dceff5;
      }

      .lab-network-stage-deluxe {
        position: relative;
        min-height: 680px;
        border-radius: 24px;
        overflow: hidden;
        border: 1px solid rgba(226, 232, 236, 0.95);
        background:
          radial-gradient(circle at 14% 16%, rgba(43, 127, 136, 0.10), transparent 23%),
          radial-gradient(circle at 86% 12%, rgba(31, 108, 148, 0.11), transparent 25%),
          linear-gradient(180deg, #fbfdfe, #f4f9fb);
      }

      .lab-network-canvas {
        width: 100%;
        height: 680px;
        display: block;
        cursor: grab;
      }

      .lab-network-canvas:active {
        cursor: grabbing;
      }

      .lab-network-overlay {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      .lab-network-status {
        position: absolute;
        top: 0.95rem;
        right: 0.95rem;
        padding: 0.48rem 0.68rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.88);
        border: 1px solid rgba(220, 227, 234, 0.95);
        color: var(--muted, #5d6a75);
        font-size: 0.78rem;
        box-shadow: 0 10px 24px rgba(19, 32, 43, 0.07);
      }

      .lab-network-tooltip {
        position: absolute;
        left: 0.95rem;
        bottom: 0.95rem;
        max-width: min(460px, calc(100% - 1.9rem));
        padding: 0.82rem 0.95rem;
        border-radius: 17px;
        background: rgba(255, 255, 255, 0.94);
        border: 1px solid rgba(220, 227, 234, 0.95);
        box-shadow: 0 18px 36px rgba(19, 32, 43, 0.09);
        color: var(--muted, #5d6a75);
        font-size: 0.84rem;
        line-height: 1.45;
      }

      .lab-network-tooltip strong {
        display: block;
        color: var(--navy, #153e5c);
        font-size: 0.98rem;
        margin-bottom: 0.18rem;
      }

      .lab-network-footer {
        display: grid;
        gap: 0.5rem;
        margin-top: 0.82rem;
      }

      .lab-network-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 0.48rem 0.72rem;
        color: var(--subtle, #7b8893);
        font-size: 0.76rem;
      }

      .lab-network-legend span {
        display: inline-flex;
        align-items: center;
        gap: 0.34rem;
        padding: 0.28rem 0.48rem;
        border-radius: 999px;
        border: 1px solid rgba(220, 227, 234, 0.8);
        background: rgba(255, 255, 255, 0.7);
      }

      .lab-network-legend i {
        width: 0.72rem;
        height: 0.72rem;
        border-radius: 999px;
        display: inline-block;
      }

      .lab-network-legend em {
        color: var(--subtle, #7b8893);
        font-style: normal;
      }

      .lab-network-hint {
        color: var(--subtle, #7b8893);
        font-size: 0.78rem;
      }

      @media (max-width: 980px) {
        .lab-network-stage-deluxe {
          min-height: 540px;
        }

        .lab-network-canvas {
          height: 540px;
        }

        .lab-network-actions {
          justify-content: flex-start;
        }
      }
    `;
    document.head.appendChild(style);
  }


  function vosTooltipHTML(node) {
    const role = node.type === "lab" ? `MAPLab member${node.category ? ` · ${escapeHTML(node.category)}` : ""}` : "External collaborator";
    return `
      <strong>${escapeHTML(node.name)}</strong>
      <div>${role}</div>
      <div>Documents in network: ${escapeHTML(numberOrDash(node.documents || node.weight || 0))}</div>
      <div>Total link strength: ${escapeHTML(numberOrDash(node.total_link_strength || node.weight || 0))}</div>
    `;
  }

  async function renderVOSLikeLabNetwork(container, network) {
    if (!container || !network || !Array.isArray(network.nodes) || !network.nodes.length) {
      if (container) container.innerHTML = `<div class="note">No collaboration data available yet.</div>`;
      return;
    }

    injectLabAtlasVOSStyles();
    const d3 = await ensureD3();

    const allNodesRaw = network.nodes.map((node) => ({
      ...node,
      documents: Number(node.documents || node.weight || 0),
      total_link_strength: Number(node.total_link_strength || node.weight || 0),
      cluster: Number(node.cluster || 0)
    }));

    const allEdgesRaw = (network.edges || []).map((edge) => ({
      ...edge,
      count: Number(edge.count || 1)
    }));

    const maxWeight = d3.max(allEdgesRaw, (d) => d.count) || 1;
    const maxDocuments = d3.max(allNodesRaw, (d) => d.documents || 1) || 1;
    const maxStrength = d3.max(allNodesRaw, (d) => d.total_link_strength || 1) || 1;
    const maxCluster = d3.max(allNodesRaw, (d) => d.cluster || 0) || 0;

    const clusterPalette = [
      "#1f6c94", "#2b7f88", "#7b5ea7", "#c97b32", "#9b4c77",
      "#2a8a5e", "#5b6c9b", "#b84f4f", "#5e8b2d", "#8b6a2d",
      "#3f7eaa", "#7b8f36"
    ];

    const clusterColor = d3.scaleOrdinal()
      .domain(d3.range(maxCluster + 1))
      .range(clusterPalette);

    const idToNode = new Map(allNodesRaw.map((node) => [node.id, node]));
    const linkStrengthByNode = new Map();
    allNodesRaw.forEach((node) => linkStrengthByNode.set(node.id, 0));
    allEdgesRaw.forEach((edge) => {
      linkStrengthByNode.set(edge.source, (linkStrengthByNode.get(edge.source) || 0) + edge.count);
      linkStrengthByNode.set(edge.target, (linkStrengthByNode.get(edge.target) || 0) + edge.count);
    });

    allNodesRaw.forEach((node) => {
      node.total_link_strength = Math.max(node.total_link_strength || 0, linkStrengthByNode.get(node.id) || 0);
    });

    function clusterName(clusterId) {
      const members = allNodesRaw
        .filter((node) => node.cluster === clusterId && node.type !== "lab")
        .sort((a, b) => (b.total_link_strength - a.total_link_strength) || (b.documents - a.documents))
        .slice(0, 2)
        .map((node) => labShortName(node.name));
      return members.length ? members.join(" / ") : `Cluster ${clusterId + 1}`;
    }

    function defaultMode() {
      return allNodesRaw.length > 260 ? "core" : "full";
    }

    container.innerHTML = `
      <div class="lab-network-toolbar lab-network-toolbar-deluxe">
        <div class="lab-network-controls">
          <label class="lab-search-label">
            <span>Search</span>
            <input type="search" placeholder="author name…" data-network-search>
          </label>

          <label>
            <span>View</span>
            <select data-network-mode>
              <option value="full">Full network</option>
              <option value="core">Core map</option>
              <option value="lab">Lab neighbourhood</option>
              <option value="strong">Strong links</option>
            </select>
          </label>

          <label>
            <span>Minimum shared papers</span>
            <input type="range" min="1" max="${Math.max(1, maxWeight)}" step="1" value="1" data-edge-threshold>
            <strong data-edge-threshold-value>1</strong>
          </label>

          <label class="lab-check-label">
            <input type="checkbox" checked data-network-labels>
            <span>Labels</span>
          </label>
        </div>

        <div class="lab-network-actions">
          <button type="button" data-network-reset>Reset view</button>
          <button type="button" data-network-clear>Clear focus</button>
        </div>
      </div>

      <div class="lab-network-stage lab-network-stage-deluxe">
        <svg class="lab-network-canvas" viewBox="0 0 1040 680" preserveAspectRatio="xMidYMid meet"></svg>
        <div class="lab-network-overlay">
          <div class="lab-network-status" data-lab-network-status></div>
          <div class="lab-network-tooltip" data-lab-network-tooltip>
            Hover a node to inspect an author. Click to keep the focus.
          </div>
        </div>
      </div>

      <div class="lab-network-footer">
        <div class="lab-network-legend" data-cluster-legend></div>
        <div class="lab-network-hint">
          Mouse wheel or trackpad to zoom, drag to pan. Link thickness shows repeated coauthorship.
        </div>
      </div>
    `;

    const svg = d3.select(container.querySelector("svg"));
    const tooltip = container.querySelector("[data-lab-network-tooltip]");
    const status = container.querySelector("[data-lab-network-status]");
    const slider = container.querySelector("[data-edge-threshold]");
    const sliderValue = container.querySelector("[data-edge-threshold-value]");
    const searchInput = container.querySelector("[data-network-search]");
    const modeSelect = container.querySelector("[data-network-mode]");
    const labelsToggle = container.querySelector("[data-network-labels]");
    const resetButton = container.querySelector("[data-network-reset]");
    const clearButton = container.querySelector("[data-network-clear]");
    const clusterLegend = container.querySelector("[data-cluster-legend]");

    if (modeSelect) modeSelect.value = defaultMode();

    const width = 1040;
    const height = 680;

    svg.selectAll("*").remove();

    const defs = svg.append("defs");

    defs.append("filter")
      .attr("id", "vos-glow")
      .attr("x", "-70%")
      .attr("y", "-70%")
      .attr("width", "240%")
      .attr("height", "240%")
      .html(`
        <feGaussianBlur stdDeviation="4.5" result="coloredBlur"></feGaussianBlur>
        <feMerge>
          <feMergeNode in="coloredBlur"></feMergeNode>
          <feMergeNode in="SourceGraphic"></feMergeNode>
        </feMerge>
      `);

    defs.append("filter")
      .attr("id", "vos-node-shadow")
      .attr("x", "-70%")
      .attr("y", "-70%")
      .attr("width", "240%")
      .attr("height", "240%")
      .html(`<feDropShadow dx="0" dy="7" stdDeviation="6" flood-color="#13202b" flood-opacity="0.16"/>`);

    const viewport = svg.append("g").attr("class", "vos-viewport");
    const hullLayer = viewport.append("g").attr("class", "vos-hulls");
    const linkLayer = viewport.append("g").attr("class", "vos-links");
    const nodeLayer = viewport.append("g").attr("class", "vos-nodes");
    const labelLayer = viewport.append("g").attr("class", "vos-labels");

    const zoom = d3.zoom()
      .scaleExtent([0.28, 5.5])
      .on("zoom", (event) => viewport.attr("transform", event.transform));

    svg.call(zoom);
    resetButton.addEventListener("click", () => {
      svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity);
    });

    let pinnedNodeId = "";
    let currentDraw = null;

    function baseNodeRank(node) {
      return (node.type === "lab" ? 100000 : 0) + Number(node.total_link_strength || 0) * 8 + Number(node.documents || 0);
    }

    function filteredGraph() {
      const threshold = Number(slider.value || 1);
      const mode = modeSelect.value || "full";

      let candidateNodes = [...allNodesRaw];
      const labIds = new Set(candidateNodes.filter((node) => node.type === "lab").map((node) => node.id));

      if (mode === "core") {
        const external = candidateNodes
          .filter((node) => node.type !== "lab")
          .sort((a, b) => baseNodeRank(b) - baseNodeRank(a))
          .slice(0, 170);
        candidateNodes = [...candidateNodes.filter((node) => node.type === "lab"), ...external];
      }

      if (mode === "lab") {
        const labLinked = new Set();
        allEdgesRaw.forEach((edge) => {
          if (edge.count < threshold) return;
          const sourceLab = labIds.has(edge.source);
          const targetLab = labIds.has(edge.target);
          if (sourceLab && !targetLab) labLinked.add(edge.target);
          if (targetLab && !sourceLab) labLinked.add(edge.source);
          if (sourceLab && targetLab) {
            labLinked.add(edge.source);
            labLinked.add(edge.target);
          }
        });
        const external = candidateNodes
          .filter((node) => node.type !== "lab" && labLinked.has(node.id))
          .sort((a, b) => baseNodeRank(b) - baseNodeRank(a))
          .slice(0, 220);
        candidateNodes = [...candidateNodes.filter((node) => node.type === "lab"), ...external];
      }

      if (mode === "strong") {
        const autoThreshold = Math.max(threshold, Math.min(maxWeight, Math.max(2, Math.ceil(maxWeight * 0.18))));
        const ids = new Set();
        allEdgesRaw.forEach((edge) => {
          if (edge.count >= autoThreshold) {
            ids.add(edge.source);
            ids.add(edge.target);
          }
        });
        candidateNodes = candidateNodes.filter((node) => node.type === "lab" || ids.has(node.id));
      }

      const keepIds = new Set(candidateNodes.map((node) => node.id));
      let edges = allEdgesRaw.filter((edge) => edge.count >= threshold && keepIds.has(edge.source) && keepIds.has(edge.target));

      if (mode === "strong") {
        const autoThreshold = Math.max(threshold, Math.min(maxWeight, Math.max(2, Math.ceil(maxWeight * 0.18))));
        edges = allEdgesRaw.filter((edge) => edge.count >= autoThreshold && keepIds.has(edge.source) && keepIds.has(edge.target));
      }

      const connectedIds = new Set();
      edges.forEach((edge) => {
        connectedIds.add(edge.source);
        connectedIds.add(edge.target);
      });
      candidateNodes.filter((node) => node.type === "lab").forEach((node) => connectedIds.add(node.id));

      const nodes = candidateNodes.filter((node) => connectedIds.has(node.id));
      const nodeIds = new Set(nodes.map((node) => node.id));
      edges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

      const search = normalizeName(searchInput.value || "");
      let searchMatches = new Set();
      if (search) {
        nodes.forEach((node) => {
          if (normalizeName(node.name).includes(search)) searchMatches.add(node.id);
        });
      }

      return { nodes: nodes.map((node) => ({ ...node })), edges: edges.map((edge) => ({ ...edge })), threshold, mode, searchMatches };
    }

    function updateClusterLegend(nodes) {
      const clusters = Array.from(
        d3.rollups(
          nodes.filter((node) => node.type !== "lab"),
          (items) => ({
            count: items.length,
            strength: d3.sum(items, (item) => Number(item.total_link_strength || 0)),
            label: clusterName(Number(items[0].cluster || 0))
          }),
          (node) => Number(node.cluster || 0)
        )
      )
        .sort((a, b) => b[1].strength - a[1].strength)
        .slice(0, 8);

      clusterLegend.innerHTML = clusters.map(([clusterId, info]) => `
        <span><i style="background:${clusterColor(clusterId)}"></i>${escapeHTML(info.label)} <em>${info.count}</em></span>
      `).join("");
    }

    function labelForNode(node, importantIds, searchMatches) {
      if (node.type === "lab") return true;
      if (searchMatches && searchMatches.has(node.id)) return true;
      return importantIds.has(node.id);
    }

    function draw() {
      const graph = filteredGraph();
      const nodes = graph.nodes;
      const links = graph.edges;

      sliderValue.textContent = String(graph.threshold);
      status.textContent = `${nodes.length} authors · ${links.length} links · ${graph.mode.replaceAll("-", " ")}`;

      updateClusterLegend(nodes);

      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const linkObjects = links
        .map((edge) => ({
          ...edge,
          source: nodeById.get(edge.source),
          target: nodeById.get(edge.target)
        }))
        .filter((edge) => edge.source && edge.target);

      const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(linkObjects)
          .id((d) => d.id)
          .distance((d) => {
            const base = d.source.type === "lab" || d.target.type === "lab" ? 76 : 42;
            return base + 145 / Math.sqrt(d.count || 1);
          })
          .strength((d) => Math.min(0.94, 0.18 + Math.log1p(d.count || 1) * 0.19)))
        .force("charge", d3.forceManyBody().strength((d) => d.type === "lab" ? -620 : -170))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide().radius((d) => {
          const strength = Math.max(Number(d.total_link_strength || 0), Number(d.documents || 1));
          return (d.type === "lab" ? 19 : 6) + Math.sqrt(strength) * 1.35;
        }).iterations(3))
        .force("x", d3.forceX((d) => {
          const cluster = Number(d.cluster || 0);
          const angle = (Math.PI * 2 * cluster) / Math.max(3, maxCluster + 1);
          return width / 2 + Math.cos(angle) * (d.type === "lab" ? 55 : 150);
        }).strength((d) => d.type === "lab" ? 0.045 : 0.032))
        .force("y", d3.forceY((d) => {
          const cluster = Number(d.cluster || 0);
          const angle = (Math.PI * 2 * cluster) / Math.max(3, maxCluster + 1);
          return height / 2 + Math.sin(angle) * (d.type === "lab" ? 38 : 112);
        }).strength((d) => d.type === "lab" ? 0.045 : 0.032));

      simulation.stop();
      for (let i = 0; i < 360; i += 1) simulation.tick();

      const edgeWidth = d3.scaleSqrt().domain([1, maxWeight]).range([0.35, 5.8]);
      const radiusScale = d3.scaleSqrt().domain([1, Math.max(maxDocuments, maxStrength)]).range([4.2, 21]);
      const labelImportantIds = new Set(
        [...nodes]
          .filter((node) => node.type !== "lab")
          .sort((a, b) => baseNodeRank(b) - baseNodeRank(a))
          .slice(0, 26)
          .map((node) => node.id)
      );

      const linked = new Map();
      linkObjects.forEach((edge) => {
        linked.set(`${edge.source.id}||${edge.target.id}`, edge.count);
        linked.set(`${edge.target.id}||${edge.source.id}`, edge.count);
      });

      hullLayer.selectAll("*").remove();
      linkLayer.selectAll("*").remove();
      nodeLayer.selectAll("*").remove();
      labelLayer.selectAll("*").remove();

      const hullGroups = d3.groups(nodes.filter((node) => node.type !== "lab"), (node) => node.cluster)
        .filter(([, items]) => items.length >= 4);

      hullLayer.selectAll("path")
        .data(hullGroups)
        .enter()
        .append("path")
        .attr("d", ([, items]) => {
          const points = items.map((node) => [node.x, node.y]);
          const hull = d3.polygonHull(points);
          if (!hull) return "";
          return `M${hull.map((point) => point.join(",")).join("L")}Z`;
        })
        .attr("fill", ([cluster]) => clusterColor(cluster))
        .attr("opacity", 0.055)
        .attr("stroke", ([cluster]) => clusterColor(cluster))
        .attr("stroke-opacity", 0.15)
        .attr("stroke-width", 1);

      const linkSelection = linkLayer.selectAll("line")
        .data(linkObjects)
        .enter()
        .append("line")
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y)
        .attr("stroke", (d) => {
          if (d.source.type === "lab" && d.target.type === "lab") return "rgba(21, 62, 92, 0.34)";
          return "rgba(73, 121, 150, 0.24)";
        })
        .attr("stroke-width", (d) => edgeWidth(d.count))
        .attr("stroke-linecap", "round");

      const nodeSelection = nodeLayer.selectAll("circle")
        .data(nodes)
        .enter()
        .append("circle")
        .attr("cx", (d) => d.x)
        .attr("cy", (d) => d.y)
        .attr("r", (d) => {
          const value = Math.max(Number(d.total_link_strength || 0), Number(d.documents || 1));
          return d.type === "lab" ? radiusScale(value) + 4 : radiusScale(value);
        })
        .attr("fill", (d) => d.type === "lab" ? "#153e5c" : clusterColor(d.cluster || 0))
        .attr("stroke", (d) => d.type === "lab" ? "#ffffff" : "rgba(255,255,255,0.94)")
        .attr("stroke-width", (d) => d.type === "lab" ? 3 : 1.4)
        .attr("opacity", (d) => graph.searchMatches.size && !graph.searchMatches.has(d.id) ? 0.25 : 0.96)
        .attr("filter", (d) => d.type === "lab" ? "url(#vos-node-shadow)" : null)
        .style("cursor", "pointer");

      const labelsAreOn = labelsToggle.checked;
      const labelNodes = labelsAreOn
        ? nodes.filter((node) => labelForNode(node, labelImportantIds, graph.searchMatches))
        : nodes.filter((node) => node.type === "lab" || graph.searchMatches.has(node.id));

      const labelSelection = labelLayer.selectAll("text")
        .data(labelNodes)
        .enter()
        .append("text")
        .attr("x", (d) => d.x)
        .attr("y", (d) => {
          const value = Math.max(Number(d.total_link_strength || 0), Number(d.documents || 1));
          const r = d.type === "lab" ? radiusScale(value) + 4 : radiusScale(value);
          return d.y - r - 7;
        })
        .attr("text-anchor", "middle")
        .attr("font-size", (d) => d.type === "lab" ? 12.3 : 10.6)
        .attr("font-weight", (d) => d.type === "lab" ? 820 : 690)
        .attr("fill", "#13202b")
        .attr("paint-order", "stroke")
        .attr("stroke", "rgba(255,255,255,0.96)")
        .attr("stroke-width", 3.6)
        .attr("opacity", (d) => graph.searchMatches.size && !graph.searchMatches.has(d.id) && d.type !== "lab" ? 0.25 : 1)
        .text((d) => labShortName(d.name));

      function applyFocus(focusNode, pinned = false) {
        if (!focusNode) {
          if (pinnedNodeId) {
            const pinnedNode = nodes.find((node) => node.id === pinnedNodeId);
            if (pinnedNode) {
              applyFocus(pinnedNode, true);
              return;
            }
          }
          tooltip.innerHTML = "Hover a node to inspect an author. Click to keep the focus.";
          nodeSelection.attr("opacity", (d) => graph.searchMatches.size && !graph.searchMatches.has(d.id) ? 0.25 : 0.96)
            .attr("stroke-width", (d) => d.type === "lab" ? 3 : 1.4);
          linkSelection.attr("opacity", 1).attr("stroke", (d) => d.source.type === "lab" && d.target.type === "lab" ? "rgba(21, 62, 92, 0.34)" : "rgba(73, 121, 150, 0.24)");
          labelSelection.attr("opacity", 1);
          return;
        }

        tooltip.innerHTML = `${vosTooltipHTML(focusNode)}${pinned ? `<div style="margin-top:.28rem;color:#7b8893">Pinned focus. Click Clear focus to reset.</div>` : ""}`;

        nodeSelection
          .attr("opacity", (d) => {
            if (d.id === focusNode.id) return 1;
            return linked.has(`${focusNode.id}||${d.id}`) ? 0.95 : 0.10;
          })
          .attr("stroke-width", (d) => d.id === focusNode.id ? 4.2 : (d.type === "lab" ? 3 : 1.4));

        linkSelection
          .attr("opacity", (d) => (d.source.id === focusNode.id || d.target.id === focusNode.id) ? 1 : 0.055)
          .attr("stroke", (d) => (d.source.id === focusNode.id || d.target.id === focusNode.id) ? "rgba(25, 116, 130, 0.68)" : "rgba(73, 121, 150, 0.18)");

        labelSelection.attr("opacity", (d) => {
          if (d.id === focusNode.id) return 1;
          if (linked.has(`${focusNode.id}||${d.id}`)) return 1;
          if (d.type === "lab") return 0.36;
          return 0.08;
        });
      }

      nodeSelection
        .on("mouseenter", (_event, d) => {
          if (!pinnedNodeId) applyFocus(d);
        })
        .on("mouseleave", () => {
          if (!pinnedNodeId) applyFocus(null);
        })
        .on("click", (event, d) => {
          event.stopPropagation();
          pinnedNodeId = pinnedNodeId === d.id ? "" : d.id;
          applyFocus(pinnedNodeId ? d : null, Boolean(pinnedNodeId));
        });

      svg.on("click", () => {
        pinnedNodeId = "";
        applyFocus(null);
      });

      currentDraw = { applyFocus, nodes };
      applyFocus(null);
    }

    function redraw() {
      pinnedNodeId = "";
      draw();
    }

    draw();

    slider.addEventListener("input", redraw);
    modeSelect.addEventListener("change", redraw);
    labelsToggle.addEventListener("change", redraw);
    searchInput.addEventListener("input", () => {
      pinnedNodeId = "";
      draw();
    });
    clearButton.addEventListener("click", () => {
      pinnedNodeId = "";
      if (currentDraw) currentDraw.applyFocus(null);
    });
  }


  async function renderLabAtlas(profiles) {
    const grid = $("[data-people-grid]");
    if (!grid || $("#lab-collaboration-atlas")) return;

    let data = null;

    try {
      const response = await fetch("data/scopus/lab.json");
      if (response.ok) data = await response.json();
    } catch (error) {
      console.info("Lab-wide Scopus analytics JSON unavailable; falling back to BibTeX.", error);
    }

    if (!data) {
      try {
        const response = await fetch("data/publications.bib");
        if (response.ok) {
          const bibText = await response.text();
          data = buildLabAtlasFromBibTeX(parseBibTeXForLab(bibText), profiles);
        }
      } catch (error) {
        console.info("Could not build lab atlas from BibTeX.", error);
      }
    }

    if (!data) {
      injectLabAtlasStyles();
      const section = document.createElement("section");
      section.className = "lab-atlas";
      section.id = "lab-collaboration-atlas";
      section.innerHTML = `
        <div class="lab-atlas-shell">
          <div class="lab-atlas-head">
            <div>
              <p class="kicker">Lab-wide map</p>
              <h2>Collaboration and research landscape</h2>
              <p>Lab-wide analytics will appear here after <code>data/scopus/lab.json</code> is generated or when <code>data/publications.bib</code> is available.</p>
            </div>
          </div>
        </div>
      `;
      const peopleSection = grid.closest("section") || grid.parentElement;
      if (peopleSection && peopleSection.parentElement) peopleSection.insertAdjacentElement("afterend", section);
      else grid.insertAdjacentElement("afterend", section);
      return;
    }

    injectLabAtlasStyles();

    const section = document.createElement("section");
    section.className = "lab-atlas";
    section.id = "lab-collaboration-atlas";
    section.innerHTML = `
      <div class="lab-atlas-shell">
        <div class="lab-atlas-head">
          <div>
            <p class="kicker">Lab-wide map</p>
            <h2>Collaboration and research landscape</h2>
            <p>A lab-wide coauthorship map built from shared publications. Nodes represent authors, link thickness reflects repeated collaboration, and clusters are estimated from the coauthorship graph.</p>
          </div>
          ${data.generated_at ? `<div class="lab-atlas-date">Updated ${escapeHTML(compactDate(data.generated_at))}</div>` : ""}
        </div>

        <div class="lab-atlas-grid">
          <div class="lab-network-card">
            <div class="lab-card-title">
              <h3>Collaboration constellation</h3>
              <span>VOSviewer-inspired</span>
            </div>
            <div data-lab-network></div>
          </div>

          <div class="lab-cloud-card">
            <div class="lab-card-title">
              <h3>Research keyword cloud</h3>
              <span>lab-wide</span>
            </div>
            ${labKeywordCloudHTML(data.keywords || [])}
            <p class="lab-atlas-note">Generated from publication titles indexed in Scopus/BibTeX. Abstracts are not used because the current Scopus API access does not provide stable abstract retrieval.</p>
          </div>
        </div>
      </div>
    `;

    const peopleSection = grid.closest("section") || grid.parentElement;
    if (peopleSection && peopleSection.parentElement) {
      peopleSection.insertAdjacentElement("afterend", section);
    } else {
      grid.insertAdjacentElement("afterend", section);
    }

    const networkMount = section.querySelector("[data-lab-network]");
    try {
      await renderVOSLikeLabNetwork(networkMount, data.network || data);
    } catch (error) {
      console.error("Could not render collaboration network", error);
      if (networkMount) networkMount.innerHTML = `<div class="note">Could not render the collaboration network.</div>`;
    }
  }


  async function init() {
    const indexURL = document.body.dataset.peopleIndex || "data/people/people.json";
    const people = await fetchJSON(indexURL);
    renderNav(people);

    const profiles = await Promise.all(
      people.map(async (person) => {
        const profile = await fetchJSON(`data/people/${person.slug}.json`);
        return {
          ...profile,
          slug: person.slug,
          shortName: person.shortName || profile.shortName,
          category: categoryFor(profile, person)
        };
      })
    );

    renderPeopleDirectory(profiles);
    renderLabAtlas(profiles);
  }

  init().catch((error) => {
    console.error(error);
    const grid = $("[data-people-grid]");
    if (grid) grid.innerHTML = `<div class="note">Could not load people data.</div>`;
  });
})();
