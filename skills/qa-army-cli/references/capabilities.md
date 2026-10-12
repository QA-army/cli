# QA.army CLI capability map

Use `qa-army capabilities --json` as the runtime authority. This reference
explains the intended mapping.

## Available

| Area | Commands |
| --- | --- |
| Identity | `auth agent-register`, `status`, `logout`, `signout` |
| First setup | `setup`, `create test` |
| Workspaces | `workspaces list`, `workspaces create`, `workspaces get`, `workspaces update` |
| Projects | `projects list`, `projects create` |
| Membership | `members list`, `invitations create` |
| Test Groups | `groups list`, `groups get`, `groups create`, `groups update` |
| Tests | `tests list`, `tests get`, `tests create`, `tests update`, `tests archive`, `tests delete`, `tests run` |
| Runs | `runs list`, `runs create`, `runs get`, `runs start`, `runs watch`, `runs wait`, `runs cancel` |
| Native builds | `builds list`, `builds reserve`, `builds complete` |
| Product memory | `memories questions`, `memories answer`, `memories list`, `memories create`, `memories update`, `memories approve`, `memories reject`, `memories archive`, `memories clear`, `memories settings`, `memories graph`, `memories summary`, `memories import`, `memories history` |
| Dynamic PR pilot | `prs list`, `prs get`, `prs cancel`, `prs rerun`, `prs promote`, `prs settings`, `prs configure`, `prs usage` |
| Account | `api-keys list`, `api-keys create`, `api-keys revoke` |
| Discovery | `capabilities`, `docs`, `request capability` |

`tests run` queues one durable saved Test in QA.army cloud. `--wait` returns the
truthful terminal outcome. Local-browser, group, environment, and uploaded-app
variants remain unavailable.

## [request capability]

| Area | Recognized missing commands |
| --- | --- |
| Agent bootstrap | `agent init` |
| Local browser | `run`, `tests run --local` |
| Project lifecycle | `projects get`, `projects update`, `projects delete`, `projects star`, `projects unstar` |
| Environments | `projects environments`, `projects environments-create`, `projects environments-delete` |
| Project credentials/files | `projects credentials`, `projects credentials-create`, `projects files` |
| Test Groups | `groups delete`, `groups add-test`, `groups remove-test` |
| Test toggles | `tests enable`, `tests disable` |
| Group/mobile variants | `tests run --group`, platform/app/environment flags |
| Mobile artifacts | `upload-app` |
| Automation | `ci`, `pr run-dynamic` |
| Memory deletion | `memories delete` |

Do not emulate these operations with unrelated endpoints. Return the stable
capability receipt so product work can add the correct server-owned contract.

## Product memory (release validation pending)

Use `qa-army memories list --project prj_...` to read scoped knowledge. `create` accepts `--input` JSON. `update` requires `--project`, `--memory`, `--version`, and `--input`; `approve`, `reject`, and `archive` require the same selectors and version without `--input`. `settings` accepts `{ "auto_learn": true }`; `graph`, `summary`, `import`, and `history` use the same Project. `clear` archives Project memory and disables automatic updates.

Read the stable daily clarification set with `qa-army memories questions --project prj_... [--day YYYY-MM-DD]`. Answer with `qa-army memories answer --project prj_... --input JSON`; a skip requires both `choice: null` and `skipped: true`.

Use an authenticated user session or profile API key. Setup-only WorkOS agent credentials do not authorize memory management. Treat observations as historical evidence, requirements as intended behavior, and document imports as proposals requiring review. Never store credentials. Memory usage does not establish correctness or prove improvement.

## Dynamic PR Tests assisted pilot — DOGFOOD-PENDING

When the Workspace is enrolled and the installed CLI supports them, use `qa-army prs list --project prj_...`, `prs get --verification prv_...`, and `prs usage --workspace wsp_...` for reports and shared usage. MCP equivalents are `prs.list`, `prs.get`, and `prs.usage`.

`prs settings` and `prs configure` use an existing integration ID. Configuration is owner-only and requires the selected GitHub repository, selected Vercel Project, sandbox confirmation, and any required sandbox accounts. Restricted agent setup credentials cannot manage the pilot.

Cancellation, explicit rerun and regression promotion use `prs cancel`, `prs rerun` and `prs promote` with a stable `--request-key`. A rerun may consume up to three new Runs; explain that before requesting one. Never retry an ambiguous target mutation automatically. Generated Tests are immutable; promotion creates an editable copy in the chosen group. Do not call missing coverage, infrastructure errors or absent evidence a pass. Pilot thresholds are targets, not proven results.
