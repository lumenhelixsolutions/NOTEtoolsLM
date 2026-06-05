# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.0.x   | ✅ Yes |
| < 2.0   | ❌ No (pre-release forks) |

## Reporting a Vulnerability

If you discover a security vulnerability, please email **security@notetoolslm.dev** with:

- A clear description of the issue
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within 48 hours and aim to patch critical issues within 7 days.

## Security Principles

1. **Local-first** — Your notebook data, artifacts, and vault never leave your machine unless you explicitly export them.
2. **No telemetry** — The app does not phone home. No analytics, no crash reporting, no usage tracking.
3. **Minimal permissions** — The Chrome Extension requests only the permissions strictly necessary:
   - `storage` — persist vault state
   - `activeTab` — interact with NotebookLM page
   - `sidePanel` — open side panel
   - `downloads` — save artifacts locally
   - `host_permissions` — only `*://notebooklm.google.com/*`
4. **Explicit user actions** — All scraping, storing, and generation is triggered by the user. Nothing happens automatically.
5. **No credential storage** — The app does not store Google passwords or API keys. SDK auth uses your existing NotebookLM session.

## Known Limitations

- The server API is currently open (no auth middleware). Do not expose it to the public internet.
- Playwright scraping requires a valid NotebookLM session cookie. Ensure your machine is secure.
- License key validation is client-side only in v2.0.0-beta. Server-side validation is planned for v2.2.0.

## Dependencies

We monitor our dependency tree for CVEs. Run `npm audit` regularly and report any flagged packages.
