# AGENTS.md — NOTEtoolsLM v2

## Project Identity

**Name:** NOTEtoolsLM v2  
**Type:** Node.js web app + Chrome Extension (Manifest V3)  
**Target:** Google NotebookLM power users  
**License:** MIT

## Core Principles

1. **Local-first** — Data stays on the user's machine. No cloud persistence unless explicitly configured.
2. **User-triggered actions** — Never auto-send, auto-publish, or auto-scrape without explicit user intent.
3. **Graceful degradation** — If the NotebookLM SDK is unavailable, the app continues to work in "offline" mode.
4. **Zero-dependency frontend** — Extension uses vanilla JS, no bundler, no framework lock-in.
5. **Clear separation** — Server = API + orchestration. Extension = UI + scraping. Dashboard = SPA.

## Architecture at a Glance

```
server.js        → Express + WebSocket server (port 3000)
public/index.html → Self-contained SPA dashboard
extension/       → Chrome Extension (MV3)
  manifest.json  → Entry point
  background/sw.js → Service worker (sync, downloads, storage)
  content/content.js → DOM scraper + floating toolbar injector
  sidepanel/     → Side panel UI + onboarding
  shared/        → Constants + utils (ES modules)
tests/           → Node test runner smoke tests
scripts/         → Build + packaging utilities
```

## When to Modify What

| Goal | File(s) |
|------|---------|
| Add REST endpoint | `server.js` |
| Change dashboard UI | `public/index.html` |
| Add prefab template | `public/prefabs.json` (or `getEmbeddedPrefabs()` in `server.js`) |
| Change extension panel | `extension/sidepanel/*` |
| Change page scraping | `extension/content/content.js` |
| Add background sync | `extension/background/sw.js` |
| Package for release | `npm run package:extension` |

## Environment Variables

Copy `.env.example` to `.env` and customize:

- `PORT` — Server port (default: 3000)
- `API_BASE` — Public URL for decoupled frontend deployments
- `DATA_DIR` — JSON persistence path
- `VAULT_DIR` — Local artifact storage path

## Launch site (`docs/`)

GitHub Pages landing at `docs/index.html`. Regenerate marketing assets:

```bash
npm run capture:launch   # screenshots + demo GIF/WebM
npm run capture:screenshots
npm run capture:demo
```

Outputs: `docs/assets/screenshots/*.png`, `docs/assets/demo.gif`, `docs/assets/demo.webm`.

## Testing

```bash
npm test         # Run Node smoke tests
npm run ci       # Lint + test gate
```

## Git Workflow

1. Branch from `main`
2. Make changes
3. Run `npm run ci`
4. Open PR with clear description
5. Squash-merge on approval

## Security Checklist (before commit)

- [ ] No hardcoded credentials
- [ ] No `console.log` of sensitive data (token, session)
- [ ] Extension `manifest.json` permissions are minimal
- [ ] `host_permissions` only covers `*://notebooklm.google.com/*`
