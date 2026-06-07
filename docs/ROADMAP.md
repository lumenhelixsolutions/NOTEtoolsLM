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

## Upcoming Milestones

### v2.1.0 — Backend Realization (In Progress)
- [x] Replace simulated `processJob()` with real NotebookLM SDK artifact creation
- [x] Add streaming progress from SDK (not timed delays)
- [x] Retry logic for failed SDK calls
- [x] Webhook support for async NotebookLM completion callbacks

### v2.2.0 — Monetization & Tiers
- [ ] License key validation (server-side check)
- [ ] Free tier gating (2 prefabs + manual sync)
- [ ] Pro tier unlock (all 8 prefabs + auto-detect + priority queue)
- [ ] Usage analytics (opt-in, local-only)

### v2.3.0 — Chrome Web Store Launch 🚧 IN PROGRESS
- [x] 1280×800 screenshot descriptions (5 required)
- [x] Promo tile descriptions (small + large + marquee)
- [x] Privacy policy page (HTML + Markdown)
- [x] Store description + keyword optimization
- [x] Demo GIF script
- [x] Extension packaging script (`npm run package:extension`)
- [x] Issue & PR templates
- [x] Manifest updated to v2.0.0 with CWS `update_url`
- [ ] Actual PNG screenshots rendered from descriptions
- [ ] CWS developer account & submission
- [ ] README CWS badge + install link

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
