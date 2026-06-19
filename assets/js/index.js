(function () {
  const $ = (selector, root = document) => root.querySelector(selector);

  const CATEGORIES = [
    {
      id: "faculty",
      label: "Faculty",
      description: "Principal investigators and faculty members of the Florence MAPLab."
    },
    {
      id: "postdoc",
      label: "Post-doc",
      description: "Post-doctoral researchers contributing to MAPLab projects."
    },
    {
      id: "phd",
      label: "PhD",
      description: "Graduate and doctoral researchers in the lab."
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
    if ($("#people-category-styles")) return;

    const style = document.createElement("style");
    style.id = "people-category-styles";
    style.textContent = `
      .people-window {
        display: grid;
        gap: 1rem;
      }

      .people-category-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        padding: 0.5rem;
        border: 1px solid rgba(220, 227, 234, 0.92);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.78);
        width: fit-content;
        max-width: 100%;
      }

      .people-category-tab {
        appearance: none;
        border: 1px solid transparent;
        border-radius: 999px;
        background: transparent;
        color: var(--muted, #5d6a75);
        cursor: pointer;
        font: inherit;
        font-size: 0.9rem;
        font-weight: 750;
        padding: 0.52rem 0.78rem;
        transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
      }

      .people-category-tab:hover,
      .people-category-tab:focus {
        color: var(--navy, #153e5c);
        outline: none;
        background: var(--accent-soft, #e8f3f7);
      }

      .people-category-tab.is-active {
        color: #fff;
        background: linear-gradient(135deg, var(--navy, #153e5c), var(--blue, #1f6c94));
        border-color: transparent;
        box-shadow: 0 8px 18px rgba(31, 108, 148, 0.16);
      }

      .people-category-summary {
        color: var(--muted, #5d6a75);
        max-width: 64ch;
        margin: -0.25rem 0 0;
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

      .person-tile[data-category="postdoc"] {
        border-color: rgba(43, 127, 136, 0.22);
      }

      .person-tile[data-category="phd"] {
        border-color: rgba(31, 108, 148, 0.18);
      }

      @media (max-width: 560px) {
        .people-category-tabs {
          border-radius: 18px;
          width: 100%;
        }

        .people-category-tab {
          flex: 1 1 auto;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function renderNav(people) {
    const nav = $("[data-people-nav]");
    if (!nav) return;

    nav.innerHTML = people
      .map((person) => `<a href="people/${escapeHTML(person.slug)}.html">${escapeHTML(person.shortName || person.slug)}</a>`)
      .join("");
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

  function preparePeopleWindow(grid) {
    const existingWindow = grid.closest(".people-window");
    if (existingWindow) return existingWindow;

    const wrapper = document.createElement("div");
    wrapper.className = "people-window";
    grid.parentNode.insertBefore(wrapper, grid);
    wrapper.appendChild(grid);
    return wrapper;
  }

  function renderPeopleDirectory(profiles) {
    const grid = $("[data-people-grid]");
    if (!grid) return;

    injectPeopleStyles();

    const wrapper = preparePeopleWindow(grid);
    let tabs = $("[data-people-category-tabs]", wrapper);
    let summary = $("[data-people-category-summary]", wrapper);

    if (!tabs) {
      tabs = document.createElement("div");
      tabs.className = "people-category-tabs";
      tabs.dataset.peopleCategoryTabs = "";
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", "People categories");
      wrapper.insertBefore(tabs, grid);
    }

    if (!summary) {
      summary = document.createElement("p");
      summary.className = "people-category-summary";
      summary.dataset.peopleCategorySummary = "";
      wrapper.insertBefore(summary, grid);
    }

    const profilesByCategory = CATEGORIES.reduce((acc, category) => {
      acc[category.id] = profiles.filter((profile) => profile.category === category.id);
      return acc;
    }, {});

    tabs.innerHTML = CATEGORIES
      .filter((category) => profilesByCategory[category.id].length)
      .map((category, index) => {
        const count = profilesByCategory[category.id].length;
        return `
          <button
            type="button"
            class="people-category-tab${index === 0 ? " is-active" : ""}"
            data-people-category="${escapeHTML(category.id)}"
            aria-pressed="${index === 0 ? "true" : "false"}"
          >
            ${escapeHTML(category.label)} <span aria-hidden="true">· ${count}</span>
          </button>
        `;
      })
      .join("");

    function showCategory(categoryId) {
      const category = CATEGORIES.find((item) => item.id === categoryId) || CATEGORIES[0];
      const selectedProfiles = profilesByCategory[category.id] || [];

      tabs.querySelectorAll("[data-people-category]").forEach((button) => {
        const active = button.dataset.peopleCategory === category.id;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });

      summary.textContent = category.description;
      grid.innerHTML = selectedProfiles.map(personCard).join("");
    }

    tabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-people-category]");
      if (!button) return;
      showCategory(button.dataset.peopleCategory);
    });

    const firstCategory = CATEGORIES.find((category) => profilesByCategory[category.id].length);
    showCategory(firstCategory ? firstCategory.id : "faculty");
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
