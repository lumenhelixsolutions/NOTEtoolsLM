# NOTEtoolsLM v2 — Architecture

## Overview

NOTEtoolsLM v2 is a dual-architecture product:

1. **Fleet Orchestrator** — Node.js server providing REST API, WebSocket broadcasting, and local vault management.
2. **Browser Extension** — Chrome Extension MV3 that injects tooling directly into `notebooklm.google.com`.

Both share no runtime state; they communicate via the server's REST/WebSocket surface and Chrome's extension messaging APIs.

## Data Flow

### Discovery Flow
```
notebooklm.google.com
        │
        ├──► content_script.js (scraping + toolbar)
        │         │
        │         └──► background/sw.js (sync, storage, badge)
        │                   │
        │                   └──► sidepanel.js (vault UI)
        │
        └──► Fleet Orchestrator /api/scrape (Playwright fallback)
                      │
                      └──► Local JSON store (.data/artifacts.json)
```

### Generation Flow
```
Dashboard SPA  ──POST /api/generate──►  server.js
                                           │
                                    ┌──────┴──────┐
                                    ▼             ▼
                              SDK (real)    Simulation (fallback)
                                    │             │
                                    ▼             ▼
                              NotebookLM       Local artifact
                                    │             │
                                    └──────►  WebSocket broadcast
                                                  │
                                                  ▼
                                           Dashboard + Extension
```

## Directory Layout

```
NOTEtoolsLM-v2/
├── server.js              # Express + WS backend
├── package.json           # Dependencies + scripts
├── .env.example           # Configuration template
├── public/
│   ├── index.html         # Dashboard SPA (~1,750 lines)
│   └── prefabs.json       # 8 content generation templates
├── extension/
│   ├── manifest.json      # MV3 config
│   ├── background/sw.js   # Service worker (~220 lines)
│   ├── content/content.js # Scraper + toolbar (~380 lines)
│   ├── sidepanel/         # Panel UI + onboarding
│   ├── shared/            # ES module constants + utils
│   └── icons/             # 16/32/48/128 PNGs
├── scripts/
│   └── package-extension.js  # Build ZIP for CWS
├── tests/
│   ├── server.test.js     # API smoke tests
│   └── manifest.test.js   # Extension manifest validation
└── docs/                  # This directory
```

## Key Design Decisions

### 1. Unified HTTP + WebSocket Server
Both REST and WebSocket run on the same port to simplify CORS and deployment.

### 2. JSON File Store (not SQLite)
Keeps the project dependency-light. Artifacts, projects, and queue state are stored as pretty-printed JSON in `.data/`.

### 3. Graceful SDK Degradation
The server does not fail if `notebooklm-sdk` is missing. All SDK-dependent routes return `503` with a helpful message.

### 4. Extension MV3 (not MV2)
Uses service worker background scripts. No persistent background page.

### 5. Simulation Layer
The `/api/generate` queue currently simulates processing with timed delays. This is a known gap documented in `ROADMAP.md` and will be replaced with real SDK artifact creation.

## Performance Notes

- Playwright scrape is capped at 20 notebooks to avoid timeouts.
- File watcher (chokidar) ignores dotfiles.
- Health log is capped at 100 entries.
- WebSocket broadcasts are fire-and-forget.
