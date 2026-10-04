# QA.army result template

```text
QA.army:
- Project: <name> (<projectId>)
- Test: <name> (<testId>)
- Run: <runId>
- Result: PASSED | FAILED | ERROR | CANCELLED
- Outcome: <server outcome summary>
- Test Run: <server-owned run_url>
```

For `REQUEST_CAPABILITY`, report the requested command and its `request_url`.
Do not describe it as executed coverage.
