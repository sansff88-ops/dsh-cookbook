# Recipe Box — data notice

The recipe dataset bundled in `data/recipes.json` is derived from
[Anduin2017/HowToCook](https://github.com/Anduin2017/HowToCook), which is
released into the **public domain under the Unlicense**.

- Repository: https://github.com/Anduin2017/HowToCook
- License: Unlicense (public domain dedication) — see the upstream `LICENSE`
- Snapshot: fetched from `raw.githubusercontent.com` at build time; each recipe
  keeps its upstream markdown path as `id` and its GitHub blob URL as `url`.
- Images: bundled in two tiers. 346 pictures were downloaded from the upstream
  repository and re-encoded as WebP under the same Unlicense:
  `data/images/` (640 px, q72 — cards and lists) and `data/images-hd/`
  (1200 px, q70 — the detail page), 103 MB of originals turning into ~30 MB
  total. Two pictures were originally referenced outside the repository: the
  GitHub user image was downloaded and bundled as
  `external/qingjiao-tudou.webp`; the MSN asset now returns 404 upstream and
  its reference was dropped. All 347 referenced pictures therefore resolve
  locally, with no hotlinking.

Each entry preserves the upstream title, intro, difficulty, calories,
ingredients, steps, tips and image list. Formatting-only edits were made by the
build script (`recipe-box-build/build.mjs`); no recipe text was rewritten.

Modifications made here (data cleanup, unit repair, spoon-amount conversion,
layout and search features) are ours; the Unlicense places no share-alike or
attribution condition on derived work. This notice is kept as a courtesy and
to make provenance traceable — no endorsement by the upstream authors is
implied, and the upstream project name and logo are not used as branding.
