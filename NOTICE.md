# Recipe Box — data notice

The recipe dataset bundled in `data/recipes.json` is derived from
[Anduin2017/HowToCook](https://github.com/Anduin2017/HowToCook), which is
released into the **public domain under the Unlicense**.

- Repository: https://github.com/Anduin2017/HowToCook
- License: Unlicense (public domain dedication) — see the upstream `LICENSE`
- Snapshot: fetched from `raw.githubusercontent.com` at build time; each recipe
  keeps its upstream markdown path as `id` and its GitHub blob URL as `url`.
- Images: bundled in two tiers. 346 dish pictures were downloaded from the
  upstream repository and re-encoded as WebP under the same Unlicense:
  `data/images/` (640 px, q72 — cards and lists) and `data/images-hd/`
  (1200 px, q70 — the detail page), 103 MB of originals turning into ~30 MB
  total. Two pictures were originally referenced outside the repository: the
  GitHub user image was downloaded and bundled as
  `external/qingjiao-tudou.webp`; the MSN asset now returns 404 upstream and
  its reference was dropped. The 347 dish images referenced by
  `data/recipes.json` therefore resolve locally, with no hotlinking.
  `data/images/` additionally carries three 640 px spoon-measure diagrams used
  by the kitchen-tips page (`tips/spoon-tablespoon`, `tips/spoon-teaspoon`,
  `tips/spoons-compare`), which have no 1200 px twin. File counts:
  `data/images/` 350 files, `data/images-hd/` 347 files.

Each entry preserves the upstream title, intro, difficulty, calories,
ingredients, steps, tips and image list. Formatting-only edits were made by an
external build script that is not distributed in this repository; no recipe
text was rewritten.

Modifications made here (data cleanup, unit repair, spoon-amount conversion,
layout and search features) are ours; the Unlicense places no share-alike or
attribution condition on derived work. This notice is kept as a courtesy and
to make provenance traceable — no endorsement by the upstream authors is
implied, and the upstream project name and logo are not used as branding.
