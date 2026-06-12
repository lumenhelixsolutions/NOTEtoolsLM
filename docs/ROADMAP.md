# NOTEtoolsLM v2 — Roadmap

## Current Release

### v2.0.0-beta (2026-06-05)
- [x] Fleet dashboard with WebSocket real-time updates
- [x] Chrome Extension MV3 (side panel + content script + background)
- [x] 8 content prefabs (audio, video, slides, maps, reports)
- [x] Local vault storage with typed directories
- [x] Playwright-based UI scraping fallback
- [x] NotebookLM SDK integration (with graceful degradation)
- [x] Bulk operations (select, download, store, delete)
- [x] Inspector panel with CDI score
- [x] Onboarding flow

## Completed Milestones

### v2.2.0 — Server-Side Auth & Security
- [x] JWT-based authentication with 7-day expiry
- [x] User registration and login with bcrypt-hashed passwords
- [x] SQLite user storage
- [x] Token refresh endpoint
- [x] Global auth middleware with public-path exceptions
- [x] Brute-force protection via `express-slow-down`
- [x] Password strength validation
- [x] Account lockout after 5 failed attempts (15 min cooldown)
- [x] Extension login gate with auto-refresh

## Next plan (2026-06-12) — API power focus

**Research + 5 milestones + 5 evolution (sources & studio media only):**  
[`docs/plans/2026-06-12-notetoolslm-api-power-5x5.md`](plans/2026-06-12-notetoolslm-api-power-5x5.md)

**Executable session (promptPACK handoff packets per milestone):**  
[`docs/plans/2026-06-12-notetoolslm-promptpack-5x5-session.md`](plans/2026-06-12-notetoolslm-promptpack-5x5-session.md)

| Milestone | Theme | Target |
|-----------|-------|--------|
| M1 | SDK foundation repair | v2.9.0 |
| M2 | Sources command center (bulk add/delete/research) | v3.0.0 |
| M3 | Studio media factory (all artifact types + downloads) | v3.1.0 |
| M4 | Fleet-wide discovery v2 (sources + media inventory) | v3.2.0 |
| M5 | Bulk ops UX (pack import, studio sweep) | v3.3.0 |

Skips: portfolio bridge, team workspaces, multi-provider, open platform (see plan).

Build-first M1–M10 (v2.8.0) remains complete — see below.

## Upcoming Milestones (build-first plan — see `docs/plans/2026-06-10-notetoolslm-10-milestones.md`)

### v2.3.0 — Real SDK Pipeline + Auth UX ✅
- [x] SDK-first job queue with simulation only when `USE_SIMULATION=true`
- [x] Vault persist on job complete (`lib/vault-store.js`)
- [x] `/api/sdk-status` setup steps + generate preflight when SDK required
- [x] Dashboard + extension SDK status indicators
- [x] Dashboard JWT auth gate (Bearer on all API calls)

### v2.4.0 — Vault export & discovery ✅
- [x] Unified artifact dedupe (`lib/artifact-catalog.js`) for API + scrape sources
- [x] `POST /api/discovery/sync` — fleet + SDK scan in one call
- [x] `POST /api/vault/export` — JSON/CSV/MD/ZIP with manifest
- [x] `POST /api/artifacts/bulk-store` — parallel vault persistence
- [x] Extension merge uses fingerprint dedupe (not id-only)

### v2.5.0 — Extension ↔ Server Parity ✅
- [x] Extension server catalog merge after discovery sync
- [x] Extension prefab grid with server `/api/generate`
- [x] Canonical prefab IDs across all surfaces (`lib/prefabs.js`)

### v2.6.0 — Dashboard UX Polish ✅
- [x] Light theme support
- [x] Recent activity feed
- [x] Vault file preview/download endpoints

### v2.7.0 — Inspector & CDI ✅
- [x] `lib/cdi.js` shared scoring module
- [x] Extension inspector shows CDI from server API

### v2.8.0 — Tests & Dev Ergonomics ✅
- [x] Prefab, CDI, inspector test suites
- [x] `tests/helpers/http.js`, `npm run seed`, `npm run test:coverage`

### v2.1.0 — Backend Realization (partial)
- [x] Streaming progress from SDK wrapper events
- [x] Retry logic for failed SDK calls
- [x] Webhook support for async NotebookLM completion callbacks

### v2.3.0 — Chrome Web Store Launch
- [ ] 1280×800 screenshots (5 required)
- [ ] Promo tiles (small + large)
- [ ] Privacy policy page
- [ ] Store description + keyword optimization
- [ ] Demo GIF for README

### v2.4.0 — Internationalization
- [ ] Extract all strings to `_locales/`
- [ ] French, Spanish, German, Japanese translations
- [ ] RTL layout support

### v2.5.0 — Collaboration
- [ ] Team workspaces (shared project lists)
- [ ] Role-based access (viewer, editor, admin)
- [ ] Shared vault paths (network drive support)

## Stretch Goals

- [ ] Firefox/Edge port (Manifest V2/V3 polyfill)
- [ ] Desktop app wrapper (Tauri or Electron)
- [ ] AI-powered prefab suggestion based on notebook content
- [ ] Integration with Google Drive / Dropbox for vault backup
