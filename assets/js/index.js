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

    const profilesByCategory = CATEGORIES.reduce((acc, category) => {
      acc[category.id] = profiles.filter((profile) => profile.category === category.id);
      return acc;
    }, {});

    grid.innerHTML = CATEGORIES
      .filter((category) => profilesByCategory[category.id].length)
      .map((category) => peoplePlane(category, profilesByCategory[category.id]))
      .join("");
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
  }

  init().catch((error) => {
    console.error(error);
    const grid = $("[data-people-grid]");
    if (grid) grid.innerHTML = `<div class="note">Could not load people data.</div>`;
  });
})();
