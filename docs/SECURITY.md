# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.2.x   | ✅ Yes |
| 2.0.x   | ⚠️ Legacy (upgrade recommended) |
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

## Authentication

Starting with v2.2.0, the server API is protected by JWT-based authentication:

- All API endpoints (except `/health`, `/docs`, and auth endpoints) require a valid Bearer token.
- Tokens expire after 7 days and can be refreshed via `POST /api/auth/refresh`.
- Passwords are hashed with bcrypt (cost factor 12) and stored in a local SQLite database.
- Account lockout is enforced after 5 failed login attempts (15-minute cooldown).
- Auth endpoints are protected by `express-slow-down` to mitigate brute-force attacks.
- Passwords must be at least 8 characters long and contain at least 1 uppercase letter and 1 number.

### Setting a strong JWT secret

By default, a random JWT secret is generated on each server start. For production use, set a persistent secret in your `.env` file:

```bash
JWT_SECRET=your-very-long-random-secret-here-min-32-chars
```

Generate a secure secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## Known Limitations

- Playwright scraping requires a valid NotebookLM session cookie. Ensure your machine is secure.
- WebSocket connections at `/ws` are not authenticated in this release. If exposing to a network, use a reverse proxy with additional auth layers.

## Dependencies

We monitor our dependency tree for CVEs. Run `npm audit` regularly and report any flagged packages.
