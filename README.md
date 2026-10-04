# QA.army CLI

`qa-army` / `qa` is the agent-first command line interface for QA.army. It
creates and runs durable plain-language Tests in the QA.army cloud and returns
typed JSON receipts suitable for coding agents and CI.

## Install

Node.js 22 or newer is required.

```bash
npm install -g https://qa.army/downloads/qa-army-cli-0.2.3.tgz
qa-army --version
```

The package is public, MIT licensed, and also exposes the short `qa` binary.
The legacy binary remains a hidden compatibility alias and is not used in
customer documentation.

## Authenticate

The preferred flow uses WorkOS Agent Registration. Only the login email is a
command argument. The claim token, user code, assertion, refresh token, access
token, and profile-key secret never enter command arguments or normal output.

```bash
qa-army auth agent-register --email you@example.com
qa-army status --json
```

The CLI defaults to `https://api.qa.army`. `QA_ARMY_API_URL` may select another
HTTPS API for an explicitly injected user or profile credential; a claimed
agent identity is restricted to the production origin. `QA_ARMY_ACCESS_TOKEN`
is supported for short-lived secret injection. Native credentials use macOS
Keychain, freedesktop Secret Service, or Windows Credential Manager.

## Set up a Project and first Test

Author `test.json` from your application requirements using
[the test-writing skill](https://qa.army/skill.md) and the full
[`SaveTestRequest` example](./examples/signup.test.json). Supply ordered typed
steps, including an enabled assertion. Setup saves those exact steps directly;
AI generation remains internal to the UI.

```bash
qa-army setup \
  --app-url https://example.com \
  --project-name Example \
  --input "$(cat test.json)"
```

Setup creates or reuses the intended Workspace, Project, and plain-language
Test, creates exactly one Run, immediately prints a `RUN_STARTED` receipt with
the server-owned live Test Run URL, then waits and prints the terminal result.
When the same application URL exists in more than one accessible Workspace,
resolve the intended Workspace with `qa-army workspaces list` and pass its ID as
`--workspace wsp_...`; setup still fails safely if no Workspace is selected.

## Durable Test and Run commands

```bash
qa-army workspaces list
qa-army projects list --workspace wsp_...
qa-army tests create --project prj_... --input "$(cat test.json)"
qa-army tests run tst_... --wait
qa-army runs list --test tst_... --limit 20
qa-army runs get --run run_...
qa-army runs wait --run run_... --timeout 900000
qa-army runs cancel --run run_...
```

All successful commands print JSON. `--json` is accepted for compatibility.
Run and Test mutations use server-derived Workspace scope and idempotency keys.

## Capability parity

`qa-army capabilities` reports the complete supported surface. Commands visible
in TesterArmy's CLI but not backed by a production QA.army API are retained as
explicit `[request capability]` entries. Invoking one returns a stable
`REQUEST_CAPABILITY` receipt and exit code `2`, with a prefilled request URL.
The CLI never pretends an unsupported operation succeeded.

Examples:

```bash
qa-army memories list --project prj_...
qa-army upload-app --app-path Example.apk --project prj_...
qa-army request capability "projects environments-create"
```

See [CAPABILITIES.md](./docs/CAPABILITIES.md) for command parity,
[REPOSITORY_PARITY.md](./docs/REPOSITORY_PARITY.md) for the public organization
surface map, and [https://qa.army/cli](https://qa.army/cli) for the production
download.

## Agent skill

The distributable skill lives at `skills/qa-army-cli/`. It teaches coding agents
to prefer durable cloud Tests, protect credentials, wait for truthful terminal
Run outcomes, and use capability requests for unavailable operations.

## Development

```bash
npm ci
npm run validate
npm run package:cli
```

The validation matrix runs on macOS, Ubuntu, and Windows. Package publication
requires all tests, type checking, the clean-install smoke, and the public
archive digest check to pass.
