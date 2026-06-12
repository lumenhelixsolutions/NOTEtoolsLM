# GitHub Pages deployment

The launch site lives in this `docs/` folder and is designed for **GitHub Pages**.

## Live URL

After enabling Pages:

**https://lumenhelixsolutions.github.io/NOTEtoolsLM/**

## One-time setup (repo admin)

1. Push `docs/` to the `main` branch.
2. Open the repo on GitHub → **Settings** → **Pages**.
3. Under **Build and deployment**:
   - **Source:** Deploy from a branch
   - **Branch:** `main`
   - **Folder:** `/docs`
4. Save. GitHub builds in ~1–2 minutes.
5. Verify `index.html`, `install.html`, and `assets/` load correctly.

## What gets published

| Path | Purpose |
|------|---------|
| `index.html` | Marketing / launch landing page |
| `install.html` | Install guide |
| `style.css` | Shared styles |
| `privacy-policy.html` | Privacy policy |
| `assets/logo*.svg` | Helix Note branding |
| `assets/banner.svg` | README hero |
| `assets/og-image.png` | Social preview |

## Regenerating extension icons

After editing `docs/assets/logo-mark.svg`:

```bash
node scripts/generate-icons.js
```

This updates `extension/icons/icon{16,32,48,128}.png` and `docs/assets/og-image.png`.

## Custom domain (optional)

1. Add a `CNAME` file in `docs/` with your domain (e.g. `notetoolslm.dev`).
2. Configure DNS: `CNAME` → `<org>.github.io`.
3. Enable HTTPS in Pages settings.

## Local preview

```bash
npx serve docs
# open http://localhost:3000
```