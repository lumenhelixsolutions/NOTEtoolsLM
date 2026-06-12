# NOTEtoolsLM v2 — Build-First 10 Milestone Plan

**Date:** 2026-06-10  
**Status:** M1–M10 complete  
**Scope:** Complete existing features — no Chrome Web Store launch, workspaces, or i18n yet.

| Milestone | Theme | Target | Status |
|-----------|-------|--------|--------|
| M1 | Real SDK pipeline | v2.3.0 | ✅ |
| M2 | SDK auth UX | v2.3.0 | ✅ |
| M3 | Job queue reliability | v2.4.0 | ✅ |
| M4 | Vault & downloads | v2.4.0 | ✅ |
| M5 | Fleet sync & scraping | v2.5.0 | ✅ |
| M6 | Extension ↔ server parity | v2.5.0 | ✅ |
| M7 | Dashboard UX polish | v2.6.0 | ✅ |
| M8 | Prefab quality | v2.7.0 | ✅ |
| M9 | Inspector & CDI | v2.7.0 | ✅ |
| M10 | Tests & dev ergonomics | v2.8.0 | ✅ |

## M6 — Extension ↔ Server Parity
- [x] Dashboard JWT auth gate with Bearer tokens on all API calls
- [x] Extension merges server catalog after discovery sync
- [x] Extension prefab grid with `/api/generate` + DOM inject fallback
- [x] Extension inspector calls `/api/inspector/:id` for CDI metrics

## M7 — Dashboard UX Polish
- [x] Light theme CSS variables (`data-theme="light"`)
- [x] Recent activity feed on dashboard tab
- [x] Storage file preview/download via `/api/vault/files/serve`
- [x] Mobile sidebar toggle (existing responsive CSS)

## M8 — Prefab Quality
- [x] `lib/prefabs.js` — single source of truth from `public/prefabs.json`
- [x] Canonical IDs aligned across server, extension, content script
- [x] `tests/prefabs.test.js` — validation + ID parity checks

## M9 — Inspector & CDI
- [x] `lib/cdi.js` — testable CDI scoring
- [x] Server inspector route uses shared CDI module
- [x] Extension + dashboard show CDI score
- [x] `tests/cdi.test.js`, `tests/api.inspector.test.js`

## M10 — Tests & Dev Ergonomics
- [x] `tests/helpers/http.js` — shared auth + request helpers
- [x] `npm run test:coverage` via c8
- [x] `npm run seed` — `scripts/seed-dev.js` for local dev user + artifacts

**Deferred:** CWS public launch, team workspaces, i18n, portfolio bridges.