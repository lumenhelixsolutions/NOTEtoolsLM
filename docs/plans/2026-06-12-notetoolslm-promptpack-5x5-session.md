# NOTEtoolsLM × promptPACK — 5 Milestone + 5 Evolution Session

**Date:** 2026-06-12  
**Repos:** [NOTEtoolsLM](https://github.com/lumenhelixsolutions/NOTEtoolsLM) · [promptPACK](https://github.com/lumenhelixsolutions/PromptPack)  
**Scope:** NotebookLM API power (sources + studio media). Portfolio bridge via promptPACK handoff objectives only.

---

## Session intent

Use **promptPACK** decision routing when agents work each milestone:

| promptPACK objective | Use in NOTEtoolsLM |
|---------------------|-------------------|
| **Token compression** | Shrink prefab templates before SDK `create*` calls |
| **Research handoff** | Source-pack manifests → bulk-add jobs with citation preservation |
| **Coding handoff** | Milestone implementation packets for Cursor/Claude sessions |
| **Local model handoff** | Offline README/docs generation without cloud tokens |
| **Audit / high-stakes** | No-op on user prompts destined for NotebookLM chat (never auto-send) |

**Trust alignment:** Both tools are local-first, user-triggered, no auto-insert. NOTEtoolsLM never ships compressed prompts to Google without explicit user action; promptPACK prepares handoff packets the user reviews first.

---

## Part A — 5 Milestones (execution packets)

Copy the **Agent packet** block into a new session when starting each milestone.

### M1 — SDK Foundation Repair · v2.9.0

**Done when:** Real audio job: `createAudio` → `waitUntilReady` → `downloadAudio` → vault.

**Agent packet (promptPACK: coding handoff):**

```txt
OBJECTIVE: coding-handoff
PROJECT: NOTEtoolsLM-v2 @ D:\projects\NOTEtoolsLM-v2
MILESTONE: M1 SDK Foundation Repair (v2.9.0)

MUST-PRESERVE:
- Graceful degradation when SDK unavailable
- Existing vault-store paths and artifact-catalog fingerprints
- npm run ci must pass

TASKS:
1. Pin notebooklm-sdk@^0.1.8; use NotebookLMClient.connect()
2. Fix lib/sdk-wrapper.js create/download/wait arity: (notebookId, opts)
3. Fix server discovery: per-notebook artifacts.list + sources.list
4. Expand getCapabilities() for all source + artifact methods
5. tests/sdk-wrapper.test.js mock shape matches DOCS.md

VERIFY:
npm run ci
npx notebooklm-sdk login (if available)
One manual audio create → wait → download → vault

OUT-OF-SCOPE: team workspaces, portfolio export, PromptPack extension code changes
```

---

### M2 — Sources Command Center · v3.0.0

**Done when:** 50 URLs bulk-added with progress; fulltext export for 5 sources.

**Agent packet (promptPACK: research handoff + coding):**

```txt
OBJECTIVE: research-handoff → coding-handoff
PROJECT: NOTEtoolsLM-v2
MILESTONE: M2 Sources Command Center (v3.0.0)
BUILD-ON: v2.8 sources export (extension DOM + lib/sources-export.js)

MUST-PRESERVE:
- Extension-only sources path (no server required)
- Local storage key plm:sourceExports
- Citation URLs in markdown export header (> url)

TASKS:
1. POST /api/sources/bulk-add — loop addUrl/addText/addFileBuffer + waitForSources
2. POST /api/sources/bulk-delete, POST /api/sources/refresh-stale
3. GET /api/sources/:notebookId/:sourceId/fulltext (SDK get when available)
4. Dashboard Sources tab: table, multi-select, progress WebSocket
5. Extension: paste newline URLs → queue bulk-add job

PROMPTPACK INTEGRATION:
- Research handoff packet for CSV manifest: columns url, title, notebook_id
- Compress fleet operator instructions only; never compress source fulltext bodies

VERIFY: 50 URLs → one notebook, progress bar, 5 fulltext .md files
```

---

### M3 — Studio Media Factory · v3.1.0

**Done when:** Batch 3 audio + 2 slide decks across 2 notebooks; vault MIME paths correct.

**Agent packet (promptPACK: token compression for prefabs):**

```txt
OBJECTIVE: token-compression + coding-handoff
PROJECT: NOTEtoolsLM-v2
MILESTONE: M3 Studio Media Factory (v3.1.0)

MUST-PRESERVE:
- Eight canonical prefab IDs in public/prefabs.json
- Job queue simulation fallback (USE_SIMULATION=true)
- WebSocket progress events

TASKS:
1. Add quiz, flashcards, infographic, data table to prefabs + queue handlers
2. create* → pollUntilReady with jobId progress
3. Typed downloads: downloadAudio/Video/SlideDeck/getReportMarkdown
4. POST /api/studio/batch-generate across N notebooks
5. suggestReports before custom report prefabs

PROMPTPACK INTEGRATION:
- Run prefab templates through promptPACK "token compression" objective before SDK create
- No-op if compression would drop {topic} or {audience} placeholders
- User reviews compressed prompt in inspector before Generate

VERIFY: batch job completes; vault has correct extensions (.mp3, .pdf, .md)
```

---

### M4 — Fleet Discovery v2 · v3.2.0

**Done when:** Source counts match NotebookLM UI for 3 test notebooks.

**Agent packet (promptPACK: audit — inventory is high-stakes):**

```txt
OBJECTIVE: audit + coding-handoff
PROJECT: NOTEtoolsLM-v2
MILESTONE: M4 Fleet Discovery v2 (v3.2.0)

MUST-PRESERVE:
- artifact-catalog.js dedupe fingerprints
- Playwright scrape fallback when SDK list incomplete

TASKS:
1. GET /api/discovery/sources — all notebooks, processing status
2. Per-notebook listAudio/listVideo/listSlideDecks/listQuizzes
3. Freshness report for stale URL sources
4. lib/source-catalog.js + CDI per source from fulltext
5. Discovery sync merges SDK + scrape with unified manifest

PROMPTPACK INTEGRATION:
- Audit objective for discovery diff reports (do not summarize away count mismatches)
- Export manifest as handoff packet for human review before bulk delete

VERIFY: 3 notebooks, source count ±0 vs UI
```

---

### M5 — Bulk Operations UX · v3.3.0

**Done when:** "50-source research pack" recipe documented and runnable.

**Agent packet (promptPACK: research handoff at scale):**

```txt
OBJECTIVE: research-handoff + coding-handoff
PROJECT: NOTEtoolsLM-v2
MILESTONE: M5 Bulk Ops UX (v3.3.0)

TASKS:
1. Source pack import: CSV/JSON → notebook → bulk sources → wait → optional audio
2. Studio sweep: 10 notebooks → executive briefing each → download all
3. Stale source janitor: fleet refresh/delete failed sources
4. Extension toolbar: "Add open tabs as sources", "Generate podcast"
5. Kanban: separate source jobs vs studio jobs

PROMPTPACK INTEGRATION:
- Research handoff for "50-source research pack" recipe doc
- Compress operator README only; preserve manifest URLs verbatim
- Optional: promptPACK side panel open on dashboard for recipe prompts

VERIFY: End-to-end recipe in docs/recipes/50-source-research-pack.md
```

---

## Part B — 5 Evolution tracks (promptPACK lens)

| # | Evolution | promptPACK role | Horizon |
|---|-----------|-----------------|---------|
| **E1** | SDK-Complete Orchestrator | Coding handoff templates for every SDK module | M1–M2 |
| **E2** | Research Automation | Research handoff for keyword→research→import pipelines | M2 |
| **E3** | Source Intelligence | Audit packets for fulltext diff; no compression on citations | M4 |
| **E4** | Studio Factory at Scale | Token compression on fleet-wide prefab prompts with user gate | M3+M5 |
| **E5** | Automation Shell | Local-model handoff for CLI `notetoolslm` help text | Post v3.3 |

### E1 — SDK-Complete Orchestrator

NOTEtoolsLM becomes the reference Node consumer for `notebooklm-sdk`. promptPACK supplies **coding handoff** packets when SDK upstream changes RPC shapes.

### E2 — Research Automation

Nightly jobs: `research.start` → poll → `importSources`. promptPACK **research handoff** preserves source URLs and citation requirements in job manifests passed to the queue.

### E3 — Source Intelligence

Fulltext search, guides, freshness dashboards. promptPACK **audit** mode for compliance exports — never compress legal or citation blocks.

### E4 — Studio Factory at Scale

Fleet templates ("Monday podcast for every notebook"). promptPACK **token compression** on prefab prompts only after user selects "Optimize prompt" in inspector.

### E5 — Automation Shell

`notetoolslm` CLI + `npm run sync:fleet`. promptPACK **local-model handoff** for offline operator docs generation.

---

## Session close checklist

- [ ] Launch site live: [lumenhelixsolutions.github.io/NOTEtoolsLM](https://lumenhelixsolutions.github.io/NOTEtoolsLM/)
- [ ] Screenshots in `docs/assets/screenshots/`
- [ ] v2.8.0 shipped: sources export + branding + README
- [ ] Next agent session starts with **M1 Agent packet** above
- [ ] promptPACK preset gate PASS before using compression on prefabs

---

## Cross-repo commands

```bash
# NOTEtoolsLM
cd D:\projects\NOTEtoolsLM-v2
npm run ci
node scripts/capture-launch-screenshots.js

# promptPACK (validate before prefab compression work in M3)
cd D:\projects\PromptPack
npm run commercial:gate
```

---

## References

- API power plan: [2026-06-12-notetoolslm-api-power-5x5.md](./2026-06-12-notetoolslm-api-power-5x5.md)
- promptPACK routing: `D:\projects\PromptPack\docs\DECISION_ROUTING.md`
- Deploy Pages: [../DEPLOY-PAGES.md](../DEPLOY-PAGES.md)