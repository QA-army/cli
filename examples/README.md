# QA.army CLI examples

`TESTER.md` contains shared instructions. `tests/` contains durable
plain-language scenarios, and `signup.test.json` is a complete authored Test
request. Prompt generation is not a CLI operation.

Create a durable Test from JSON:

```bash
qa-army tests create --project prj_... --input "$(cat examples/signup.test.json)" --json
```

Run it in QA.army cloud:

```bash
qa-army tests run tst_... --wait --json
```
