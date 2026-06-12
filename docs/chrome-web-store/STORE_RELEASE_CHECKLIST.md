# Chrome Web Store Readiness Checklist — NOTEtoolsLM

## Assets

- [x] 16×16 icon
- [x] 32×32 icon
- [x] 48×48 icon
- [x] 128×128 icon
- [x] Store copy (`STORE_ASSETS.md`)
- [x] Permissions explanation (`PERMISSIONS_EXPLANATION.md`)
- [x] Privacy policy (`docs/privacy-policy.html`)
- [ ] Store screenshots (1280×800 PNGs)
- [ ] Promo tiles (440×280, 920×680)
- [ ] Demo GIF (< 5 MB)

## Build

- [x] `npm run ci`
- [x] `npm run package:extension` → `dist/extension.zip`
- [x] Manifest version matches `package.json`
- [x] `update_url` set for CWS

## Manual QA

- [ ] Load unpacked `dist/extension/` — zero warnings
- [ ] Side panel opens on notebooklm.google.com
- [ ] WebSocket connects to local server
- [ ] One prefab job completes (SDK or simulation)

## Release

- [ ] Pay $5 CWS developer fee (one-time)
- [ ] Upload `dist/extension.zip` to Developer Dashboard
- [ ] Paste listing from `STORE_ASSETS.md`
- [ ] Set visibility Public → Submit for review