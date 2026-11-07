# skillpouch-site

Static Vite Multi-Page Application (MPA) introduction and evidence site for SkillPouch's curated Agent Skills (`XAP-11` / `ADR-004`).

## Architecture & Scope Boundaries

- **Single Curated Source**: At build time, `scripts/lib/ingest.mjs` cross-validates `cp2-final-list-20261028.csv` (`status=selected` only: 8 directories, 16 workflow tasks, 48 stages, 34 deduplicated skills) with `xap12-public-fields-by-skill-en-20261029.csv` and `content/taxonomy.json`.
- **Exact Page Inventory**: Generates `62` content HTML pages per locale (`1` home + `8` directories + `16` tasks + `34` skill evidence pages + `3` standard pages: `privacy`, `terms`, `contact`) across `zh` (`zh-Hans`) and `en`, totaling **124 bilingual static HTML pages** plus an optional root `/index.html` redirect to `/zh/index.html`. Standalone stage HTML pages (`/stages/Txx.sx.html`) are never generated.
- **Separated from App Config Source (`ADR-003`)**: This site is a human/search-engine introduction surface. It never fetches R2 `catalogue/v1/...` at browser runtime as its content source, and the SkillPouch desktop app must never use this HTML site as its signed configuration endpoint.
- **Brand & Theme**: Uses Geist typography and published VBG CSS tokens/primitives (`public/assets/vercel-brand.css` with official Vercel wordmark/triangle assets stripped), SkillPouch plain-text brand marks, and implicit OS light/dark theme via `prefers-color-scheme` (no visible theme toggle).

## Commands (`pnpm`)

```bash
# Install dependencies
pnpm install

# Run unit & tamper-detection tests (node:test)
pnpm test

# Validate curation CSVs and regenerate content/page-manifest.json
pnpm run ingest

# Generate .generated/ HTML entries + SEO/GEO public assets and bundle dist/
pnpm run build

# Run 8-dimension automated QA gate against dist/
pnpm run qa

# Run full verification suite (test + build + qa)
pnpm run check

# Start local Vite MPA dev or preview server
pnpm run dev
pnpm run preview
```

## Domain Configuration

Canonical URLs, Open Graph URLs, `hreflang` links, `robots.txt`, `sitemap.xml`, and `llms.txt` default to `https://skillpouch.tools.place` and can be overridden via `SITE_ORIGIN` at build and QA time:

```bash
SITE_ORIGIN=https://skillpouch.tools.place pnpm run build
SITE_ORIGIN=https://skillpouch.tools.place pnpm run qa
```
