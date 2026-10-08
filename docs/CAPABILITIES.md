# CLI capabilities

QA.army implements the command names that map to its current production API and
keeps recognized gaps visible as `[request capability]`.

| Surface | Available now | [request capability] |
| --- | --- | --- |
| Identity | WorkOS agent registration, status, logout | Agent skill auto-install |
| Invitations | Owner create; list/revoke/resend require the pending platform release | Recipient acceptance stays in the authenticated browser |
| Projects | Workspace-scoped list/create, star/unstar | Get/update/delete, environments, credentials, files |
| Tests | List/get/create/update/archive/delete, authored steps, remote run | Enable/disable shortcuts, local/group/environment/mobile variants |
| Runs | List/create/get/start/watch/wait/cancel | Cross-Project aggregate queries |
| Context | — | Memories |
| Mobile | Mobile Projects and immutable build list/reserve/complete | Native artifact selection and execution |
| Automation | Durable cloud Run primitives | CI orchestration and dynamic PR agents |

Run `qa-army capabilities --json` for the exact versioned inventory. A missing
command returns a stable `REQUEST_CAPABILITY` receipt and exit code `2` before
authentication or mutation.

This mapping is based on TesterArmy CLI `0.9.0` and its public `cli` repository,
observed on 2026-09-09. It records command parity only; QA.army retains its own
WorkOS identity, Workspace authorization, API, Test, Run, evidence, and billing
model.

Product memory commands use the authorized Project memory API. Setup-only agent credentials cannot manage memory.
