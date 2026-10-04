# Public repository parity

QA.army keeps the public CLI release boundary at `QA-army/cli`. The
table below records the public TesterArmy organization surfaces observed on
2026-09-09 and the corresponding QA.army owner. It does not claim that a
repository name alone makes a capability available.

| TesterArmy repository | QA.army equivalent | Status |
| --- | --- | --- |
| [`.github`](https://github.com/tester-army/.github) | Repository-root `.github/` community files and issue forms | Available |
| [`cli`](https://github.com/tester-army/cli) | Repository-root `cli/`, public package, examples, docs, and agent skill | Available |
| [`mobile-example`](https://github.com/tester-army/mobile-example) | Mobile sample application and example Test bundle | `[request capability]` |
| [`mobile-github-action`](https://github.com/tester-army/mobile-github-action) | Mobile artifact build/upload GitHub Action | `[request capability]` |
| [`scout`](https://github.com/tester-army/scout) | API exploration and generated API Test surface | `[request capability]` |
| [`unbox-ai`](https://github.com/tester-army/unbox-ai) | AI trace and Run-debug visualization surface | `[request capability]` |

Use the stable CLI receipt for an unavailable surface, for example:

```bash
qa-army request capability "mobile example repository"
qa-army request capability "mobile GitHub Action"
qa-army request capability "API scout"
qa-army request capability "AI trace visualization"
```

Each command exits with status `2`, returns `REQUEST_CAPABILITY`, and includes a
prefilled QA.army feature-request URL. The implementation lives in the public `QA-army/cli` repository. Releases preserve
package provenance and the canonical
`https://qa.army/cli` install path.
