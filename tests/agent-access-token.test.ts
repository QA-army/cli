// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { WorkosAgentAccessTokenProvider } from "../src/agent-access-token.js";
import type { AgentCredential, AgentCredentialStore } from "../src/agent-auth-store.js";
import { VenkatApi } from "../src/api.js";
import type { AgentRegistrationProtocol } from "../src/workos-agent-registration.js";

const now = Date.parse("2026-09-09T13:00:00.000Z");

describe("WorkOS agent access tokens", () => {
  it("keeps access tokens memory-only and re-exchanges the stored assertion after a 401", async () => {
    const credential = agentCredential();
    const store = agentStore(credential);
    const exchangeAssertion = vi.fn()
      .mockResolvedValueOnce({ accessToken: "header.first.signature", expiresIn: 300 })
      .mockResolvedValueOnce({ accessToken: "header.second.signature", expiresIn: 300 });
    const provider = new WorkosAgentAccessTokenProvider(
      store, protocol({ exchangeAssertion }), () => now, credential,
    );
    const request = vi.fn<typeof fetch>(async (_input, init) => {
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization === "Bearer header.first.signature") {
        return new Response(JSON.stringify({ code: "unauthenticated" }), {
          status: 401, headers: { "content-type": "application/problem+json" },
        });
      }
      return new Response(JSON.stringify({ run: runObject() }), {
        status: 201, headers: { "content-type": "application/json" },
      });
    });

    await expect(new VenkatApi("https://app.example.test", provider, request).create(`tst_${"4".repeat(32)}`))
      .resolves.toMatchObject({ status: "READY" });
    expect(exchangeAssertion).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([, init]) => new Headers(init?.headers).get("authorization"))).toEqual([
      "Bearer header.first.signature", "Bearer header.second.signature",
    ]);
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
      "idempotency-key": request.mock.calls[1]?.[1]?.headers &&
        (request.mock.calls[1]?.[1]?.headers as Record<string, string>)["idempotency-key"],
    });
    expect(store.set).not.toHaveBeenCalled();
  });

  it("rotates an expired assertion through the native store before exchange", async () => {
    const expired = agentCredential({ assertionExpiresAt: "2026-09-09T12:59:59.000Z" });
    const refreshed = agentCredential({ assertion: "fresh.assertion.signature" });
    const store = agentStore(expired);
    const workos = protocol({
      refresh: vi.fn().mockResolvedValue(refreshed),
      exchangeAssertion: vi.fn().mockResolvedValue({ accessToken: "fresh.access.signature", expiresIn: 300 }),
    });
    const provider = new WorkosAgentAccessTokenProvider(store, workos, () => now, expired);

    await expect(provider.accessToken()).resolves.toBe("fresh.access.signature");
    expect(workos.refresh).toHaveBeenCalledWith(expired.refreshToken);
    expect(store.set).toHaveBeenCalledWith(refreshed);
    expect(workos.exchangeAssertion).toHaveBeenCalledWith(refreshed.assertion);
  });

  it("surfaces the machine-actionable 403 code and remediation without retrying", async () => {
    const provider = {
      accessToken: vi.fn().mockResolvedValue("header.access.signature"),
      reexchangeAfterUnauthorized: vi.fn(),
    };
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      type: "https://app.qa.army/problems/agent_capability_denied",
      title: "Use an authenticated QA.army user session for this operation.",
      status: 403,
      code: "agent_capability_denied",
    }), { status: 403, headers: { "content-type": "application/problem+json" } }));

    await expect(new VenkatApi("https://app.example.test", provider, request).operation("/v1/api-keys"))
      .rejects.toThrow(
        "QA.army API request forbidden (agent_capability_denied): Use an authenticated QA.army user session for this operation.",
      );
    expect(request).toHaveBeenCalledOnce();
    expect(provider.reexchangeAfterUnauthorized).not.toHaveBeenCalled();
  });
});

function agentCredential(overrides: Partial<AgentCredential> = {}): AgentCredential {
  return {
    registrationId: `agent_reg_${"R".repeat(26)}`,
    assertion: "stored.assertion.signature",
    assertionExpiresAt: "2026-09-09T13:10:00.000Z",
    refreshToken: `refresh_${"r".repeat(32)}`,
    refreshExpiresAt: "2026-10-09T13:00:00.000Z",
    ...overrides,
  };
}

function agentStore(credential: AgentCredential): AgentCredentialStore {
  return {
    location: { service: "qa.army.cli", account: "agent-identity" },
    get: vi.fn().mockResolvedValue(credential),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(false),
  };
}

function protocol(overrides: Partial<AgentRegistrationProtocol>): AgentRegistrationProtocol {
  return {
    register: vi.fn(), completeClaim: vi.fn(),
    exchangeAssertion: vi.fn(), refresh: vi.fn(),
    ...overrides,
  } as AgentRegistrationProtocol;
}

function runObject() {
  return {
    id: `run_${"1".repeat(32)}`, status: "READY", workspace_id: `wsp_${"2".repeat(32)}`,
    project_id: `prj_${"3".repeat(32)}`, test_group_id: null, test_id: `tst_${"4".repeat(32)}`,
    run_url: `https://app.qa.army/dashboard/first/projects/prj_${"3".repeat(32)}/tests/tst_${"4".repeat(32)}/runs/run_${"1".repeat(32)}`,
    context_schema_version: 2, context_hash: `sha256:${"a".repeat(64)}`,
    resolved_at: "2026-09-09T13:00:00.000Z", cancellation_requested_at: null,
    completed_at: null, outcome_summary: null,
  };
}
