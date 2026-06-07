# NOTEtoolsLM Privacy Policy

**Effective Date:** June 5, 2026  
**Version:** 2.0.0

---

## Our Commitment

NOTEtoolsLM is built on a **local-first** architecture. Your data stays on your machine. We do not run a cloud service, we do not sync your data to our servers, and we do not sell your information.

---

## What Data Is Collected

NOTEtoolsLM collects and stores only the minimal data required to function:

| Data | Purpose | Stored Where |
|------|---------|--------------|
| Notebook IDs | Identify and manage your NotebookLM notebooks | Local SQLite |
| Artifact metadata | Titles, types, dates, and file paths of generated artifacts | Local SQLite |
| Local preferences | Extension settings (vault path, theme, onboarding state) | `chrome.storage.local` |
| Job queue state | Pending and completed prefab generation jobs | Local SQLite |

**We do not collect:**
- NotebookLM login credentials or Google account tokens
- The text/content of your notebooks
- Personal identifiers (email, IP address, device ID)
- Browser history or activity outside `notebooklm.google.com`

---

## How Data Is Stored

All data is stored **locally** on your computer:

- **SQLite database** — notebook metadata, artifact metadata, and job queue state (`.data/notetoolslm.db`)
- **Local file system** — downloaded artifacts in your configured vault directory (`vault-storage/`)
- **Browser storage** — extension settings in `chrome.storage.local` (never leaves your browser)

There is no cloud database, no remote API storing your data, and no telemetry backend.

---

## Third-Party Services

NOTEtoolsLM interacts with third parties solely at your direction:

- **Google NotebookLM** — via the official NotebookLM SDK. Data exchanged is governed by [Google's Privacy Policy](https://policies.google.com/privacy).
- **Chrome Web Store** — for extension updates. No user data is transmitted beyond the standard browser update check.

**No third-party tracking:** We do not use Google Analytics, Mixpanel, Sentry, or any other analytics or error-tracking services.

---

## Data Sharing & Selling

We **do not sell, rent, or trade** your data. We do not share data with advertisers, data brokers, or any other external entities. Because all data is local, we physically cannot access it.

---

## Your Rights & Control

You have full control over your data:

- **Export** — vault files are standard documents you can move or copy at any time.
- **Delete** — uninstalling the extension and deleting the project folder removes all local data permanently.
- **Inspect** — the SQLite database is unencrypted and can be opened with any SQLite viewer for full transparency.

---

## Security

- The Fleet Orchestrator binds to `localhost` by default and is not exposed to the internet.
- No remote access means no remote attack surface for your notebook data.
- See [SECURITY.md](./SECURITY.md) for responsible disclosure.

---

## Children's Privacy

NOTEtoolsLM is not directed at children under 13. We do not knowingly collect data from children. Deleting local files removes all associated data.

---

## Changes to This Policy

We may update this Privacy Policy to reflect new features or legal requirements. Changes will be posted to this page with an updated effective date. Inspect every code change in our [GitHub repository](https://github.com/notetoolslm/notetoolslm).

---

## Contact

For privacy questions or concerns:

- Open a private issue on [GitHub Issues](https://github.com/notetoolslm/notetoolslm/issues)
- Email the maintainers (see `SECURITY.md` for contact details)

---

*© 2026 NOTEtoolsLM Collective. MIT License. Not affiliated with Google.*
