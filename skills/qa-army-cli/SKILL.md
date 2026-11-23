---
name: qa-army-cli
description: Use the QA.army CLI to create or reuse Projects and durable plain-language Tests, run them in QA.army cloud, configure and read live per-PR dynamic and regression Runs, and report typed terminal outcomes. Trigger for app QA setup, PR verification, regression coverage, or remote Web and Mobile Test runs.
license: MIT
metadata:
  author: QA.army
  tags: qa-army, qa, cli, agent-testing, regression, pull-request
---

# QA.army CLI

Use `qa-army` (or the short `qa` binary) as the control plane for durable
QA.army Projects, Tests, cloud Runs, and live per-PR verification.

## Start

1. Run `qa-army status --json`.
2. If no credential is available, follow `https://qa.army/auth.md` and run
   `qa-army auth agent-register --email <login-email>`. Give the user only the
   claim link; read the one-time code from hidden stdin.
3. Run `qa-army capabilities --json` before assuming an operation exists.
4. Prefer `qa-army setup` for first-time Project/Test creation and
   `qa-army tests run --test tst_... --wait` for durable regression coverage.

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
- The same claimed WorkOS agent identity supports Test Group management, full
  versioned Test updates and Run cancellation. No second credential is needed.
  Test deletion and credential/admin operations remain outside that capability.
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
qa-army tests run --test tst_... --wait --json
```

Report the Project ID, Test ID, Run ID, terminal status, outcome summary, and
live Test Run URL when present.

## Per-PR dynamic and regression runs

QA.army runs dynamic tests and regression tests on every pull request when the
GitHub App and Project integration are connected. The App posts a `QA.army`
check (not a CLI GitHub Action). Both suites must pass with complete Runs,
finalized evidence, and cleanup. Free is $0 with 10 tests total and 100 Runs
total, no card and no renewal; for more capacity, Upgrade or Get started.

### Set up

1. Confirm the QA.army GitHub App is installed and the Project links the GitHub
   repository plus Vercel Project in the product UI. The CLI does not create
   that install.
2. With a user session or profile API key (not a setup-only agent credential):
   ```bash
   qa-army prs settings --integration int_...
   qa-army prs configure --integration int_... --request-key configure-pr-001 \
     --input '{"enabled":true,"max_tests":3,"test_account_ids":[],"sandbox_confirmed":true}'
   qa-army prs usage --workspace wsp_...
   ```
3. Attach saved Test Groups for regression on preview deploys (OWNER claim):
   ```bash
   qa-army prs watch --integration int_...
   qa-army prs watch-update --integration int_... --input \
     '{"repository_id":"<github-repo-id>","test_group_ids":["tgr_..."],"enabled":true}'
   ```
4. Open a PR with a Vercel preview. Wait for the `QA.army` check. Do not invent
   `qa-army pr run-dynamic` or `qa-army ci`; those are capability requests.

### Read results

```bash
qa-army prs list --project prj_...
qa-army prs get --verification prv_...
qa-army prs approval-links --project prj_... --json
qa-army runs list --test tst_... --trigger deploy
```

A claimed WorkOS agent may use `prs list`, `prs get`, and explicit
`prs rerun --verification prv_... --request-key rerun-pr-001`. Explain that a
rerun may consume up to three new Runs. Never auto-retry an ambiguous mutation.
Missing coverage, infrastructure errors, or absent evidence are not passes.

To run one saved Test yourself (agent or CI secret injection), use
`qa-army tests run --test tst_... --wait --json` — the same durable cloud path.

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

## Organize and inspect E2E evidence

Use `groups list/create/get/update` for native Test Groups. Move a Test or change
its enabled state with the current version and full `tests update` definition,
preserving steps, settings and journey metadata. Each Test belongs to one Group.

CLI 0.2.10+ provides `runs evidence --run <runId>` for finalized artifact metadata
and `evidence download --evidence <evidenceId> --output <new-file>` for
integrity-verified bytes. Signed access URLs must never enter logs or reports.
MCP provides `runs.evidence`; use CLI for artifact downloads.

`groups run` takes explicit Project/Group IDs, a stable `--request-key` and
`--input` JSON containing `selection` (1–20 `{test_id, version}` entries). Each
enabled selected Test creates a normal Run; explain that consumption. Missing
immutable version proof blocks start. Inspect partial receipts and reconcile
known Run IDs before retrying with the same selection/key; do not silently
resnapshot or retry uncertain mutations. A dispatch receipt is never a pass.
