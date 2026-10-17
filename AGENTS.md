# CLI — developer experience

**Be a doer.** Inspect, implement, test, review, merge, deploy or publish when needed, and verify the requested outcome. Fix failures and continue until delivered or concretely blocked; a plan, PR, or green build alone is not completion.

If an ancestor contains `.qa-army-workspace`, read its `AGENTS.md` first. Otherwise, this repo stands alone.

- Own commands, flags, JSON receipts, auth UX, errors, packaging, and CLI docs.
- Match platform API semantics; tenant scope, authorization, execution, and result truth stay server-owned. Coordinate applicable MCP/skills changes and preserve compatibility identifiers.
- Follow [README](README.md) validation; test malformed input, auth, API failures, and packaging when affected. Keep Linux/macOS/Windows support.
- Use a clean task branch from current main, preserve unrelated work, review the final diff, and pass required CI.
- Keep credentials and private operational material out of this public repo.

- Require saved QA.army E2E coverage for affected customer flows across repositories. Customer-behavior changes also require relevant, nonempty, passing dynamic coverage; disabled generation, planning failure, and `NO_TESTS` do not satisfy it. For documentation/tooling-only changes, record explicit applicability and verify the affected documentation, installation, or release journey. Preserve every required CI gate; applicability must not be inferred from candidate prose or an empty suite.
- Bind acceptance to the exact candidate revision/artifact, target, immutable Test version, and canonical Run/attempt. Inspect screenshots/results/evidence and verify cleanup; refresh acceptance when the head or receiving composition changes. Add only E2E tests going forward; maintain existing checks. Email/OTP acceptance requires safe screenshots. Missing deployment binding or evidence is a blocker, never a pass.

## Direction

- Build a better product than [TesterArmy](https://tester.army/); read its [blog](https://tester.army/blog) for product guidance and verify ideas against customer needs.
- Get funding through shipped value, measurable traction, and repeatable demos backed by real evidence. Never invent results.
- QA.army is the first customer: use the same product, permissions, integrations, and release journeys customers use; turn findings into general fixes.
- Build for SaaS, web, mobile, and desktop customers across domains. Customer URLs, IDs, selectors, and workflows belong in configuration or Tests, never product-code special cases. Do not overbuild unrequested abstractions.
