# QA.army CLI

`qa-army` (also `qa`) creates durable Tests, runs them in QA.army, and returns JSON receipts. Requires Node.js 22+; MIT licensed.

## Start

```sh
npm install -g https://github.com/QA-army/cli/releases/download/v0.2.5/qa-army-cli-0.2.5.tgz
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

## Product memory

Memory management is undergoing release validation. Use a user session or profile API key; setup-only WorkOS credentials are restricted. Review evidence before approving proposals and keep credentials in Test Accounts. Published memory assists Test creation and individual Run actions; saved assertions still verify current behavior.

## Native build registration

`builds list --project prj_...`, `builds reserve --project prj_... --input JSON --request-key KEY`, and `builds complete --build nbd_...` use the canonical Product API. Reserve metadata is `{ "filename": "Example.app.zip", "platform": "ios", "size": 123, "sha256": "<64 lowercase hex characters>" }`. Android uses `platform: "android"` and `.apk`; simulator `.app.tar.gz` and `.app.tgz` are also accepted. Maximum upload size is 512 MiB.

Use a user session or profile API key; agent setup credentials cannot register builds. PUT the exact original file to the reservation's short-lived upload URL with its supplied headers, without your Product bearer token. Complete registration to verify its checksum and size. Keep the same request key for an ambiguous reserve retry. Registered files are immutable and do not prove native execution or a passing Run.

### Dynamic PR Tests pilot

`prs` commands target the assisted, **DOGFOOD-PENDING** pilot. They require a supported profile credential and Workspace access. Restricted agent setup credentials do not gain PR-management permissions automatically.

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
