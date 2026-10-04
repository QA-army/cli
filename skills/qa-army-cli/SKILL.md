---
name: qa-army-cli
description: Use the QA.army CLI to create or reuse Projects and durable plain-language Tests, run them in QA.army cloud, and report typed terminal outcomes. Trigger for app QA setup, regression coverage, or remote Web and Mobile Test runs.
license: MIT
metadata:
  author: QA.army
  tags: qa-army, qa, cli, agent-testing, regression
---

# QA.army CLI

Use `qa-army` (or the short `qa` binary) as the control plane for durable
QA.army Projects, Tests, and cloud Runs.

## Start

1. Run `qa-army status --json`.
2. If no credential is available, follow `https://qa.army/auth.md` and run
   `qa-army auth agent-register --email <login-email>`. Give the user only the
   claim link; read the one-time code from hidden stdin.
3. Run `qa-army capabilities --json` before assuming an operation exists.
4. Prefer `qa-army setup` for first-time Project/Test creation and
   `qa-army tests run <testId> --wait` for durable regression coverage.

If setup reports that multiple Projects match the application URL, list the
accessible Workspaces, resolve the Workspace the user named or the repository
clearly identifies, and retry with `--workspace <workspaceId>`. Ask the user
when the intended Workspace remains ambiguous. Never choose a different
Workspace merely because it contains the same application URL.

The CLI defaults to `https://api.qa.army`; do not synthesize Test Run URLs.
Return the server-owned URL from the immediate `RUN_STARTED` receipt. Continue
waiting and report the terminal receipt when it arrives.

## Credential boundary

- Never put an API key, WorkOS user code, claim token, assertion, refresh token,
  or access token in a command argument, file, log, or response.
- Use the native credential store. An injected `QA_ARMY_ACCESS_TOKEN` or
  `QA_ARMY_API_KEY` is acceptable only through the caller's secret mechanism.
- A claimed agent identity may be sent only to `https://api.qa.army`.
- On `401`, let the CLI re-exchange once. On `403`, follow the returned
  machine-actionable remediation; do not broaden scope or substitute a user
  credential silently.

## Durable coverage

Write Tests as 3–10 plain-language steps with one intent per step. Separate
actions from assertions and describe visible user outcomes, not selectors or
implementation details. Use `screenshot` only for a meaningful checkpoint.

Write `test.json` with the complete `SaveTestRequest` from
https://qa.army/skill.md. Include all Test settings, ordered step types,
instructions, and enabled flags. Setup requires `--input "$(cat test.json)"`;
never call internal generation endpoints.

Typical flow:

```bash
qa-army workspaces list --json
qa-army projects list --workspace <workspaceId> --json
qa-army tests create --project <projectId> --input "$(cat test.json)" --json
qa-army tests run <testId> --wait --json
```

Report the Project ID, Test ID, Run ID, terminal status, outcome summary, and
live Test Run URL when present.

## Missing operations

Recognized competitor-parity commands that lack a production QA.army API return
`REQUEST_CAPABILITY` and exit code `2`. This is not a test failure and not a
successful operation. Provide the receipt's `request_url` to the user or run:

```bash
qa-army request capability "<command or feature>"
```

Read [references/capabilities.md](references/capabilities.md) when selecting a
command or mapping an unavailable operation. Read
[references/reporting-template.md](references/reporting-template.md) when
preparing the final QA result.
