import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";

const projectId = `prj_${"3".repeat(32)}`;
const testId = `tst_${"4".repeat(32)}`;
const runId = `run_${"1".repeat(32)}`;
const environment = { QA_ARMY_ACCESS_TOKEN: "synthetic-token" };
const fields = {
  name: "Native home", description: null, group_id: null, enabled: true,
  allow_web_search: false, deep_thinking: false, location_override: null,
  viewport: null, device_name: null,
  steps: [{ type: "assert", instruction: "Home is visible", enabled: true }],
};

function receipt(context_schema_version: number, status: string) {
  return {
    id: runId, status, workspace_id: `wsp_${"2".repeat(32)}`, project_id: projectId,
    test_group_id: null, test_id: testId,
    run_url: `https://app.qa.army/dashboard/example/projects/${projectId}/tests/${testId}/runs/${runId}`,
    context_schema_version, context_hash: `sha256:${"a".repeat(64)}`,
    resolved_at: "2026-10-06T12:00:00.000Z", cancellation_requested_at: null,
    completed_at: null, outcome_summary: null,
  };
}

describe("native launch CLI contracts", () => {
  it.each(["android-pixel9pro-15", "ios-iphone16pro-18.2"])("forwards %s selection and preserves omitted versus cleared updates", async profile_id => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ test: { id: testId } }));
    const io = { out: vi.fn(), error: vi.fn() };
    const native_target = { build_id: `nbd_${"a".repeat(32)}`, profile_id };
    expect(await runCli(["tests", "create", "--project", projectId, "--input", JSON.stringify({ ...fields, native_target })], environment, io, request)).toBe(0);
    expect(request.mock.calls[0]?.[0]).toBe(`https://api.qa.army/v1/projects/${projectId}/tests`);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ ...fields, native_target });
    for (const input of [fields, { ...fields, native_target: null }]) {
      expect(await runCli(["tests", "update", "--test", testId, "--version", "2", "--input", JSON.stringify(input)], environment, io, request)).toBe(0);
    }
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).not.toHaveProperty("native_target");
    expect(JSON.parse(String(request.mock.calls[2]?.[1]?.body)).native_target).toBeNull();
    expect(request.mock.calls[1]?.[1]).toMatchObject({ method: "PUT", headers: { "if-match": "2" } });
    expect(JSON.stringify(io.out.mock.calls)).not.toContain("synthetic-token");
  });

  it.each([3, 4, 5])("reads v%i queue and error receipts across get, list, watch and wait", async version => {
    const queued = receipt(version, "QUEUED");
    const failed = receipt(version, "ERROR");
    const request = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url.includes("/events?")) return Response.json({ run: queued, events: [{ sequence: 9, state: "QUEUED", occurred_at: queued.resolved_at }], next_after: 9, terminal: false });
      if (url.includes("/runs?")) return Response.json({ runs: [queued, failed], next_before: null });
      return Response.json({ run: failed });
    });
    const io = { out: vi.fn(), error: vi.fn() };
    for (const args of [
      ["runs", "get", "--run", runId], ["runs", "list", "--test", testId],
      ["runs", "watch", "--run", runId, "--after", "8"], ["runs", "wait", "--run", runId],
    ]) expect(await runCli(args, environment, io, request)).toBe(0);
    const outputs = io.out.mock.calls.map(([text]) => JSON.parse(text));
    expect(outputs[0]).toMatchObject(failed);
    expect(outputs[1].runs).toEqual([queued, failed]);
    expect(outputs[2]).toMatchObject({ run: queued, next_after: 9, terminal: false });
    expect(outputs[3]).toMatchObject(failed);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it.each([403, 404, 409, 503])("reports API %i as a command error without a successful receipt", async status => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ message: "Unavailable" }, { status }));
    const io = { out: vi.fn(), error: vi.fn() };
    expect(await runCli(["runs", "create", "--test", testId], environment, io, request)).toBe(1);
    expect(io.out).not.toHaveBeenCalled();
    expect(io.error).toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
