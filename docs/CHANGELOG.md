# Changelog

All notable changes to NOTEtoolsLM v2 will be documented in this file.

## [2.0.0-beta] — 2026-06-05

### Added
- Fleet Orchestrator — Express + WebSocket server with unified port
- Dashboard SPA — Kanban pipeline, vault browser, inspector, settings
- Chrome Extension MV3 — side panel, content script, background service worker
- 8 content prefabs (Deep-Dive Podcast, Executive Briefing, Explainer Video, Investor Deck, Mind Map, Critique & Debate, Tutorial, Competitive Analysis)
- Local vault storage with typed subdirectories
- Playwright UI scraping fallback for artifact discovery
- NotebookLM SDK integration with graceful degradation
- Bulk select / download / store / delete operations
- Synthetic CDI (Citation Density Index) metric in inspector
- Onboarding wizard for first-time extension users
- Real-time WebSocket broadcasts to dashboard and extension
- File watcher (chokidar) for vault directory changes
- `.env` configuration support
- API_BASE config for decoupled frontend deployments
- Health log endpoint (`/api/status`)

### Merged
- Combined best of `plinepro_kimi` and `plpv2` into unified codebase
- Ported `/api/artifacts/:id/download` endpoint from `plpv2`
- Ported `API_BASE` dashboard config from `plpv2`
- Retained richer extension UI from `plinepro_kimi`

### Notes
- Core generation pipeline is currently simulated (timed delays). Real SDK integration targeted for v2.1.0.
