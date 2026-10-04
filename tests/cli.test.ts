// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { parseRunWebCommand, type RunWebTransport } from "../src/web-run-client.js";
import type { ApiKeyCredentialStore } from "../src/auth-store.js";
import type { AgentAuthCommand } from "../src/agent-auth-flow.js";
import type { AgentCredentialStore } from "../src/agent-auth-store.js";
import type { AgentRegistrationProtocol } from "../src/workos-agent-registration.js";

function emptyProfileCredentialStore(): ApiKeyCredentialStore {
  return {
    location: { service: "qa.army.cli", account: "profile-api-key" },
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn(),
    delete: vi.fn().mockResolvedValue(false),
  };
}

function emptyAgentCredentialStore(overrides: Partial<AgentCredentialStore> = {}): AgentCredentialStore {
  return {
    location: { service: "qa.army.cli", account: "agent-identity" },
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn(),
    delete: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("QA.army public CLI contract", () => {
  it("provides help, version, and production defaults without reading credentials", async () => {
    const output: string[] = [];
    const io = { out: (value: string) => output.push(value), error: vi.fn() };
    const profileStore = emptyProfileCredentialStore();
    const agentStore = emptyAgentCredentialStore();

    expect(await runCli([], {}, io, undefined, undefined, undefined, profileStore, undefined, agentStore)).toBe(0);
    expect(await runCli(["--version"], {}, io, undefined, undefined, undefined, profileStore, undefined, agentStore)).toBe(0);
    expect(await runCli(["projects"], {}, io, undefined, undefined, undefined, profileStore, undefined, agentStore)).toBe(0);
    expect(await runCli(["api-keys"], {}, io, undefined, undefined, undefined, profileStore, undefined, agentStore)).toBe(0);
    expect(output[0]).toContain("QA.army CLI 0.2.3");
    expect(output[0]).toContain("https://api.qa.army/v1");
    expect(output[1]).toBe("0.2.3");
    expect(output[2]).toContain("qa-army projects");
    expect(output[3]).toContain("qa-army api-keys");
    expect(profileStore.get).not.toHaveBeenCalled();
    expect(agentStore.get).not.toHaveBeenCalled();
  });

  it("rejects unknown commands before reading credentials", async () => {
    const profileStore = emptyProfileCredentialStore();
    const agentStore = emptyAgentCredentialStore();
    const errors: string[] = [];

    expect(await runCli(
      ["projects", "teleport"],
      {},
      { out: vi.fn(), error: (value) => errors.push(value) },
      vi.fn(), undefined, undefined, profileStore, undefined, agentStore,
    )).toBe(1);
    expect(errors).toEqual(["Unknown command: projects teleport"]);
    expect(profileStore.get).not.toHaveBeenCalled();
    expect(agentStore.get).not.toHaveBeenCalled();
  });

  it("reports unsupported parity commands as stable capability requests", async () => {
    const output: string[] = [];
    const io = { out: (value: string) => output.push(value), error: vi.fn() };
    expect(await runCli(["memories", "list", "--project", `prj_${"1".repeat(32)}`, "--json"], {}, io)).toBe(2);
    expect(JSON.parse(output[0]!)).toMatchObject({
      status: "REQUEST_CAPABILITY",
      capability: "memories list",
      available: false,
      exit_code: 2,
    });
    expect(JSON.parse(output[0]!).request_url).toContain("feature_request.yml");

    expect(await runCli(["request", "capability", "desktop", "native", "runner"], {}, io)).toBe(2);
    expect(JSON.parse(output[1]!)).toMatchObject({ capability: "desktop native runner" });
    expect(io.error).not.toHaveBeenCalled();
  });

  it("publishes a complete machine-readable capability inventory", async () => {
    const output: string[] = [];
    expect(await runCli(["capabilities", "--json"], {}, { out: (value) => output.push(value), error: vi.fn() })).toBe(0);
    const inventory = JSON.parse(output[0]!);
    expect(inventory).toMatchObject({
      cli_version: "0.2.3",
      status: "AVAILABLE",
      api_base_url: "https://api.qa.army/v1",
      openapi_url: "https://api.qa.army/v1/openapi.json",
    });
    expect(inventory.supported).toContain("tests run");
    expect(inventory.request_capability).toContain("upload-app");
  });

  it("uses the production API by default and accepts an injected access token", async () => {
    const request = vi.fn<typeof fetch>(async () => response());
    expect(await runCli(
      ["runs", "get", "--run", `run_${"1".repeat(32)}`],
      { QA_ARMY_ACCESS_TOKEN: "injected-token" },
      { out: vi.fn(), error: vi.fn() },
      request,
    )).toBe(0);
    expect(request.mock.calls[0]?.[0]).toBe(`https://api.qa.army/v1/runs/run_${"1".repeat(32)}`);
  });

  it("never reads or sends native credentials for an alternate API origin", async () => {
    const exchangeAssertion = vi.fn();
    const profileStore = emptyProfileCredentialStore();
    const agentStore = emptyAgentCredentialStore({
      get: vi.fn().mockResolvedValue({
        registrationId: `agent_reg_${"R".repeat(26)}`,
        assertion: "stored.assertion.signature",
        assertionExpiresAt: "2099-01-01T00:00:00.000Z",
        refreshToken: `refresh_${"r".repeat(32)}`,
        refreshExpiresAt: "2099-02-01T00:00:00.000Z",
      }),
    });
    const errors: string[] = [];
    expect(await runCli(
      ["runs", "get", "--run", `run_${"1".repeat(32)}`],
      { QA_ARMY_API_URL: "https://alternate.example.test/v1" },
      { out: vi.fn(), error: (value) => errors.push(value) },
      vi.fn(), undefined, undefined, profileStore, undefined, agentStore,
      { exchangeAssertion } as unknown as AgentRegistrationProtocol,
    )).toBe(1);
    expect(errors).toEqual([
      "Native credentials may only be sent to https://api.qa.army; inject a credential explicitly for an alternate API",
    ]);
    expect(profileStore.get).not.toHaveBeenCalled();
    expect(agentStore.get).not.toHaveBeenCalled();
    expect(exchangeAssertion).not.toHaveBeenCalled();
  });

  it("returns Test Run variant gaps before reading credentials", async () => {
    const output: string[] = [];
    const profileStore = emptyProfileCredentialStore();
    const agentStore = emptyAgentCredentialStore();

    expect(await runCli(
      ["tests", "run", `tst_${"1".repeat(32)}`, "--local", "--json"],
      {},
      { out: (value) => output.push(value), error: vi.fn() },
      vi.fn(), undefined, undefined, profileStore, undefined, agentStore,
    )).toBe(2);
    expect(JSON.parse(output[0]!)).toMatchObject({
      status: "REQUEST_CAPABILITY",
      capability: "tests run --local",
    });
    expect(profileStore.get).not.toHaveBeenCalled();
    expect(agentStore.get).not.toHaveBeenCalled();
  });

  it("lists and waits for Runs using the production REST operations", async () => {
    const runId = `run_${"1".repeat(32)}`;
    let elapsed = 0;
    let reads = 0;
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/runs?")) return json({ runs: [runObject("PASSED")], next_before: null });
      reads += 1;
      return response(reads === 1 ? "RUNNING" : "PASSED");
    });
    const runtime = {
      now: () => elapsed,
      sleep: async (milliseconds: number) => { elapsed += milliseconds; },
    };
    const environment = { QA_ARMY_API_URL: "https://api.qa.army/v1", QA_ARMY_ACCESS_TOKEN: "token" };
    const output: string[] = [];
    const io = { out: (value: string) => output.push(value), error: vi.fn() };

    expect(await runCli(["runs", "list", "--test", `tst_${"4".repeat(32)}`, "--limit", "20"], environment, io, request, undefined, runtime)).toBe(0);
    expect(await runCli(["runs", "wait", "--run", runId, "--timeout", "5000", "--interval", "100"], environment, io, request, undefined, runtime)).toBe(0);
    expect(String(request.mock.calls[0]?.[0])).toContain(`/v1/runs?test_id=tst_${"4".repeat(32)}&limit=20`);
    expect(JSON.parse(output[1]!).status).toBe("PASSED");
  });

  it("creates, starts, and waits for a saved Test Run", async () => {
    const runId = `run_${"1".repeat(32)}`;
    let getCount = 0;
    let elapsed = 0;
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/runs") && init?.method === "POST") return response("READY", 201);
      if (url.endsWith(`/v1/runs/${runId}/start`)) return response("QUEUED", 202);
      getCount += 1;
      return response(getCount === 1 ? "RUNNING" : "PASSED");
    });
    const output: string[] = [];
    const code = await runCli(
      ["tests", "run", `tst_${"4".repeat(32)}`, "--wait", "--timeout", "5000", "--interval", "100"],
      { QA_ARMY_ACCESS_TOKEN: "token" },
      { out: (value) => output.push(value), error: vi.fn() },
      request, undefined,
      { now: () => elapsed, sleep: async (milliseconds) => { elapsed += milliseconds; } },
    );
    expect(code).toBe(0);
    expect(JSON.parse(output[0]!)).toMatchObject({ command_status: "COMPLETED", run: { status: "PASSED" } });
    expect(request).toHaveBeenCalledTimes(4);
  });
});

describe("QA.army Runs", () => {
  it.each([["create", "test"], ["tests", "create"]])("saves authored steps through %s %s without generation", async (...command) => {
    const projectId = `prj_${"3".repeat(32)}`;
    const test = { name: "Signup", enabled: true, steps: [
      { type: "act", instruction: "Click Get started", enabled: true },
      { type: "assert", instruction: "Verify signup form is visible", enabled: true },
      { type: "screenshot", instruction: "Capture signup", enabled: false },
    ] };
    const request = vi.fn<typeof fetch>(async () => json({ test: { id: `tst_${"4".repeat(32)}`, ...test } }, 201));
    const output: string[] = [];
    expect(await runCli([...command, "--project", projectId, "--input", JSON.stringify(test)],
      { QA_ARMY_ACCESS_TOKEN: "private-token" },
      { out: (value) => output.push(value), error: vi.fn() }, request)).toBe(0);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe(`https://api.qa.army/v1/projects/${projectId}/tests`);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual(test);
    expect(JSON.parse(output[0]!).test.steps).toEqual(test.steps);
    expect(output.join("")).not.toContain("private-token");
  });

  it("rejects legacy prompt generation without calling any endpoint", async () => {
    const request = vi.fn<typeof fetch>();
    expect(await runCli(["create", "test", "Generate signup", "--project", `prj_${"3".repeat(32)}`],
      { QA_ARMY_ACCESS_TOKEN: "token" }, { out: vi.fn(), error: vi.fn() }, request)).toBe(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("creates a Run using only the Test selector and never prints the token", async () => {
    const request = vi.fn<typeof fetch>(async () => response());
    const output: string[] = []; const errors: string[] = [];
    const code = await runCli(
      ["runs", "create", "--test", `tst_${"4".repeat(32)}`],
      { VENKAT_API_URL: "https://app.example.test", VENKAT_ACCESS_TOKEN: "top-secret-token" },
      { out: (value) => output.push(value), error: (value) => errors.push(value) }, request,
    );
    expect(code).toBe(0); expect(errors).toEqual([]);
    expect(output.join("\n")).not.toContain("top-secret-token");
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("https://app.example.test/v1/runs");
    expect(init?.body).toBe(JSON.stringify({ test_id: `tst_${"4".repeat(32)}` }));
  });

  it("fails closed without auth configuration", async () => {
    const errors: string[] = [];
    expect(await runCli(["runs", "get", "--run", `run_${"1".repeat(32)}`], {}, {
      out: () => undefined, error: (value) => errors.push(value),
    }, undefined, undefined, undefined, emptyProfileCredentialStore(), undefined, emptyAgentCredentialStore())).toBe(1);
    expect(errors).toEqual(["No QA.army credential is available; run qa-army auth agent-register first"]);
  });

  it("maps Phase 0 project management to REST and keeps Workspace authority in the path", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ project: { id: "project" } }), {
      status: 201, headers: { "content-type": "application/json" },
    }));
    const workspace = `wsp_${"1".repeat(32)}`;
    const output: string[] = [];
    const code = await runCli([
      "projects", "create", "--workspace", workspace, "--input",
      JSON.stringify({ name: "Store", type: "web", target: { url: "https://shop.example.test" } }),
    ], { VENKAT_API_URL: "https://app.example.test", VENKAT_ACCESS_TOKEN: "token" }, {
      out: (value) => output.push(value), error: () => undefined,
    }, request);
    expect(code).toBe(0); expect(output).toHaveLength(1);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe(`https://app.example.test/v1/workspaces/${workspace}/projects`);
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "Store", type: "web", target: { url: "https://shop.example.test" },
    });
  });

  it("starts, watches, and cancels one Run through the parity commands", async () => {
    const runId = `run_${"1".repeat(32)}`;
    const request = vi.fn<typeof fetch>(async (input) => String(input).includes("/events?")
      ? new Response(JSON.stringify({
          run: runObject("RUNNING"), events: [], next_after: 4, terminal: false,
        }), { status: 200, headers: { "content-type": "application/json" } })
      : response(String(input).endsWith("/cancel") ? "CANCELLED" : "QUEUED", 202));
    const environment = { VENKAT_API_URL: "https://app.example.test", VENKAT_ACCESS_TOKEN: "token" };
    const io = { out: () => undefined, error: () => undefined };

    expect(await runCli(["runs", "start", "--run", runId], environment, io, request)).toBe(0);
    expect(await runCli(["runs", "watch", "--run", runId, "--after", "4"], environment, io, request)).toBe(0);
    expect(await runCli(["runs", "cancel", "--run", runId], environment, io, request)).toBe(0);
    expect(request.mock.calls.map(([url]) => String(url))).toEqual([
      `https://app.example.test/v1/runs/${runId}/start`,
      `https://app.example.test/v1/runs/${runId}/events?after=4`,
      `https://app.example.test/v1/runs/${runId}/cancel`,
    ]);
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({ "idempotency-key": expect.any(String) });
    expect(request.mock.calls[2]?.[1]?.headers).toMatchObject({ "idempotency-key": expect.any(String) });
  });
});

describe("QA.army profile-key commands", () => {
  function credentialStore(overrides: Partial<ApiKeyCredentialStore> = {}): ApiKeyCredentialStore {
    return {
      location: { service: "qa.army.cli", account: "profile-api-key" },
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(false),
      ...overrides,
    };
  }

  it("stores a created key directly in the native store and prints metadata only", async () => {
    const keyId = `key_${"1".repeat(32)}`;
    const secret = `qa_live_${"1".repeat(32)}_${"A".repeat(43)}`;
    const store = credentialStore();
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      api_key: { id: keyId, name: "Local agent", prefix: `qa_live_${"1".repeat(8)}`, last_four: "AAAA" },
      secret,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const output: string[] = []; const errors: string[] = [];
    const code = await runCli(
      ["api-keys", "create", "--input", JSON.stringify({ name: "Local agent" })],
      { VENKAT_API_URL: "https://app.example.test", VENKAT_ACCESS_TOKEN: "cognito-token" },
      { out: (value) => output.push(value), error: (value) => errors.push(value) },
      request, undefined, undefined, store,
    );
    expect(code).toBe(0); expect(errors).toEqual([]);
    expect(store.set).toHaveBeenCalledWith(secret);
    expect(output.join("\n")).not.toContain(secret);
    expect(JSON.parse(output[0]!)).toEqual({
      api_key: { id: keyId, name: "Local agent", prefix: `qa_live_${"1".repeat(8)}`, last_four: "AAAA" },
      credential_store: { service: "qa.army.cli", account: "profile-api-key" },
    });
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer cognito-token" });
  });

  it("reports credential source and removes both native credential types on logout", async () => {
    const secret = `qa_live_${"5".repeat(32)}_${"E".repeat(43)}`;
    const store = credentialStore({
      get: vi.fn().mockResolvedValue(secret),
      delete: vi.fn().mockResolvedValue(true),
    });
    const output: string[] = [];
    const io = { out: (value: string) => output.push(value), error: vi.fn() };
    const agentStore = emptyAgentCredentialStore({ delete: vi.fn().mockResolvedValue(true) });

    expect(await runCli(["auth", "status"], {}, io, undefined, undefined, undefined, store, undefined, agentStore)).toBe(0);
    expect(JSON.parse(output[0]!)).toEqual({
      authenticated: true,
      source: "native_credential_store",
      credential_store: store.location,
    });
    expect(output[0]).not.toContain(secret);

    expect(await runCli(["auth", "logout"], {}, io, undefined, undefined, undefined, store, undefined, agentStore)).toBe(0);
    expect(store.delete).toHaveBeenCalledOnce();
    expect(agentStore.delete).toHaveBeenCalledOnce();
    expect(JSON.parse(output[1]!)).toEqual({
      removed: { profile_api_key: true, agent_identity: true },
      credential_stores: [store.location, agentStore.location],
    });
    expect(io.error).not.toHaveBeenCalled();
  });

  it("best-effort revokes a just-created key when native storage fails without printing it", async () => {
    const keyId = `key_${"2".repeat(32)}`;
    const secret = `qa_live_${"2".repeat(32)}_${"B".repeat(43)}`;
    const store = credentialStore({ set: vi.fn().mockRejectedValue(new Error("Native store failed")) });
    const request = vi.fn<typeof fetch>(async (_input, init) => init?.method === "DELETE"
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify({
          api_key: { id: keyId, name: "Local", prefix: `qa_live_${"2".repeat(8)}`, last_four: "BBBB" }, secret,
        }), { status: 201, headers: { "content-type": "application/json" } }));
    const output: string[] = []; const errors: string[] = [];
    const code = await runCli(
      ["api-keys", "create", "--input", JSON.stringify({ name: "Local" })],
      { VENKAT_API_URL: "https://app.example.test", VENKAT_ACCESS_TOKEN: "cognito-token" },
      { out: (value) => output.push(value), error: (value) => errors.push(value) },
      request, undefined, undefined, store,
    );
    expect(code).toBe(1); expect(output).toEqual([]);
    expect(request.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["https://app.example.test/v1/api-keys", "POST"],
      [`https://app.example.test/v1/api-keys/${keyId}`, "DELETE"],
    ]);
    expect(errors.join("\n")).not.toContain(secret);
  });

  it("uses the explicit CI override or native store without accepting a key in argv", async () => {
    const override = `qa_live_${"3".repeat(32)}_${"C".repeat(43)}`;
    const stored = `qa_live_${"4".repeat(32)}_${"D".repeat(43)}`;
    const request = vi.fn<typeof fetch>(async () => response());
    const store = credentialStore({ get: vi.fn().mockResolvedValue(stored) });
    const io = { out: () => undefined, error: () => undefined };
    await runCli(
      ["runs", "get", "--run", `run_${"1".repeat(32)}`],
      { VENKAT_API_URL: "https://app.example.test", QA_ARMY_API_KEY: override },
      io, request, undefined, undefined, store,
    );
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${override}` });
    expect(store.get).not.toHaveBeenCalled();

    await runCli(
      ["runs", "get", "--run", `run_${"1".repeat(32)}`],
      {},
      io, request, undefined, undefined, store,
    );
    expect(request.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${stored}` });
    expect(request.mock.calls[1]?.[0]).toBe(`https://api.qa.army/v1/runs/run_${"1".repeat(32)}`);

    const errors: string[] = [];
    expect(await runCli(
      ["runs", "get", "--api-key", override],
      { VENKAT_API_URL: "https://app.example.test" },
      { out: () => undefined, error: (value) => errors.push(value) },
      request, undefined, undefined, store,
    )).toBe(1);
    expect(errors).toEqual(["API keys must not be provided in process arguments; use WorkOS agent registration or secret injection"]);
    expect(errors.join("\n")).not.toContain(override);
  });

  it("does not report an invalid CI override as authenticated", async () => {
    const output: string[] = []; const errors: string[] = [];
    expect(await runCli(
      ["auth", "status"],
      { QA_ARMY_API_KEY: "invalid" },
      { out: (value) => output.push(value), error: (value) => errors.push(value) },
      undefined, undefined, undefined, credentialStore(),
    )).toBe(1);
    expect(output).toEqual([]);
    expect(errors).toEqual(["QA_ARMY_API_KEY is invalid"]);
  });

  it("returns nonzero for failed API-key list and revoke requests", async () => {
    const errors: string[] = [];
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const io = { out: () => undefined, error: (value: string) => errors.push(value) };
    const env = { VENKAT_API_URL: "https://app.example.test", VENKAT_ACCESS_TOKEN: "cognito-token" };
    expect(await runCli(["api-keys", "list"], env, io, request, undefined, undefined, credentialStore())).toBe(1);
    expect(await runCli(["api-keys", "revoke", "--key", `key_${"1".repeat(32)}`], env, io, request, undefined, undefined, credentialStore())).toBe(1);
    expect(errors).toEqual(["QA.army API request failed (503)", "QA.army API request failed (503)"]);
  });
});

describe("QA.army WorkOS agent registration command", () => {
  it("accepts login email only in argv and emits redacted ceremony metadata", async () => {
    const registrationId = `agent_reg_${"R".repeat(26)}`;
    const qaUserId = `usr_${"1".repeat(32)}`;
    const command: AgentAuthCommand = {
      registerAndClaim: vi.fn(async ({ onAwaitingUserCode }) => {
        onAwaitingUserCode({
          status: "AWAITING_USER_CODE",
          registration_id: registrationId,
          verification_uri_origin: "https://app.qa.army",
          verification_uri_path: "/auth/agent/claim",
          expires_at: "2026-09-08T17:30:00.000Z",
        });
        return {
          status: "AUTHENTICATED",
          registration_id: registrationId,
          qa_user_id: qaUserId,
          access_token_expires_in: 300,
          allowed_operation: "getSessionBootstrap",
          credential_store: { service: "qa.army.cli", account: "agent-identity" },
        } as const;
      }),
    };
    const output: string[] = [];
    const code = await runCli(
      ["auth", "agent-register", "--email", "person@example.com"],
      { VENKAT_API_URL: "https://api.qa.army" },
      { out: (value) => output.push(value), error: vi.fn() },
      fetch, undefined, undefined, undefined, command,
    );
    expect(code).toBe(0);
    expect(command.registerAndClaim).toHaveBeenCalledWith(expect.objectContaining({
      loginHint: "person@example.com",
      productApiBaseUrl: "https://api.qa.army",
    }));
    expect(output).toHaveLength(2);
    expect(JSON.parse(output[0]!)).toMatchObject({ status: "AWAITING_USER_CODE", registration_id: registrationId });
    expect(JSON.parse(output[1]!)).toMatchObject({ status: "AUTHENTICATED", qa_user_id: qaUserId });
    expect(output.join("\n")).not.toMatch(/cla_tkn_|clm_|BCDF-GHJK|header\.payload\.signature|access\.payload\.signature/);
  });

  it("rejects any attempt to put the user code on a process argument", async () => {
    const command: AgentAuthCommand = { registerAndClaim: vi.fn() };
    const errors: string[] = [];
    const code = await runCli(
      ["auth", "agent-register", "--email", "person@example.com", "--user-code", "BCDF-GHJK"],
      { VENKAT_API_URL: "https://api.qa.army" },
      { out: vi.fn(), error: (value) => errors.push(value) },
      fetch, undefined, undefined, undefined, command,
    );
    expect(code).toBe(1);
    expect(command.registerAndClaim).not.toHaveBeenCalled();
    expect(errors).toEqual(["Unknown option: --user-code"]);
    expect(errors.join("\n")).not.toContain("BCDF-GHJK");
  });

  it("uses the claimed native agent identity when no profile credential exists", async () => {
    const profileStore: ApiKeyCredentialStore = {
      location: { service: "qa.army.cli", account: "profile-api-key" },
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(), delete: vi.fn(),
    };
    const agentStore: AgentCredentialStore = {
      location: { service: "qa.army.cli", account: "agent-identity" },
      get: vi.fn().mockResolvedValue({
        registrationId: `agent_reg_${"R".repeat(26)}`,
        assertion: "stored.assertion.signature",
        assertionExpiresAt: "2099-01-01T00:00:00.000Z",
        refreshToken: `refresh_${"r".repeat(32)}`,
        refreshExpiresAt: "2099-02-01T00:00:00.000Z",
      }),
      set: vi.fn(), delete: vi.fn(),
    };
    const exchangeAssertion = vi.fn().mockResolvedValue({
      accessToken: "memory.access.signature", expiresIn: 300,
    });
    const protocol = { exchangeAssertion } as unknown as AgentRegistrationProtocol;
    const request = vi.fn<typeof fetch>(async () => response());

    expect(await runCli(
      ["runs", "get", "--run", `run_${"1".repeat(32)}`],
      { QA_ARMY_API_URL: "https://api.qa.army" },
      { out: vi.fn(), error: vi.fn() }, request, undefined, undefined,
      profileStore, undefined, agentStore, protocol,
    )).toBe(0);
    expect(exchangeAssertion).toHaveBeenCalledWith("stored.assertion.signature");
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer memory.access.signature" });
  });

  it("runs setup only with the claimed agent identity even when a profile key exists", async () => {
    const workspaceId = `wsp_${"2".repeat(32)}`;
    const projectId = `prj_${"3".repeat(32)}`;
    const testId = `tst_${"4".repeat(32)}`;
    const runId = `run_${"1".repeat(32)}`;
    const profileSecret = `qa_live_${"5".repeat(32)}_${"E".repeat(43)}`;
    const profileStore: ApiKeyCredentialStore = {
      location: { service: "qa.army.cli", account: "profile-api-key" },
      get: vi.fn().mockResolvedValue(profileSecret), set: vi.fn(), delete: vi.fn(),
    };
    const agentStore: AgentCredentialStore = {
      location: { service: "qa.army.cli", account: "agent-identity" },
      get: vi.fn().mockResolvedValue({
        registrationId: `agent_reg_${"R".repeat(26)}`, assertion: "stored.assertion.signature",
        assertionExpiresAt: "2099-01-01T00:00:00.000Z", refreshToken: `refresh_${"r".repeat(32)}`,
        refreshExpiresAt: "2099-02-01T00:00:00.000Z",
      }),
      set: vi.fn(), delete: vi.fn(),
    };
    const protocol = {
      exchangeAssertion: vi.fn().mockResolvedValue({ accessToken: "memory.access.signature", expiresIn: 300 }),
    } as unknown as AgentRegistrationProtocol;
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/session")) return json({
        user: { id: `usr_${"6".repeat(32)}`, display_name: "Owner", email: "owner@example.test" },
        destination: { kind: "workspace", workspace_id: workspaceId, workspace_slug: "first", path: "/dashboard/first/projects" },
      });
      if (url.endsWith("/v1/workspaces")) return json({ workspaces: [{ id: workspaceId }] });
      if (url.endsWith(`/v1/workspaces/${workspaceId}/projects`)) return json({ projects: [{
        id: projectId, workspace_id: workspaceId, type: "web", target_label: "https://www.qa.army/",
        project_dashboard_url: `https://app.qa.army/dashboard/first/projects/${projectId}/tests`,
      }] });
      if (url.endsWith(`/v1/projects/${projectId}/tests`)) return init?.method === "POST"
        ? json({ test: { id: testId, project_id: projectId } }, 201) : json({ tests: [] });
      if (url.endsWith("/v1/runs")) return response("READY");
      if (url.endsWith(`/v1/runs/${runId}/start`)) return response("PASSED", 202);
      throw new Error(`Unexpected URL ${url}`);
    });
    const output: string[] = [];

    expect(await runCli(
      ["setup", "--app-url", "https://www.qa.army", "--project-name", "QA.army", "--input", JSON.stringify({ name: "Signup", enabled: true, steps: [{ type: "assert", instruction: "Verify signup form", enabled: true }] }), "--workspace", workspaceId],
      { QA_ARMY_API_URL: "https://api.qa.army" },
      { out: (value) => output.push(value), error: vi.fn() }, request, undefined, undefined,
      profileStore, undefined, agentStore, protocol,
    )).toBe(0);
    expect(profileStore.get).not.toHaveBeenCalled();
    expect(request.mock.calls.every(([, init]) =>
      new Headers(init?.headers).get("authorization") === "Bearer memory.access.signature")).toBe(true);
    expect(output).toHaveLength(2);
    expect(output.join("\n")).not.toContain(profileSecret);
    expect(JSON.parse(output[0]!)).toMatchObject({
      setup_status: "RUN_STARTED",
      project_id: projectId,
      test_id: testId,
      run_id: runId,
      run_status: "PASSED",
      run_url: `https://app.qa.army/dashboard/first/projects/${projectId}/tests/${testId}/runs/${runId}`,
    });
    expect(JSON.parse(output[1]!)).toMatchObject({
      setup_status: "COMPLETED", project_reused: true, test_reused: false,
      run_status: "PASSED",
      run_url: `https://app.qa.army/dashboard/first/projects/${projectId}/tests/${testId}/runs/${runId}`,
    });
  });
});

describe("qa-army web run-scoped mode", () => {
  it("supports every narrow command without requiring or calling the customer REST adapter", async () => {
    const execute = vi.fn<RunWebTransport["execute"]>().mockResolvedValue({ ok: true });
    const request = vi.fn<typeof fetch>();
    const environment = { VENKAT_RUN_BINDING: `bnd_${"a".repeat(32)}` };
    const commands = [
      ["web", "open", "https://shop.example.test/checkout"],
      ["web", "snapshot"],
      ["web", "click", 'role=button[name="Checkout"]'],
      ["web", "fill", "testid=email", `val_${"b".repeat(16)}`],
      ["web", "tabs"],
      ["web", "tabs", "select", `tab_${"c".repeat(8)}`],
      ["web", "wait", "networkidle"],
      ["web", "scroll", "inspect", "--direction", "down"],
      ["web", "scroll", "page", "--direction", "right"],
      ["web", "scroll", "fling", "--direction", "up"],
      ["web", "scroll", "to", 'role=button[name="Checkout"]'],
      ["web", "swipe", "up", "--distance", "long"],
      ["web", "screenshot", "checkout-ready"],
      ["web", "console", "--errors"],
      ["web", "network", "--failed"],
    ] as const;
    for (const command of commands) {
      expect(await runCli(command, environment, { out: () => undefined, error: () => undefined }, request, { execute })).toBe(0);
    }
    expect(request).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(commands.length);
    expect(execute.mock.calls.every(([binding]) => binding === environment.VENKAT_RUN_BINDING)).toBe(true);
  });

  it("emits JSON null when a successful run adapter response has no result", async () => {
    const output: string[] = [];
    expect(await runCli(
      ["web", "snapshot"], { VENKAT_RUN_BINDING: `bnd_${"a".repeat(32)}` },
      { out: (value) => output.push(value), error: () => undefined }, fetch,
      { execute: vi.fn().mockResolvedValue(undefined) },
    )).toBe(0);
    expect(output).toEqual(["null"]);
  });

  it("fails closed for missing bindings, unsafe locators, and selector-like command arguments", async () => {
    const execute = vi.fn<RunWebTransport["execute"]>();
    const errors: string[] = [];
    expect(await runCli(["web", "snapshot"], {}, { out: () => undefined, error: (value) => errors.push(value) }, fetch, { execute })).toBe(1);
    expect(await runCli(["web", "click", "#arbitrary-css"], { VENKAT_RUN_BINDING: `bnd_${"a".repeat(32)}` },
      { out: () => undefined, error: (value) => errors.push(value) }, fetch, { execute })).toBe(1);
    expect(await runCli(["web", "snapshot", "--run", `run_${"1".repeat(32)}`], { VENKAT_RUN_BINDING: `bnd_${"a".repeat(32)}` },
      { out: () => undefined, error: (value) => errors.push(value) }, fetch, { execute })).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    expect(errors[0]).toContain("Run-scoped Browser binding is unavailable");
    expect(errors).toHaveLength(3);
  });

  it("reads JavaScript only from a bounded run-workspace file", async () => {
    const { mkdtemp, writeFile, rm, symlink } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const workspace = await mkdtemp(join(tmpdir(), "qa-army-web-command-"));
    const outside = await mkdtemp(join(tmpdir(), "qa-army-web-command-outside-"));
    try {
      await writeFile(join(workspace, "assert.js"), "document.title", "utf8");
      await writeFile(join(outside, "escape.js"), "document.cookie", "utf8");
      await symlink(join(outside, "escape.js"), join(workspace, "escape.js"));
      await expect(parseRunWebCommand(["evaluate", "assert.js"], workspace)).resolves.toEqual({
        kind: "evaluate", script: "document.title", scriptName: "assert.js",
      });
      await expect(parseRunWebCommand(["evaluate", "../outside.js"], workspace)).rejects.toThrow(/inside the run workspace/);
      await expect(parseRunWebCommand(["evaluate", "escape.js"], workspace)).rejects.toThrow(/inside the run workspace/);
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

function response(status = "READY", statusCode = 201) {
  return new Response(JSON.stringify({ run: runObject(status) }), {
    status: statusCode, headers: { "content-type": "application/json" },
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function runObject(status: string) {
  return {
    id: `run_${"1".repeat(32)}`, status, workspace_id: `wsp_${"2".repeat(32)}`,
    project_id: `prj_${"3".repeat(32)}`, test_group_id: null, test_id: `tst_${"4".repeat(32)}`,
    run_url: `https://app.qa.army/dashboard/first/projects/prj_${"3".repeat(32)}/tests/tst_${"4".repeat(32)}/runs/run_${"1".repeat(32)}`,
    context_schema_version: 2, context_hash: `sha256:${"a".repeat(64)}`,
    resolved_at: "2026-08-19T12:00:00.000Z",
    cancellation_requested_at: null, completed_at: null, outcome_summary: null,
  };
}
