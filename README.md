# QA.army CLI

`qa-army` (also `qa`) creates durable Tests, runs them in QA.army, and returns JSON receipts. Requires Node.js 22+; MIT licensed.

## Start

```sh
npm install -g https://qa.army/downloads/qa-army-cli-0.2.3.tgz
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
