# QA.army CLI examples

`TESTER.md` contains shared instructions. `tests/` contains durable
plain-language scenarios and `prompts/` contains an ad hoc Test-generation
brief.

Create a durable Test from a prompt:

```bash
qa-army create test "$(cat examples/prompts/ad-hoc-regression.md)" --project prj_... --json
```

Run it in QA.army cloud:

```bash
qa-army tests run tst_... --wait --json
```
