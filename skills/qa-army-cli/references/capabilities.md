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

## Dynamic PR Tests assisted pilot — DOGFOOD-PENDING

When the Workspace is enrolled and the installed CLI supports them, a governed claimed WorkOS agent can read reports with `qa-army prs list --project prj_...` and `prs get --verification prv_...`, and explicitly request a new attempt with `prs rerun --verification prv_... --request-key rerun-pr-001`. MCP equivalents are `prs.list`, `prs.get`, and `prs.rerun`. The server checks the claiming user's current Workspace access and retains preview qualification, current-revision checks, idempotency and Run limits. This permission does not include dynamic settings, configuration, usage, cancellation or promotion; those require a supported user session or profile credential. Deployment-watch permissions are separate.

For PR approval links with QA.army evidence, the pending client/server release adds
`qa-army prs approval-links --project prj_...` and MCP
`prs.approval_links({ project_id })`. Check installed capabilities first. Use an
authorized Cognito user session or governed claimed WorkOS agent; profile API
keys and setup-only credentials are denied. A `403` stays an error, without
identity fallback. Return the server's links, `qa_state`, freshness, evidence
reasons and truncation warning. Its `qa_observed_prs` scope covers at most 10
authorized Project PRs, not every assigned review. Selected Run attempts,
finalized evidence and cleanup matter; observed checks are not the repository's
required branch rules. Do not infer
approval or merge readiness from a link or historical pass. Missing, stale,
failed and blocked evidence remains so. The operation only reads; never approve,
merge, start Runs or substitute credentials to make this prompt succeed.

`prs settings` and `prs configure` use an existing integration ID. Configuration is owner-only and requires the selected GitHub repository, selected Vercel Project, sandbox confirmation, and any required sandbox accounts. Restricted agent setup credentials cannot manage the pilot.

Cancellation, explicit rerun and regression promotion use `prs cancel`, `prs rerun` and `prs promote` with a stable `--request-key`. A rerun may consume up to three new Runs; explain that before requesting one. Never retry an ambiguous target mutation automatically. Generated Tests are immutable; promotion creates an editable copy in the chosen group. Do not call missing coverage, infrastructure errors or absent evidence a pass. Pilot thresholds are targets, not proven results.

## Workspace invitations and private report links

`qa-army invitations create --workspace wsp_... --input JSON` forwards the
canonical `{emails, return_to?}` body. MCP `invitations.create` takes the same
fields plus `workspace_id`; optional destination support requires its matching
client/server release. `return_to` is a raw relative same-Workspace Test or Run
path; it cannot grant access or point to another origin. The server validates
resource ancestry and owner permissions.

Invitation management requires a Workspace owner with an authorized user session
or profile API key. Claimed WorkOS agents and setup credentials cannot invite or
accept for someone else. Direct recipients to the invitation email and browser
sign-in using that email, followed by explicit acceptance. CLI/MCP provide no
recipient acceptance, list, resend or revoke command; use the app for these tasks.

Report links remain Workspace-private. In the matching platform release, a
signed-in person can select **Request access** in the browser to submit a real
request for Workspace Member access. A Workspace owner can **Approve** or
**Deny**; approval directly grants Member access without an invitation step.
Submission alone grants nothing. Use **Check status** and open the shared result
only when current membership allows it. Denied requests and old approvals after
membership removal require a deliberate new request; replay cannot regrant access.
No automatic re-request or email notification is promised. Copying a link does
not submit a request. This flow remains subject to release validation.

CLI/MCP expose no request, status or approval commands. These browser operations
require the appropriate human identity and owner policy; claimed agents and
profile API keys cannot use them. Invitation creation is a separate capability.
Preserve invitation `SENT` as provider acceptance, not inbox receipt or membership.
After an uncertain invitation-create response, check pending invitations in the
app before sending again; separate invocations use new request keys. Expired
invitation links need owner recovery; resend invalidates the earlier link. Do not
bypass a denial with another credential.
