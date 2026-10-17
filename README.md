# QA.army CLI

`qa-army` (also `qa`) creates durable Tests, runs them in QA.army, and returns JSON receipts. Requires Node.js 22+; MIT licensed.

## Start

```sh
npm install -g https://github.com/QA-army/cli/releases/download/v0.2.11/qa-army-0.2.11.tgz
qa-army auth agent-register --email you@example.com
qa-army status --json
qa-army capabilities
```

Author typed steps with an enabled assertion using the [Test example](examples/signup.test.json) and [test-writing skill](https://qa.army/skill.md):

```sh
qa-army setup --app-url https://example.com --project-name Example --input "$(cat test.json)"
```

`setup` creates or reuses the selected Workspace/Project/Test, starts **one Run**, prints its live URL, and waits for the result. Use `--workspace wsp_...` when the target is ambiguous. Credentials belong in the native keyring or governed runtime injection, never Test text or command arguments.

## Develop

```sh
npm ci
npm run validate
```

Packaging changes also require `npm run verify:public`. Keep Linux, macOS, and Windows CI green. Read [AGENTS.md](AGENTS.md), the [capability map](docs/CAPABILITIES.md), and [surface map](docs/REPOSITORY_PARITY.md). Unsupported operations return `REQUEST_CAPABILITY`, never a fabricated success.

Codex: open this repo folder as the project and select Worktree from `main`. `.codex/environments/environment.toml` provides setup, cleanup, and actions; dependency installation is explicit.

## Diagnose failed Runs

```sh
qa-army runs get --run run_... --json
qa-army runs wait --run run_... --json
qa-army runs evidence --run run_... --json
```

Failed `runs get` and `runs wait` receipts include a concise `failure` object with
the first failed/error step, instruction, reason, and server-owned Run evidence
URL. Without `--json`, they print that diagnosis as one line. If finalized
evidence or the normalized event ledger is temporarily unavailable, the command
still returns the Run and falls back to its outcome summary.

`runs evidence` combines finalized artifact metadata with safe v2 Run events to
show each step's index, type, instruction, result, failure/assertion detail, and
related screenshot or other evidence IDs. Human output includes copyable
`evidence download` commands; JSON includes the same artifact references and the
Run evidence URL. The Product API does not expose permanent direct artifact
URLs. Typed values, passwords, tokens, and other sensitive step details are
redacted; signed download capabilities are never printed.

## Run evidence history

Use `qa-army runs list --test tst_... --trigger manual` for manual Run evidence and `--trigger deploy` for deployment/PR evidence. Omit `--trigger` to retain the all-Runs history. Use `--before` with the returned `next_before` and preserve `--trigger` when paging; `--limit` accepts 1–50 (default 20). The server applies the filter before pagination and retains Workspace authorization. A filtered response with a missing or different Run trigger is rejected, including during a backend rollout. Filtering reads evidence; it never changes Run outcomes or establishes a passing PR check.

## PR review links with QA.army evidence (release validation pending)

```sh
qa-army prs approval-links --project prj_... --json
```

This command and MCP `prs.approval_links({ project_id })` call the same
authenticated `GET /v1/projects/{projectId}/pr-approval-links` endpoint.
QA.army's proprietary cloud service owns authorization, GitHub observations and
evidence aggregation; the public CLI remains a thin adapter.

Use an authorized Cognito user session or a governed claimed WorkOS agent.
Profile API keys and setup-only credentials are denied. Preserve `403` as an
error; never switch identities or substitute credentials to bypass it.

The response covers at most 10 QA-observed PRs for the Project, not all PRs
assigned to the user. Show the returned review links and server `qa_state`,
freshness and evidence reasons; preserve any truncation warning. Selected Run
attempts, evidence finalization and cleanup affect evidence readiness. Observed
checks are not the repository's required branch rules. Preserve missing, stale,
failed and blocked evidence.

Review links navigate to human review; this command does not approve, merge,
start Runs or establish merge readiness. API errors remain errors. Availability
requires the matching server endpoint, an authorized credential and a released
client; this source addition alone does not establish live availability.

## Product memory

Memory management is undergoing release validation. Use a user session or profile API key; claimed WorkOS credentials do not authorize Memory management. Review evidence before approving proposals and keep credentials in Test Accounts. Published memory assists Test creation and individual Run actions; saved assertions still verify current behavior.

## Native build registration

`builds list --project prj_...`, `builds reserve --project prj_... --input JSON --request-key KEY`, and `builds complete --build nbd_...` use the canonical Product API. Reserve metadata is `{ "filename": "Example.app.zip", "platform": "ios", "size": 123, "sha256": "<64 lowercase hex characters>" }`. Android uses `platform: "android"` and `.apk`; simulator `.app.tar.gz` and `.app.tgz` are also accepted. Maximum upload size is 512 MiB.

Use a user session or profile API key; claimed WorkOS credentials cannot register builds. PUT the exact original file to the reservation's short-lived upload URL with its supplied headers, without your Product bearer token. Complete registration to verify its checksum and size. Keep the same request key for an ambiguous reserve retry. Registered files are immutable and do not prove native execution or a passing Run.

### Dynamic PR Tests pilot

`prs` commands target the assisted, **DOGFOOD-PENDING** pilot. A governed claimed WorkOS agent can use `prs list`, `prs get`, and explicit `prs rerun` within the claiming user's authorized Workspace. The server retains preview qualification, current-revision checks, idempotency and Run limits. Dynamic settings, configuration, usage, cancellation and promotion remain outside this claimed-agent permission; use a supported user session or profile credential for those operations. Deployment-watch permissions are separate.

```sh
qa-army prs list --project prj_...
qa-army prs get --verification prv_...
qa-army prs settings --integration int_...
qa-army prs usage --workspace wsp_...
qa-army prs configure --integration int_... --request-key configure-pr-001 --input '{"enabled":true,"max_tests":3,"test_account_ids":[],"sandbox_confirmed":true}'
qa-army prs cancel --verification prv_... --request-key cancel-pr-001
qa-army prs promote --verification prv_... --test tst_... --group tgr_... --request-key promote-pr-001
```

Enable only after configuring the matching Vercel Project and confirming sandbox safety. Planning is included; each completed generated Test consumes one shared Workspace Run. `prs rerun --verification prv_... --request-key rerun-pr-001` explicitly creates a new attempt and may consume up to three new Runs. Reuse a request key after an uncertain response; do not automatically rerun ambiguous mutations. No applicable coverage is not a passing result.

## ACT outcomes

Saved ACT steps accept an optional `verification` object: `expectation` (text), `timeout_ms` (1000–120000, default 30000), and `checks` (up to eight `{ "query": "Visible value to read", "equals": "Exact value" }` entries). `equals` can be text, a number, or a boolean. The server freezes inferred expectations when omitted; ambiguous outcomes error before mutation. A dispatched action alone cannot pass. Explicit Assert and Screenshot steps keep their independent roles and order; screenshot-only Tests remain valid. Run receipts support context versions 1 through 5, including historical Runs.


## Generated journey metadata

Focused generation in the QA.army app can compose one ordinary Test from versioned steps in existing Tests when journey discovery is enabled. Generation itself is not execution evidence. CLI and MCP continue to save supplied steps directly.

Preserve the optional `journey` object when editing a generated Test. It records source Test/step IDs and versions, inferred transitions, unresolved prerequisites, and observed identity bindings. References such as `{{binding.game}}` use a value captured from a fresh earlier ACT or Verify observation; the final independent Verify compares the actual identity again. Never replace these with a guessed ID or an instruction to “remember” a game/account. RunContext v5 freezes the composition for that Run. Explicit Verify and Screenshot remain ordinary steps.

A source changing during generation requires generating again. A missing or ambiguous identity produces `ERROR`; an observed identity mismatch produces `FAILED`. Graph retrieval and past receipts cannot make a new Run pass. Disabling journey generation leaves existing manual Tests and ACT verification available.

## Daily product clarifications (release validation pending)

Read the stable Project/UTC-day set with `qa-army memories questions --project prj_...` or MCP `memories.questions`. A set has three context-grounded questions with three choices each, or an exhausted empty state. Answer with `qa-army memories answer --project prj_... --input JSON` or `memories.answer`. The body contains `day`, `question_id`, expected `revision` (initially 0), zero-based `choice` (0–2), `skipped`, and optional `elaboration`. For a skip use `choice: null` and `skipped: true`.

Answers are customer-declared intent and require owner review before publication, even when an owner answers. Corrections append history; stale concurrent answers return a conflict. Never infer customer intent or submit a suggested choice automatically. Published answers may be supplied to future generation; supply does not prove influence or improved results.

To revisit a saved set, select its date in Memory, use CLI `memories questions --project prj_... --day YYYY-MM-DD`, or pass `day` to MCP `memories.questions`. The historical API is `GET /v1/projects/{projectId}/memory/clarifications/{day}`. Only existing sets are returned; prior answers remain correctable with revision checks.

## Test management and credentials

Group and Test management use the same claimed WorkOS agent identity as setup.
Run `qa-army auth agent-register` once; the server binds that identity to the
claiming user's current Workspace membership. It can create/read/update Tests,
manage Test Groups, and create/start/cancel Runs and inspect evidence. This does
not grant Test deletion, Test Account secrets, billing, member administration or
other owner-only operations. Never copy browser session credentials or put
secrets in Test instructions.

`qa-army status --json` reports the selected credential source without printing
its secret. Existing governed `QA_ARMY_API_KEY`, `QA_ARMY_ACCESS_TOKEN` /
`VENKAT_ACCESS_TOKEN` injection and native profile keys remain supported; no
second credential is needed for the claimed agent's Test management workflow.

| Operation | Command |
| --- | --- |
| List/create Groups | `groups list --project prj_...` / `groups create --project prj_... --input JSON` |
| Read/update Group | `groups get --group tgr_...` / `groups update --group tgr_... --version N --input JSON` |
| Read/update Test | `tests get --test tst_...` / `tests update --test tst_... --version N --input JSON` |
| Run saved Test | `tests run --test tst_... --wait` |
| Inspect result/events | `runs get --run run_...` / `runs watch --run run_...` |
| Inspect finalized evidence | `runs evidence --run run_...` |

Group create/update input is `{ "name": "Onboarding", "description": null }`.
To move or enable/disable a Test, get its latest version, then submit its **full
editable definition** with `group_id` or `enabled` changed. Preserve all steps,
settings and journey metadata; do not send the entire GET envelope or a partial
patch. The server rejects stale versions. Each Test has one Group, and `null`
selects the Project's Default group. There is no separate membership collection. `groups run` dispatches an explicit
selection using the canonical Run API; see the selection contract below.

Evidence output contains stable metadata only. Download an artifact with
`qa-army evidence download --evidence evd_... --output new-file.png`. The command
creates a private file without overwriting an existing file, verifies SHA-256
and size (up to 128 MiB), and returns a receipt without the signed URL. On failure
the created file is emptied. It never forwards the Product bearer to storage.
A completed Run without the required screenshots is not an accepted journey.

### Explicit Group Run selection

Read Group and Test metadata first, then freeze 1–20 unique enabled Tests as
`selection: [{"test_id":"tst_...","version":3}]`. CLI accepts this object through
`groups run --project prj_... --group tgr_... --request-key unique-batch-001 --input JSON`;
MCP takes `groups.run({project_id, group_id, request_key, selection})`. Each Test
is a separate canonical Run and may consume the normal Run allowance.

All selected Tests are checked for the same Project/Group, enabled state and
current version before any Run is created. Every created Run must expose the
matching immutable `test_version` from RunContext (schema 2–5) and context hash
before any child is started. Omitted/null versions never authorize dispatch.
Older servers without that proof are blocked. A response is `DISPATCHED` or
`INCOMPLETE`, never an aggregate Test pass. Use returned Run IDs to watch results
and inspect evidence. A replayed child already beyond READY is reported without
starting it again. The operation is not atomic: an interruption can leave READY
or started children, identified in the partial receipt. Reconcile those IDs
before retrying; keep the same selection and request key. Preparation failures
attempt to cancel known READY children before any start; inspect cancellation
receipts and explicitly cancel any remaining unused READY Runs. Never replace the selection with a fresh list on retry.

## Deployment watch Test Groups

Use `qa-army prs watch --integration int_...` or MCP
`prs.watch({integration_id})` to read an existing connected GitHub deployment
watch. Update its full selection with `qa-army prs watch-update --integration
int_... --input JSON` or `prs.watch_update({integration_id, ...body})`:

```json
{"repository_id":"123456789","test_group_ids":["tgr_00000000000000000000000000000001"],"enabled":true}
```

Use the repository ID and actual Group IDs returned by the API. Read first and
include every Group you intend to keep; this replaces the selection, with no
hidden merge. At most 50 unique same-Project Groups are allowed; an enabled
watch needs at least one. The same claimed WorkOS identity can manage the watch
when its claiming user is a current Workspace OWNER. It cannot create a watch,
change its repository, reconnect GitHub, or grant provider consent. Profile API
keys and provisional setup credentials do not authorize these watch operations.

The receipt contains `deployment_watch`, including its new `version`. PUT has
no `If-Match` or idempotency-key contract: after an uncertain response, read back
and reconcile rather than retrying blindly. Changes affect subsequent matching
deployments; they do not start a manual Run or establish a passing PR check.
Keep unrelated selected Groups and integration settings intact. Inspect the
canonical exact-head Runs and screenshots after the next qualified deployment.
