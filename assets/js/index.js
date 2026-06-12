(function () {
  const $ = (selector, root = document) => root.querySelector(selector);

  function escapeHTML(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function fetchJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return response.json();
  }

  function renderNav(people) {
    const nav = $("[data-people-nav]");
    if (!nav) return;
    nav.innerHTML = people
      .map((person) => `<a href="people/${escapeHTML(person.slug)}.html">${escapeHTML(person.shortName || person.slug)}</a>`)
      .join("");
  }

  function card(profile) {
    return `
      <a class="person-tile" href="people/${escapeHTML(profile.slug)}.html">
        <img src="${escapeHTML((profile.photo || "").replace("../", ""))}" alt="Photo of ${escapeHTML(profile.name)}">
        <div>
          <h2>${escapeHTML(profile.name)}</h2>
          <p>${escapeHTML(profile.role)}</p>
        </div>
      </a>
    `;
  }

  async function init() {
    const indexURL = document.body.dataset.peopleIndex || "data/people/people.json";
    const people = await fetchJSON(indexURL);
    renderNav(people);

    const profiles = await Promise.all(people.map((person) => fetchJSON(`data/people/${person.slug}.json`)));
    const grid = $("[data-people-grid]");
    if (grid) grid.innerHTML = profiles.map(card).join("");
  }

  init().catch((error) => {
    console.error(error);
    const grid = $("[data-people-grid]");
    if (grid) grid.innerHTML = `<div class="note">Could not load people data.</div>`;
  });
})();
