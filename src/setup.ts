// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { VenkatApi, type RunReceipt } from "./api.js";

export interface SetupInput {
  readonly appUrl: string;
  readonly projectName: string;
  readonly test: Readonly<Record<string, unknown>>;
  readonly workspaceId?: string;
}

export interface SetupRuntime {
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly runTimeoutMs: number;
}

export interface SetupReceipt {
  readonly setup_status: "COMPLETED" | "TIMED_OUT";
  readonly workspace_id: string;
  readonly project_id: string;
  readonly project_reused: boolean;
  readonly test_id: string;
  readonly test_reused: boolean;
  readonly run_id: string;
  readonly run_status: RunReceipt["status"];
  readonly outcome_summary: string | null;
  readonly run_url: string;
}

export interface SetupRunStartedReceipt {
  readonly setup_status: "RUN_STARTED";
  readonly workspace_id: string;
  readonly project_id: string;
  readonly test_id: string;
  readonly run_id: string;
  readonly run_status: RunReceipt["status"];
  readonly run_url: string;
}

const defaultRuntime: SetupRuntime = {
  now: () => performance.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  runTimeoutMs: 15 * 60_000,
};

export async function setupProject(
  api: VenkatApi,
  input: SetupInput,
  runtime: SetupRuntime = defaultRuntime,
  onRunStarted?: (receipt: SetupRunStartedReceipt) => void,
): Promise<SetupReceipt> {
  const appUrl = canonicalAppUrl(input.appUrl);
  const projectName = boundedText(input.projectName, "Project name", 100);
  const test = input.test;
  if (!test || typeof test !== "object" || Array.isArray(test) ||
      typeof test.name !== "string" || !test.name.trim() || test.enabled !== true ||
      !Array.isArray(test.steps) || !test.steps.some((step) =>
        step && step.enabled === true && step.type === "assert")) {
    throw new Error("Setup requires an enabled authored Test with an enabled assertion; follow https://qa.army/skill.md");
  }
  const session = parseSession(await api.operation("/v1/session"));
  const listedWorkspaces = parseWorkspaces(await api.operation("/v1/workspaces"));
  let workspaceId: string;
  let workspaceReused = true;

  if (input.workspaceId) {
    workspaceId = identifier(input.workspaceId, "wsp");
    if (!listedWorkspaces.some((workspace) => workspace.id === workspaceId)) {
      throw new Error("Selected QA.army Workspace is unavailable to this agent identity");
    }
  } else if (session.workspaceId) {
    if (!listedWorkspaces.some((workspace) => workspace.id === session.workspaceId)) {
      throw new Error("QA.army returned an inconsistent Workspace destination");
    }
    workspaceId = session.workspaceId;
  } else {
    if (listedWorkspaces.length > 0) throw new Error("QA.army returned an ambiguous Workspace destination");
    const slug = workspaceSlug(projectName);
    const created = parseCreatedWorkspace(await api.operation(
      "/v1/workspaces", "POST", {
        display_name: session.displayName ?? session.email.split("@", 1)[0],
        name: projectName,
        slug,
        avatar_url: null,
      }, undefined, stableKey("workspace", session.email, slug),
    ));
    workspaceId = created.id;
    workspaceReused = false;
  }

  const projectWorkspaces = input.workspaceId
    ? listedWorkspaces.filter((workspace) => workspace.id === workspaceId)
    : listedWorkspaces;
  const projects = (await Promise.all(projectWorkspaces.length > 0
    ? projectWorkspaces.map(async (workspace) => parseProjects(await api.operation(
        `/v1/workspaces/${encodeURIComponent(workspace.id)}/projects`,
      )))
    : [Promise.resolve([] as readonly ProjectReceipt[])])).flat();
  const matches = projects.filter((project) => project.type === "web" && canonicalAppUrl(project.targetLabel) === appUrl);
  if (matches.length > 1) throw new Error("Multiple QA.army Projects match this application URL; select one before continuing");

  let project = matches[0];
  const projectReused = Boolean(project);
  if (!project) {
    project = parseCreatedProject(await api.operation(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`, "POST",
      { name: projectName, description: null, type: "web", target: { url: appUrl } },
      undefined, stableKey("project", workspaceId, appUrl),
    ));
  }
  if (project.workspaceId !== workspaceId && (!projectReused || input.workspaceId)) {
    throw new Error("QA.army returned an inconsistent Project Workspace");
  }

  const existingTestIds = new Set(parseTests(await api.operation(
    `/v1/projects/${encodeURIComponent(project.id)}/tests`,
  )));
  const saved = record(record(await api.operation(
    `/v1/projects/${encodeURIComponent(project.id)}/tests`, "POST", test,
    undefined, stableKey("authored-test", project.id, canonicalJson(test)),
  )).test);
  const testId = identifier(saved.id, "tst");
  if (saved.project_id !== project.id) invalid("Test Project");
  const run = await api.create(testId);
  let current = await api.start(run.id);
  onRunStarted?.({
    setup_status: "RUN_STARTED",
    workspace_id: project.workspaceId,
    project_id: project.id,
    test_id: testId,
    run_id: current.id,
    run_status: current.status,
    run_url: current.run_url,
  });
  const deadline = runtime.now() + runtime.runTimeoutMs;
  let after = 0;
  while (!terminal(current.status) && runtime.now() < deadline) {
    const batch = await api.watch(run.id, after);
    current = batch.run;
    after = batch.next_after;
    if (!batch.terminal && !terminal(current.status)) await runtime.sleep(1_000);
  }
  return {
    setup_status: terminal(current.status) ? "COMPLETED" : "TIMED_OUT",
    workspace_id: project.workspaceId,
    project_id: project.id,
    project_reused: projectReused,
    test_id: testId,
    test_reused: existingTestIds.has(testId),
    run_id: current.id,
    run_status: current.status,
    outcome_summary: current.outcome_summary,
    run_url: current.run_url,
  };
}

interface ProjectReceipt {
  readonly id: string;
  readonly workspaceId: string;
  readonly type: "web" | "mobile";
  readonly targetLabel: string;
  readonly dashboardUrl: string;
}

function parseSession(value: unknown) {
  const payload = record(value); const user = record(payload.user); const destination = record(payload.destination);
  const email = text(user.email);
  const displayName = user.display_name === null ? null : text(user.display_name);
  if (destination.kind === "create_workspace") return { email, displayName, workspaceId: null };
  if (destination.kind !== "workspace") invalid("session");
  return { email, displayName, workspaceId: identifier(destination.workspace_id, "wsp") };
}

function parseWorkspaces(value: unknown): readonly { readonly id: string }[] {
  const workspaces = record(value).workspaces;
  if (!Array.isArray(workspaces)) invalid("Workspace list");
  return workspaces.map((value) => ({ id: identifier(record(value).id, "wsp") }));
}

function parseCreatedWorkspace(value: unknown): { readonly id: string } {
  return { id: identifier(record(record(value).workspace).id, "wsp") };
}

function parseProjects(value: unknown): readonly ProjectReceipt[] {
  const projects = record(value).projects;
  if (!Array.isArray(projects)) invalid("Project list");
  return projects.map(parseProject);
}

function parseCreatedProject(value: unknown): ProjectReceipt {
  return parseProject(record(value).project);
}

function parseProject(value: unknown): ProjectReceipt {
  const project = record(value);
  const type = project.type;
  if (type !== "web" && type !== "mobile") invalid("Project");
  const dashboardUrl = text(project.project_dashboard_url);
  let parsedDashboard: URL;
  try { parsedDashboard = new URL(dashboardUrl); } catch { invalid("Project"); }
  const id = identifier(project.id, "prj");
  if (
    parsedDashboard.origin !== "https://app.qa.army" || parsedDashboard.search || parsedDashboard.hash ||
    !parsedDashboard.pathname.endsWith(`/projects/${id}/tests`)
  ) invalid("Project");
  return {
    id, workspaceId: identifier(project.workspace_id, "wsp"), type,
    targetLabel: text(project.target_label), dashboardUrl,
  };
}

function parseTests(value: unknown): readonly string[] {
  const tests = record(value).tests;
  if (!Array.isArray(tests)) invalid("Test list");
  return tests.map((value) => identifier(record(value).id, "tst"));
}

function canonicalAppUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Application URL must be an absolute HTTP or HTTPS URL"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("Application URL must be an absolute HTTP or HTTPS URL");
  }
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function workspaceSlug(value: string): string {
  const slug = value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/g, "");
  return slug.length >= 3 ? slug : `qa-${stableDigest(value).slice(0, 8)}`;
}

function stableKey(kind: string, ...parts: readonly string[]): string {
  return `agent-setup.v1.${kind}.${stableDigest(parts.join("\u0000"))}`;
}

function stableDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedText(value: string, label: string, maximum: number): string {
  const result = value.trim();
  if (!result || result.length > maximum) throw new Error(`${label} must be between 1 and ${maximum} characters`);
  return result;
}

function terminal(status: RunReceipt["status"]): boolean {
  return ["PASSED", "FAILED", "ERROR", "CANCELLED"].includes(status);
}

function identifier(value: unknown, prefix: "wsp" | "prj" | "tst"): string {
  const result = text(value);
  if (!new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(result)) invalid(prefix);
  return result;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("response");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string") invalid("response");
  return value;
}

function invalid(label: string): never {
  throw new Error(`QA.army returned an invalid ${label} receipt`);
}

// Object key ordering must not create duplicate Tests for the same authored payload.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(
      ([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
