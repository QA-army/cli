// SPDX-License-Identifier: MIT
export interface RunReceipt {
  readonly id: string;
  readonly status: RunStatus;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly test_group_id: string | null;
  readonly test_id: string;
  readonly run_url: string;
  readonly context_schema_version: 1 | 2 | 3 | 4 | 5;
  readonly journey?: Readonly<Record<string, unknown>>;
  readonly context_hash: string;
  readonly resolved_at: string;
  readonly cancellation_requested_at: string | null;
  readonly completed_at: string | null;
  readonly outcome_summary: string | null;
}

export type RunStatus = "READY" | "QUEUED" | "PROVISIONING" | "RUNNING" | "PASSED" | "FAILED" | "ERROR" | "CANCELLED";
export interface RunWatchBatch {
  readonly run: RunReceipt;
  readonly events: readonly { readonly sequence: number; readonly state: string; readonly occurred_at: string }[];
  readonly next_after: number;
  readonly terminal: boolean;
}

export interface RunListReceipt {
  readonly runs: readonly RunReceipt[];
  readonly next_before: string | null;
}

export interface CommandRuntime {
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export interface ApiAccessTokenProvider {
  accessToken(): Promise<string>;
  reexchangeAfterUnauthorized(): Promise<string>;
}

const defaultCommandRuntime: CommandRuntime = {
  now: () => performance.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export class VenkatApi {
  constructor(
    private readonly baseUrl: string,
    private readonly credential: string | ApiAccessTokenProvider,
    private readonly request: typeof fetch = fetch,
    private readonly commandRuntime: CommandRuntime = defaultCommandRuntime,
  ) {}

  async create(testId: string): Promise<RunReceipt> {
    return this.call("/v1/runs", "POST", { test_id: testId }, randomUUID()) as Promise<RunReceipt>;
  }

  async list(testId: string, before?: string, limit = 20): Promise<RunListReceipt> {
    const search = new URLSearchParams({ test_id: testId, limit: String(limit) });
    if (before) search.set("before", before);
    return this.call(`/v1/runs?${search.toString()}`, "GET") as Promise<RunListReceipt>;
  }

  async get(runId: string): Promise<RunReceipt> {
    return this.call(`/v1/runs/${encodeURIComponent(runId)}`, "GET") as Promise<RunReceipt>;
  }

  async start(runId: string): Promise<RunReceipt> {
    return this.call(`/v1/runs/${encodeURIComponent(runId)}/start`, "POST", undefined, randomUUID()) as Promise<RunReceipt>;
  }

  async watch(runId: string, after = 0): Promise<RunWatchBatch> {
    return this.call(`/v1/runs/${encodeURIComponent(runId)}/events?after=${after}`, "GET") as Promise<RunWatchBatch>;
  }

  async cancel(runId: string): Promise<RunReceipt> {
    return this.call(`/v1/runs/${encodeURIComponent(runId)}/cancel`, "POST", undefined, randomUUID()) as Promise<RunReceipt>;
  }

  async wait(runId: string, timeoutMs = 15 * 60_000, initialIntervalMs = 1_000): Promise<RunReceipt> {
    const startedAt = this.commandRuntime.now();
    let intervalMs = initialIntervalMs;
    while (true) {
      const run = await this.get(runId);
      if (terminalRun(run.status)) return run;
      const elapsed = this.commandRuntime.now() - startedAt;
      if (elapsed >= timeoutMs) throw new Error(`QA.army Run wait timed out after ${timeoutMs}ms`);
      await this.commandRuntime.sleep(Math.min(intervalMs, timeoutMs - elapsed));
      intervalMs = Math.min(intervalMs * 2, 30_000);
    }
  }

  async operation(
    path: string,
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" = "GET",
    body?: unknown,
    version?: number,
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.call(path, method, body, idempotencyKey ?? (method === "POST" ? randomUUID() : undefined), version);
  }

  private async call(
    path: string,
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    body?: unknown,
    key?: string,
    version?: number,
    signal?: AbortSignal,
  ) {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    const init = {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(key ? { "idempotency-key": key } : {}),
        ...(version ? { "if-match": String(version) } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    } satisfies RequestInit;
    let response = await this.authorizedRequest(url, init, await this.accessToken());
    if (response.status === 401 && typeof this.credential !== "string") {
      await response.body?.cancel().catch(() => undefined);
      response = await this.authorizedRequest(url, init, await this.credential.reexchangeAfterUnauthorized());
    }
    if (!response.ok) throw await apiFailure(response);
    if (response.status === 204) return undefined;
    const payload = await response.json() as unknown;
    return path.startsWith("/v1/runs?")
      ? parseRunList(payload)
      : path.includes("/events?")
      ? parseWatch(payload)
      : path === "/v1/runs" || path.startsWith("/v1/runs/")
      ? parseRun(record(payload).run)
      : payload;
  }

  private accessToken(): Promise<string> {
    return typeof this.credential === "string"
      ? Promise.resolve(this.credential)
      : this.credential.accessToken();
  }

  private authorizedRequest(url: string, init: RequestInit, accessToken: string): Promise<Response> {
    return this.request(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${accessToken}` },
    });
  }
}

async function apiFailure(response: Response): Promise<Error> {
  if (response.status !== 403) {
    await response.body?.cancel().catch(() => undefined);
    return new Error(`QA.army API request failed (${response.status})`);
  }
  try {
    const body = record(await response.json());
    const code = string(body.code);
    const remediation = string(body.title);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(code) || remediation.length < 1 || remediation.length > 500) throw new Error();
    return new Error(`QA.army API request forbidden (${code}): ${remediation}`);
  } catch {
    return new Error("QA.army API request failed (403)");
  }
}

function parseRun(value: unknown): RunReceipt {
  const run = record(value);
  if (!isStatus(run.status) || (run.context_schema_version !== 1 && run.context_schema_version !== 2 && run.context_schema_version !== 3 && run.context_schema_version !== 4 && run.context_schema_version !== 5)) throw new Error("QA.army returned an invalid Run receipt");
  const hash = string(run.context_hash);
  if (!/^sha256:[a-f0-9]{64}$/.test(hash)) throw new Error("QA.army returned an invalid Run receipt");
  return {
    id: string(run.id), status: run.status, workspace_id: string(run.workspace_id),
    project_id: string(run.project_id), test_group_id: run.test_group_id === null ? null : string(run.test_group_id),
    test_id: string(run.test_id), run_url: runUrl(run.run_url, run),
    context_schema_version: run.context_schema_version, context_hash: hash,
    ...(run.journey ? {journey:record(run.journey)} : {}),
    resolved_at: string(run.resolved_at),
    cancellation_requested_at: nullableString(run.cancellation_requested_at),
    completed_at: nullableString(run.completed_at), outcome_summary: nullableString(run.outcome_summary),
  };
}
function runUrl(value: unknown, run: Readonly<Record<string, unknown>>): string {
  const result = string(value);
  let parsed: URL;
  try { parsed = new URL(result); } catch { return invalid(); }
  const expectedSuffix = `/projects/${string(run.project_id)}/tests/${string(run.test_id)}/runs/${string(run.id)}`;
  if (parsed.origin !== "https://app.qa.army" || parsed.search || parsed.hash
    || !/^\/dashboard\/[^/]+\/projects\//.test(parsed.pathname) || !parsed.pathname.endsWith(expectedSuffix)) invalid();
  return result;
}
function parseWatch(value: unknown): RunWatchBatch {
  const payload = record(value); const events = Array.isArray(payload.events) ? payload.events : invalid();
  if (typeof payload.terminal !== "boolean" || !Number.isInteger(payload.next_after)) invalid();
  return {
    run: parseRun(payload.run),
    events: events.map((value) => { const event = record(value); return {
      sequence: number(event.sequence), state: string(event.state), occurred_at: string(event.occurred_at),
    }; }),
    next_after: number(payload.next_after), terminal: payload.terminal,
  };
}
function parseRunList(value: unknown): RunListReceipt {
  const payload = record(value);
  if (!Array.isArray(payload.runs)) invalid();
  const nextBefore = payload.next_before;
  if (nextBefore !== null && typeof nextBefore !== "string") invalid();
  return { runs: payload.runs.map(parseRun), next_before: nextBefore as string | null };
}
function terminalRun(status: RunStatus) { return ["PASSED", "FAILED", "ERROR", "CANCELLED"].includes(status); }
function isStatus(value: unknown): value is RunStatus { return typeof value === "string" && ["READY", "QUEUED", "PROVISIONING", "RUNNING", "PASSED", "FAILED", "ERROR", "CANCELLED"].includes(value); }
function nullableString(value: unknown): string | null { return value === null || value === undefined ? null : string(value); }
function timestamp(value: unknown): string { const text = string(value); if (Number.isNaN(Date.parse(text))) invalid(); return text; }
function number(value: unknown): number { if (typeof value !== "number" || !Number.isInteger(value)) invalid(); return value; }
function invalid(): never { throw new Error("QA.army returned an invalid Run receipt"); }
function randomUUID() { return globalThis.crypto.randomUUID(); }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("QA.army returned an invalid Run receipt"); return value as Record<string, unknown>; }
function string(value: unknown): string { if (typeof value !== "string") throw new Error("QA.army returned an invalid Run receipt"); return value; }
