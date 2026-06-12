# MAPLab personal pages for GitHub Pages

This package contains a simple static site for four individual MAPLab profiles:

- Alessandro Benedetto
- Roberto Arrighi
- Giovanni Anobile
- Elisa Castaldi

The pages are designed for the repository `florencemaplab/maplab` and should work directly with GitHub Pages.

## File structure

```text
.
├── index.html
├── people/
│   ├── alessandro-benedetto.html
│   ├── roberto-arrighi.html
│   ├── giovanni-anobile.html
│   └── elisa-castaldi.html
├── data/
│   └── publications.bib
├── assets/
│   ├── css/style.css
│   ├── js/person.js
│   └── images/
│       ├── alessandro-benedetto.jpg
│       ├── roberto-arrighi.jpg
│       ├── giovanni-anobile.jpeg
│       └── elisa-castaldi.jpg
├── cv/
└── .nojekyll
```

## Style

The design is intentionally minimal: plain white background, simple navigation, one profile photo, profile metadata, research/CV sections, and a searchable publication list.

## Images

The profile photos included here come from the public PisaVisionLab member pages. Review permissions before publication if needed.

## How publications work

All profile pages load the same BibTeX file:

```text
data/publications.bib
```

Each personal page contains a line like this in the `<body>` tag:

```html
<body data-bib-url="../data/publications.bib" data-author-aliases="Alessandro Benedetto|Benedetto Alessandro|Benedetto, Alessandro|Benedetto, A|A Benedetto">
```

The JavaScript file `assets/js/person.js` loads the BibTeX file and filters entries by those aliases.

## Add a new publication

Add a normal BibTeX entry to `data/publications.bib`:

```bibtex
@article{surname2026shorttitle,
  author = {Surname, Name and Benedetto, Alessandro and Arrighi, Roberto},
  title = {Title of the paper},
  journal = {Journal Name},
  year = {2026},
  doi = {10.xxxx/example}
}
```

Once committed, it will appear automatically on every matching author page.

## Add CV PDFs

Put CV PDFs in:

```text
cv/
```

Then update the CV links inside the profile pages.

## Suggested public URLs after upload

If GitHub Pages is active for `florencemaplab/maplab`, the pages should be available at:

```text
https://florencemaplab.github.io/maplab/people/alessandro-benedetto.html
https://florencemaplab.github.io/maplab/people/roberto-arrighi.html
https://florencemaplab.github.io/maplab/people/giovanni-anobile.html
https://florencemaplab.github.io/maplab/people/elisa-castaldi.html
```

## Notes before publishing

The profile text is drafted from public official profile information. Review names, roles, CV highlights, teaching links and publications before final publication. The package intentionally avoids copying full CVs verbatim and avoids sensitive personal details such as home addresses, birth dates and family information.


Publication pages automatically group records by year and include an All years/year filter generated from `data/publications.bib`.
