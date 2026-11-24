# QA.army CLI capability map

Use `qa-army capabilities --json` as the runtime authority. This reference
explains the intended mapping.

## Available

| Area | Commands |
| --- | --- |
| Identity | `auth agent-register`, `status`, `logout`, `signout` |
| First setup | `setup`, `create test` |
| Workspaces | `list`, `create`, `get`, `update` |
| Projects | `list`, `create`, `star`, `unstar` |
| Test Groups | `list`, `get`, `create`, `update`, `run` (explicit selection, 0.2.10+) |
| Tests | `list`, `get`, `create`, `update`, `archive`, `delete`, `run` |
| Runs | `list`, `create`, `get`, `start`, `watch`, `wait`, `cancel`, `evidence` (0.2.10+) |
| Account | `api-keys list`, `api-keys create`, `api-keys revoke` |

`tests run` queues one durable saved Test in QA.army cloud. `--wait` returns the
truthful terminal outcome. Local-browser, environment, and uploaded-app
variants remain unavailable.

## [request capability]

| Area | Recognized missing commands |
| --- | --- |
| Agent bootstrap | `agent init` |
| Local browser | `run`, `tests run --local` |
| Project lifecycle | `projects get`, `projects update`, `projects delete` |
| Environments | `projects environments`, `environments-create`, `environments-delete` |
| Project credentials/files | `projects credentials`, `credentials-create`, `files` |
| Test Groups | `groups delete`, `groups add-test`, `groups remove-test` |
| Test toggles | `tests enable`, `tests disable` |
| Group/mobile variants | `tests run --group`, platform/app/environment flags |
| Mobile artifacts | `upload-app` |
| Automation | `ci`, `pr run-dynamic` |

Do not emulate these operations with unrelated endpoints. Return the stable
capability receipt so product work can add the correct server-owned contract.

## Product memory (release validation pending)

Use `qa-army memories list --project prj_...` to read scoped knowledge. `create` accepts `--input` JSON; `update`, `approve`, `reject`, and `archive` require `--memory mem_... --version N`. `settings` accepts `{ "auto_learn": true }`; `graph`, `summary`, `import`, and `history` use the same Project. `clear` archives Project memory and disables automatic updates.

Use an authenticated user session or profile API key. Setup-only WorkOS agent credentials do not authorize memory management. Treat observations as historical evidence, requirements as intended behavior, and document imports as proposals requiring review. Never store credentials. Memory usage does not establish correctness or prove improvement.

## Per-PR dynamic and regression runs (live)

The QA.army GitHub App posts a `QA.army` check on pull requests. It runs
**dynamic tests** (changed-behavior plan) and **regression tests** (deployment-watch
Test Groups) against the preview URL for the PR head revision. Both suites must
complete with passing Runs, finalized evidence, and confirmed cleanup. No
applicable tests is not a pass. Proven on QA-army/landing-marketing PRs #37 and
#38. The App owns execution; there is no repository workflow that calls
`pr run-dynamic` (that name remains `[request capability]`).

### Configure

1. Install the QA.army GitHub App on the repository and connect the Project's
   GitHub + Vercel integration in the product UI.
2. Enable dynamic tests with a user session or profile API key:
   `qa-army prs settings --integration int_...`, then
   `qa-army prs configure --integration int_... --request-key configure-pr-001 --input '{"enabled":true,"max_tests":3,"test_account_ids":[],"sandbox_confirmed":true'}`.
3. Point regression at saved Groups:
   `qa-army prs watch --integration int_...` then
   `qa-army prs watch-update --integration int_... --input JSON` with
   `repository_id`, `test_group_ids`, and `enabled`.
4. Confirm sandbox safety before enabling. Planning is included; completed
   generated Tests and regression Runs consume the shared Workspace Run
   allowance. Free is $0 with 10 tests total and 100 Runs total, no card and no
   renewal. For more capacity, Upgrade or Get started.

Configuration, usage, cancel, and promote require a supported user session or
profile credential. Restricted agent setup credentials cannot manage them.
Deployment-watch updates need a claiming user who is a current Workspace OWNER.

### Read

A governed claimed WorkOS agent can read and explicitly rerun within the
claiming user's Workspace:

```bash
qa-army prs list --project prj_...
qa-army prs get --verification prv_...
qa-army prs approval-links --project prj_... --json
qa-army prs rerun --verification prv_... --request-key rerun-pr-001
qa-army runs list --test tst_... --trigger deploy
```

MCP equivalents include `prs.list`, `prs.get`, `prs.rerun`, and
`prs.approval_links`. Check installed capabilities first. Profile API keys and
setup-only credentials are denied for approval-links; a `403` stays an error
without identity fallback. Return the server's links, `qa_state`, freshness,
evidence reasons, and truncation warning. Scope is at most 10 QA-observed PRs,
not every assigned review. Observed checks are not the repository's required
branch rules. Do not infer approval or merge readiness.

### Gaps and manual path

`ci` and `pr run-dynamic` remain `[request capability]`. To run a saved Test
yourself from CI or an agent, use:

```bash
qa-army tests run --test tst_... --wait --json
```

Cancellation, explicit rerun, and regression promotion use `prs cancel`,
`prs rerun`, and `prs promote` with a stable `--request-key`. A rerun may
consume up to three new Runs; explain that before requesting one. Never retry
an ambiguous target mutation automatically. Generated Tests are immutable;
promotion creates an editable copy in the chosen group. Do not call missing
coverage, infrastructure errors, or absent evidence a pass.
