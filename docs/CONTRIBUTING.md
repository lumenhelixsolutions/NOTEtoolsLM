# Contributing to NOTEtoolsLM v2

Thank you for considering a contribution! This project is community-driven and we welcome bug fixes, feature proposals, documentation improvements, and prefab templates.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOURNAME/notetoolslm.git`
3. Install dependencies: `npm install`
4. Copy environment config: `cp .env.example .env`
5. Start dev server: `npm run dev`

## Development Workflow

### Server Changes
- Edit `server.js`
- Test with `npm test`
- Verify dashboard at `http://localhost:3000`

### Extension Changes
- Edit files in `extension/`
- Go to `chrome://extensions/` → Load unpacked → select `extension/`
- Click the refresh icon on the extension card after each change

### Dashboard Changes
- Edit `public/index.html`
- Refresh browser tab

## Code Style

- **Server:** Standard Node.js style, 2-space indent
- **Extension:** Vanilla ES6+, minimal abstractions
- **Comments:** Use `// ─── Section ───` banners for major blocks
- **No bundlers:** Keep the extension dependency-free

## Adding a Prefab

1. Open `public/prefabs.json`
2. Add an object with: `id`, `name`, `type`, `icon`, `description`, `template`
3. Use `{topic}` and `{audience}` as template variables
4. Restart server (or it will auto-detect on next read)

## Testing

```bash
npm test        # Run all tests
npm run ci      # Lint + test gate
```

Tests use Node's built-in `node:test` runner (Node >= 18).

## Pull Request Process

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes
3. Run `npm run ci`
4. Commit with clear messages: `feat: add competitive-analysis prefab`
5. Push and open a PR against `main`
6. Link any related issues

## Areas Needing Help

- 🟡 Real SDK artifact generation (replace simulation in `processJob`)
- 🟡 Chrome Web Store listing assets (screenshots, promo tiles)
- 🟢 Additional prefab templates
- 🟢 UI/UX polish for the dashboard
- 🟢 i18n translations for the extension

## Code of Conduct

Be respectful, constructive, and inclusive. Disagreement is fine; hostility is not.
