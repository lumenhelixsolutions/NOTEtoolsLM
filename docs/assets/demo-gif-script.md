# NOTEtoolsLM v2 — 30-Second Demo GIF Script

## Overview
A fast-paced, looping GIF showcasing the core value proposition of NOTEtoolsLM in approximately 30 seconds. Designed for README, Chrome Web Store listing, and social media.

## Technical Specs
- **Resolution:** 1280×800 (or 1280×720 for 16:9)
- **Frame Rate:** 15 FPS
- **Duration:** ~30 seconds (looping)
- **Format:** GIF (optimized for < 5 MB), MP4 fallback
- **Tooling:** Screen recording (OBS/ShareX) → editing (After Effects / ScreenToGif / FFmpeg)

---

## Scene Breakdown

### Scene 1: Hook — "Stop hunting. Start orchestrating." (0s – 5s)
- **Visual:** Dark screen. NOTEtoolsLM logo fades in with tagline.
- **Text Overlay:** "Stop hunting. Start orchestrating."
- **Audio (if MP4):** Subtle whoosh / tech chime
- **Transition:** Quick zoom into Fleet Dashboard

### Scene 2: Fleet Dashboard — Notebook Overview (5s – 12s)
- **Visual:** Fleet Dashboard at localhost:3000. Grid of notebook cards visible.
- **Action:** Cursor clicks "Sync All" button. Status indicators change from yellow "Syncing" to green "Synced". Artifact counts update with a rolling number animation.
- **Text Overlay:** "Sync your entire NotebookLM fleet in one click"
- **Duration:** 7 seconds
- **Transition:** Slide right to Pipeline view

### Scene 3: Pipeline Kanban — Drag & Drop (12s – 18s)
- **Visual:** Pipeline board with cards in different columns.
- **Action:** Cursor drags a card from "Queued" to "Running". A progress bar fills. Card automatically moves to "Completed" column. Green checkmark appears.
- **Text Overlay:** "Kanban pipeline for content generation"
- **Duration:** 6 seconds
- **Transition:** Cut to Chrome browser

### Scene 4: Extension Side Panel — One-Click Store (18s – 25s)
- **Visual:** notebooklm.google.com open in Chrome. NOTEtoolsLM side panel is open on the right showing the Vault tab.
- **Action:** Cursor clicks the floating "Store All" toolbar button on the NotebookLM page. Artifacts appear instantly in the side panel vault list with checkmarks.
- **Text Overlay:** "Store artifacts without leaving NotebookLM"
- **Duration:** 7 seconds
- **Transition:** Zoom out / mosaic split

### Scene 5: Prefab Launcher — Generate Content (25s – 29s)
- **Visual:** Prefab launcher modal open with 8 template cards.
- **Action:** Cursor hovers over "Deep-Dive Podcast" card (highlight/glow), clicks it, then clicks "Generate". Modal closes. A toast notification appears: "Job queued: Deep-Dive Podcast".
- **Text Overlay:** "8 prefabs. One click."
- **Duration:** 4 seconds

### Scene 6: Outro — CTA (29s – 30s)
- **Visual:** Black screen. NOTEtoolsLM logo + "Get NOTEtoolsLM" + Chrome Web Store badge + GitHub link.
- **Text Overlay:** "Free. Open source. Local-first."
- **Duration:** 1 second (quick punch)

---

## Production Notes

### Recording Setup
1. Use a clean Chrome profile with no distracting extensions visible.
2. Set screen resolution to 1280×800 or record at higher resolution and crop.
3. Hide OS taskbar / dock during recording.
4. Use a consistent, smooth cursor (no trail, standard pointer or subtle custom).
5. Ensure NotebookLM pages use demo/fictional notebooks with no sensitive data.

### Post-Production
- Remove mouse idle time between actions (tighten pacing).
- Add subtle zooms on click targets.
- Use cross-dissolve or quick slide transitions between scenes.
- Optimize GIF color palette to 128-256 colors to keep file size under 5 MB.
- Consider creating an MP4/WebM version for README (better quality, smaller size).

### Demo Data
Use these fictional notebooks to avoid leaking real user data:
- "Q3 Product Strategy"
- "Deep Dive: LLM Architectures"
- "Podcast Series: Future of Work"
- "Competitive Analysis: Note-Taking Apps"
- "Investor Briefing 2026"

---

## Export Checklist
- [ ] GIF under 5 MB (Chrome Web Store limit)
- [ ] MP4/WebM under 10 MB (GitHub README optimal)
- [ ] No real user data visible
- [ ] Text readable at 1280×800
- [ ] Loop is seamless (Scene 6 → Scene 1 transition feels natural)
