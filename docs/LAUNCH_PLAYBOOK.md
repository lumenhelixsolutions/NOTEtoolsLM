# NOTEtoolsLM v2 — Launch Playbook

## Pre-Launch Checklist

### Repository Credibility
- [x] Professional README with badges
- [x] LICENSE (MIT)
- [x] CONTRIBUTING.md
- [x] SECURITY.md
- [x] CHANGELOG.md
- [x] ROADMAP.md
- [ ] AGENTS.md updated if architecture changes
- [ ] Issue templates (bug + feature)
- [ ] PR template

### Code Quality
- [ ] All `npm test` passing
- [ ] `npm run ci` green
- [ ] No `console.log` left in production paths
- [ ] Extension loads without warnings in `chrome://extensions/`

### Assets
- [ ] 1280×800 screenshots (at least 5)
  - [ ] Dashboard overview
  - [ ] Pipeline Kanban
  - [ ] Extension side panel
  - [ ] Inspector panel
  - [ ] Onboarding flow
- [ ] Promo tile (small) — 440×280
- [ ] Promo tile (large) — 920×680
- [ ] Marquee — 1400×560
- [ ] Social preview image for GitHub — 1280×640
- [ ] Demo GIF (optional but highly recommended)

### Chrome Web Store
- [ ] Create developer account ($5 one-time fee)
- [ ] Write store description (max 1,000 chars)
- [ ] Add keywords: notebooklm, productivity, ai, dashboard, vault
- [ ] Link privacy policy
- [ ] Select category: Productivity
- [ ] Upload packaged ZIP (`npm run package:extension`)
- [ ] Set visibility to "Public"

### Marketing Copy

**Tagline:** "The ultimate open-source orchestration suite for Google NotebookLM"

**Twitter/X Launch Post:**
```
🚀 Launching NOTEtoolsLM v2 — the missing command center for @Google NotebookLM.

✅ Fleet dashboard for all notebooks
✅ Auto-detect & vault artifacts
✅ 8 prefab generators
✅ Chrome extension
✅ 100% open source

Stop hunting. Start orchestrating.

🔗 github.com/notetoolslm/notetoolslm
```

**Hacker News / Reddit Post:**
```
Show HN: NOTEtoolsLM — an open-source fleet dashboard for Google NotebookLM

We built this because managing 10+ notebooks and their generated artifacts was painful.

- Unified dashboard with real-time pipeline
- Browser extension for one-click artifact storage
- 8 content prefabs (podcasts, briefings, decks, etc.)
- Local vault — your data stays on your machine

Would love feedback from heavy NotebookLM users.
```

### Post-Launch
- [ ] Monitor GitHub Issues for 48h
- [ ] Respond to all Twitter mentions
- [ ] Collect screenshots from early users (with permission)
- [ ] Update README with real user testimonials
- [ ] Write a "v2.1.0 preview" blog post to maintain momentum

## Rollback Plan

If critical bugs are found post-launch:
1. Pin an Issue on GitHub with workaround
2. Push hotfix to `main` within 24h
3. Update CWS listing with "Latest version fixes X"
4. Tweet update thread
