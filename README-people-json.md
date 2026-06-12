# MAPLab JSON-based people pages

This update makes the author pages template-based.

## How it works

Each page in `people/` uses the same HTML. The JavaScript derives the slug from the file name:

- `people/giovanni-anobile.html`
- `data/people/giovanni-anobile.json`

So a new author needs only:

1. a copied HTML file from `people/template.html`;
2. a matching JSON file in `data/people/`;
3. one entry added to `data/people/people.json`;
4. aliases in the JSON so publications can be matched from `data/publications.bib`.

## Current order

The navigation and home page use this order:

1. Anobile
2. Arrighi
3. Benedetto
4. Castaldi

Edit `data/people/people.json` to change it.
