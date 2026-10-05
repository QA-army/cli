# CLI

When this checkout is inside a local QA.army workspace, find the nearest ancestor containing `.qa-army-workspace` and read that ancestor's AGENTS.md before changes. If absent, use this repository's instructions independently; private workspace access is not required.

- Own CLI commands, flags, output, authentication UX, error handling, packaging, and public CLI documentation.
- Match supported platform API semantics. Authorization, tenant scope, execution policy, and result truth remain server-owned.
- Coordinate platform/API changes with affected MCP and skills contracts. Preserve existing package and command identifiers unless an explicit migration changes them.
- Install with `npm ci`; validate with `npm run validate`. Packaging changes also run `npm run verify:public`.
- Maintain Linux, macOS, and Windows compatibility and required CI checks. Do not add a QA.army journey gate without a scoped rollout.
- Work on a clean task branch from current origin/main; preserve unrelated work. Review the final diff, pass required checks, and verify package/public-content boundaries before release.
- Keep credentials and private operational material out of this public repository.
