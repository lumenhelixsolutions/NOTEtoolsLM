# Permissions Explanation — NOTEtoolsLM (CWS review)

| Permission | Why it is needed |
|------------|------------------|
| `storage` | Save extension settings, vault path, and onboarding state locally |
| `downloads` | Save exported artifacts and vault files to disk when user requests |
| `activeTab` | Read context from the active NotebookLM tab when user triggers an action |
| `sidePanel` | Show the NOTEtoolsLM orchestration UI alongside NotebookLM |
| `alarms` | Periodic sync and connection health checks to the local server |
| `contextMenus` | Right-click actions to send selection to vault or prefabs |
| `scripting` | Inject content helpers only on notebooklm.google.com |
| `host_permissions: *://notebooklm.google.com/*` | Operate exclusively on Google NotebookLM — no other sites |

The extension communicates with a **user-run local server** (default `http://localhost:3000`). It does not send notebook content to third-party analytics services.