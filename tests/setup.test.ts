// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import type { VenkatApi } from "../src/api.js";
import { setupProject } from "../src/setup.js";

const ids = {
  workspace: `wsp_${"1".repeat(32)}`,
  project: `prj_${"2".repeat(32)}`,
  test: `tst_${"3".repeat(32)}`,
  run: `run_${"4".repeat(32)}`,
};
const authoredTest = {
  name: "Signup", description: null, group_id: null, enabled: true,
  allow_web_search: false, deep_thinking: false, location_override: null,
  viewport: null, device_name: null,
  steps: [{ type: "act", instruction: "Click Get started", enabled: true },
    { type: "assert", instruction: "Verify the signup form is visible", enabled: true }],
};
const dashboardUrl = `https://app.qa.army/dashboard/team/projects/${ids.project}/tests`;
const runUrl = (runId = ids.run) => `${dashboardUrl}/${ids.test}/runs/${runId}`;

describe("deterministic agent setup", () => {
  it("creates one missing Project and Test, starts one Run, and returns the server URL", async () => {
    const operation = vi.fn(async (path: string, method = "GET", _body?: unknown, _version?: number, _key?: string) => {
      if (path === "/v1/session") return session();
      if (path === "/v1/workspaces") return { workspaces: [{ id: ids.workspace }] };
      if (path.endsWith("/projects") && method === "GET") return { projects: [] };
      if (path.endsWith("/projects") && method === "POST") return { project: project() };
      if (path.endsWith("/tests") && method === "POST") return { test: { id: ids.test, project_id: ids.project } };
      if (path.endsWith("/tests")) return { tests: [] };
      throw new Error(`Unexpected ${method} ${path}`);
    });
    const api = fakeApi(operation, false);
    const started: unknown[] = [];
    const receipt = await setupProject(api, {
      appUrl: "https://www.qa.army",
      projectName: "QA.army",
      test: authoredTest,
    }, runtime(), (value) => started.push(value));

    expect(started).toEqual([{
      setup_status: "RUN_STARTED",
      workspace_id: ids.workspace,
      project_id: ids.project,
      test_id: ids.test,
      run_id: ids.run,
      run_status: "RUNNING",
      run_url: runUrl(),
    }]);

    expect(receipt).toEqual({
      setup_status: "COMPLETED", workspace_id: ids.workspace,
      project_id: ids.project, project_reused: false,
      test_id: ids.test, test_reused: false,
      run_id: ids.run, run_status: "PASSED", outcome_summary: "All enabled saved-Test steps passed.",
      run_url: runUrl(),
    });
    const projectCreate = operation.mock.calls.find(([, method]) => method === "POST");
    expect(projectCreate?.[2]).toEqual({
      name: "QA.army", description: null, type: "web", target: { url: "https://www.qa.army/" },
    });
    expect(projectCreate?.[4]).toMatch(/^agent-setup\.v1\.project\.[a-f0-9]{64}$/);
    expect(operation).toHaveBeenCalledWith(
      `/v1/projects/${ids.project}/tests`, "POST", authoredTest, undefined,
      expect.stringMatching(/^agent-setup\.v1\.authored-test\.[a-f0-9]{64}$/),
    );
    expect(api.create).toHaveBeenCalledOnce();
    expect(api.start).toHaveBeenCalledOnce();
    expect(api.watch).toHaveBeenCalledOnce();
  });

  it("reuses the exact Project and authored Test while creating a distinct requested Run", async () => {
    const operation = vi.fn(async (path: string, _method?: string, _body?: unknown, _version?: number, _key?: string) => {
      if (path === "/v1/session") return session();
      if (path === "/v1/workspaces") return { workspaces: [{ id: ids.workspace }] };
      if (path.endsWith("/projects")) return { projects: [project()] };
      if (path.endsWith("/tests") && _method === "POST") return { test: { id: ids.test, project_id: ids.project } };
      if (path.endsWith("/tests")) return { tests: [{ id: ids.test }] };
      throw new Error(`Unexpected GET ${path}`);
    });
    const api = fakeApi(operation, true, `run_${"5".repeat(32)}`);
    const receipt = await setupProject(api, {
      appUrl: "https://www.qa.army/",
      projectName: "QA.army",
      test: authoredTest,
    }, runtime());

    expect(receipt).toMatchObject({
      project_id: ids.project, project_reused: true,
      test_id: ids.test, test_reused: true,
      run_id: `run_${"5".repeat(32)}`, run_status: "PASSED",
      run_url: runUrl(`run_${"5".repeat(32)}`),
    });
    expect(operation.mock.calls.filter(([, method]) => method === "POST")).toHaveLength(1);
    expect(api.create).toHaveBeenCalledOnce();
  });

  it("reuses the authored payload key across object key order but distinguishes changed steps", async () => {
    const operation = vi.fn(async (path: string, method?: string) => {
      if (path === "/v1/session") return session();
      if (path === "/v1/workspaces") return { workspaces: [{ id: ids.workspace }] };
      if (path.endsWith("/projects")) return { projects: [project()] };
      if (path.endsWith("/tests")) return method === "POST"
        ? { test: { id: ids.test, project_id: ids.project } } : { tests: [] };
      throw new Error("Unexpected request");
    });
    const api = fakeApi(operation, false);
    const input = { appUrl: "https://www.qa.army", projectName: "QA.army" };
    await setupProject(api, { ...input, test: authoredTest }, runtime());
    await setupProject(api, { ...input, test: Object.fromEntries(Object.entries(authoredTest).reverse()) }, runtime());
    await setupProject(api, { ...input, test: { ...authoredTest, steps: [...authoredTest.steps].reverse() } }, runtime());
    const calls = (operation.mock.calls as unknown as readonly unknown[][]).filter((call) => call[1] === "POST");
    expect(calls[0]?.[4]).toBe(calls[1]?.[4]);
    expect(calls[2]?.[4]).not.toBe(calls[0]?.[4]);
  });

  it("does not start a Run after an ambiguous save failure", async () => {
    const operation = vi.fn(async (path: string, method?: string) => {
      if (path === "/v1/session") return session();
      if (path === "/v1/workspaces") return { workspaces: [{ id: ids.workspace }] };
      if (path.endsWith("/projects")) return { projects: [project()] };
      if (path.endsWith("/tests") && method !== "POST") return { tests: [] };
      throw new Error("Save response unavailable");
    });
    const api = fakeApi(operation, false);
    await expect(setupProject(api, { appUrl: "https://www.qa.army", projectName: "QA.army", test: authoredTest }, runtime()))
      .rejects.toThrow("Save response unavailable");
    expect(operation.mock.calls.filter(([, method]) => method === "POST")).toHaveLength(1);
    expect(api.create).not.toHaveBeenCalled();
  });

  it("rejects missing authored assertions before any network or Run mutation", async () => {
    const operation = vi.fn();
    const api = fakeApi(operation, false);
    await expect(setupProject(api, {
      appUrl: "https://example.com", projectName: "Example",
      test: { ...authoredTest, steps: [{ type: "act", instruction: "Click", enabled: true }] },
    })).rejects.toThrow("enabled assertion");
    expect(operation).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("fails before mutation when the application URL matches multiple Projects", async () => {
    const secondWorkspace = `wsp_${"6".repeat(32)}`;
    const operation = vi.fn(async (path: string, _method?: string, _body?: unknown, _version?: number, _key?: string) => {
      if (path === "/v1/session") return session();
      if (path === "/v1/workspaces") return { workspaces: [{ id: ids.workspace }, { id: secondWorkspace }] };
      if (path.includes(ids.workspace)) return { projects: [project()] };
      if (path.includes(secondWorkspace)) return { projects: [{
        ...project(), id: `prj_${"7".repeat(32)}`, workspace_id: secondWorkspace,
        project_dashboard_url: `https://app.qa.army/dashboard/other/projects/prj_${"7".repeat(32)}/tests`,
      }] };
      throw new Error(`Unexpected GET ${path}`);
    });
    const api = fakeApi(operation, true);

    await expect(setupProject(api, {
      appUrl: "https://www.qa.army", projectName: "QA.army", test: authoredTest,
    }, runtime())).rejects.toThrow("Multiple QA.army Projects match this application URL");
    expect(operation.mock.calls.some(([, method]) => method === "POST")).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
  });

  it("reuses the exact Project in an explicitly selected Workspace when another Workspace has the same URL", async () => {
    const secondWorkspace = `wsp_${"6".repeat(32)}`;
    const otherProjectId = `prj_${"7".repeat(32)}`;
    const operation = vi.fn(async (path: string, _method?: string, _body?: unknown, _version?: number, _key?: string) => {
      if (path === "/v1/session") return session();
      if (path === "/v1/workspaces") return { workspaces: [{ id: ids.workspace }, { id: secondWorkspace }] };
      if (path.includes(ids.workspace)) return { projects: [project()] };
      if (path.includes(secondWorkspace)) return { projects: [{
        ...project(), id: otherProjectId, workspace_id: secondWorkspace,
        project_dashboard_url: `https://app.qa.army/dashboard/other/projects/${otherProjectId}/tests`,
      }] };
      if (path.endsWith("/tests") && _method === "POST") return { test: { id: ids.test, project_id: ids.project } };
      if (path.endsWith("/tests")) return { tests: [{ id: ids.test }] };
      throw new Error(`Unexpected GET ${path}`);
    });
    const api = fakeApi(operation, true);

    const receipt = await setupProject(api, {
      appUrl: "https://www.qa.army", projectName: "QA.army", test: authoredTest,
      workspaceId: ids.workspace,
    }, runtime());

    expect(receipt).toMatchObject({ workspace_id: ids.workspace, project_id: ids.project, project_reused: true });
    expect(operation).not.toHaveBeenCalledWith(
      `/v1/workspaces/${secondWorkspace}/projects`, expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    );
    expect(api.create).toHaveBeenCalledOnce();
  });

  it("rejects an explicitly selected Workspace outside the agent's memberships before Project lookup", async () => {
    const unavailable = `wsp_${"6".repeat(32)}`;
    const operation = vi.fn(async (path: string, _method?: string) => {
      if (path === "/v1/session") return session();
      if (path === "/v1/workspaces") return { workspaces: [{ id: ids.workspace }] };
      throw new Error(`Unexpected GET ${path}`);
    });
    const api = fakeApi(operation, true);

    await expect(setupProject(api, {
      appUrl: "https://www.qa.army", projectName: "QA.army", test: authoredTest,
      workspaceId: unavailable,
    }, runtime())).rejects.toThrow("Selected QA.army Workspace is unavailable");
    expect(operation.mock.calls.some(([, method]) => method === "POST")).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
  });
});

function fakeApi(operation: ReturnType<typeof vi.fn>, reused: boolean, runId = ids.run): VenkatApi {
  const ready = run("READY", runId);
  const running = run("RUNNING", runId);
  const passed = { ...run("PASSED", runId), completed_at: "2026-09-09T13:01:00.000Z", outcome_summary: "All enabled saved-Test steps passed." };
  return {
    operation,
    create: vi.fn().mockResolvedValue(ready),
    start: vi.fn().mockResolvedValue(running),
    watch: vi.fn().mockResolvedValue({ run: passed, events: [], next_after: 4, terminal: true }),
  } as unknown as VenkatApi;
}

function session() {
  return {
    user: { id: `usr_${"9".repeat(32)}`, display_name: "Agent Owner", email: "owner@example.test" },
    destination: { kind: "workspace", workspace_id: ids.workspace, workspace_slug: "team", path: "/dashboard/team/projects" },
  };
}

function project() {
  return {
    id: ids.project, workspace_id: ids.workspace, name: "QA.army", description: null,
    type: "web", target_label: "https://www.qa.army/", project_dashboard_url: dashboardUrl,
    test_count: 1, created_at: "2026-09-09T13:00:00.000Z", updated_at: "2026-09-09T13:00:00.000Z",
  };
}

function run(status: "READY" | "RUNNING" | "PASSED", id = ids.run) {
  return {
    id, status, workspace_id: ids.workspace, project_id: ids.project, test_group_id: null, test_id: ids.test,
    run_url: runUrl(id),
    context_schema_version: 2 as const, context_hash: `sha256:${"a".repeat(64)}`,
    resolved_at: "2026-09-09T13:00:00.000Z", cancellation_requested_at: null,
    completed_at: null, outcome_summary: null,
  };
}

function runtime() {
  let elapsed = 0;
  return { now: () => elapsed, sleep: async (milliseconds: number) => { elapsed += milliseconds; }, runTimeoutMs: 5_000 };
}
