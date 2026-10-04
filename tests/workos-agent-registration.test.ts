// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { AgentRegistrationError, WorkosAgentRegistrationClient } from "../src/workos-agent-registration.js";

const registrationId = `agent_reg_${"R".repeat(26)}`;
const claimToken = `clm_${"C".repeat(24)}_-D5F7`;
const attemptToken = `cat_${"A".repeat(24)}_-B6G8`;
const userCode = "BCDF-GHJK";
const assertion = "header.payload.signature";
const refreshToken = `rt_${"T".repeat(30)}`;
const accessToken = "access.payload.signature";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function registration() {
  return {
    id: registrationId,
    type: "service_auth",
    claim: {
      token: claimToken,
      expires_at: "2026-09-08T18:00:00.000Z",
      attempt: {
        verification_uri: `https://app.qa.army/auth/agent/claim?token=${attemptToken}`,
        expires_at: "2026-09-08T17:30:00.000Z",
      },
    },
  };
}

function identity() {
  return {
    assertion,
    expires_at: "2026-09-11T17:00:00.000Z",
    refresh_token: { value: refreshToken, expires_at: "2026-10-08T17:00:00.000Z" },
  };
}

describe("WorkOS Agent Registration reference protocol", () => {
  it("registers, completes once, vault-ready maps credentials, and exchanges the assertion", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (url.endsWith("/claim/complete")) return json({ id: registrationId, status: "claimed", identity: identity() });
      if (url.endsWith("/oauth2/token")) return json({ access_token: accessToken, token_type: "bearer", expires_in: 300 });
      return json(registration());
    });
    const client = new WorkosAgentRegistrationClient(request, 100);

    const registered = await client.register(" Person@Example.com ");
    expect(registered).toMatchObject({ registrationId, claimToken, verificationExpiresAt: "2026-09-08T17:30:00.000Z" });
    const credential = await client.completeClaim(registered, userCode);
    expect(credential).toEqual({
      registrationId,
      assertion,
      assertionExpiresAt: "2026-09-11T17:00:00.000Z",
      refreshToken,
      refreshExpiresAt: "2026-10-08T17:00:00.000Z",
    });
    await expect(client.exchangeAssertion(assertion)).resolves.toEqual({ accessToken, expiresIn: 300 });

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ type: "service_auth", login_hint: "person@example.com" });
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ claim_token: claimToken, user_code: userCode });
    const form = new URLSearchParams(String(calls[2]?.init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")).toBe(assertion);
    expect(form.has("resource")).toBe(false);
    expect(calls).toHaveLength(3);
  });

  it("accepts the RFC case-insensitive Bearer token type and rejects other schemes", async () => {
    for (const tokenType of ["Bearer", "BEARER", "bearer"]) {
      const client = new WorkosAgentRegistrationClient(
        vi.fn<typeof fetch>().mockResolvedValue(json({ access_token: accessToken, token_type: tokenType, expires_in: 300 })),
        100,
      );
      await expect(client.exchangeAssertion(assertion)).resolves.toEqual({ accessToken, expiresIn: 300 });
    }
    const client = new WorkosAgentRegistrationClient(
      vi.fn<typeof fetch>().mockResolvedValue(json({ access_token: accessToken, token_type: "mac", expires_in: 300 })),
      100,
    );
    await expect(client.exchangeAssertion(assertion)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rotates refresh material through the same agent identity endpoint", async () => {
    const rotated = { ...identity(), refresh_token: { value: `rt_${"N".repeat(30)}`, expires_at: "2026-10-09T17:00:00.000Z" } };
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ id: registrationId, type: "refresh", identity: rotated }));
    const client = new WorkosAgentRegistrationClient(request, 100);

    await expect(client.refresh(refreshToken)).resolves.toMatchObject({
      registrationId,
      refreshToken: `rt_${"N".repeat(30)}`,
    });
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ type: "refresh", refresh_token: refreshToken });
  });

  it("does not repeat ambiguous completion, denial, expiry, or replay responses", async () => {
    for (const [status, code] of [[400, "EXPIRED"], [401, "DENIED"], [409, "REPLAYED"], [503, "DEPENDENCY"]] as const) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(json({ error: claimToken }, status));
      const client = new WorkosAgentRegistrationClient(request, 100);
      const registered = {
        registrationId,
        claimToken,
        claimExpiresAt: "2026-09-08T18:00:00.000Z",
        verificationUri: `https://app.qa.army/auth/agent/claim?token=${attemptToken}`,
        verificationExpiresAt: "2026-09-08T17:30:00.000Z",
      };
      const error = await client.completeClaim(registered, userCode).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(AgentRegistrationError);
      expect(error).toMatchObject({ code, attempts: 1 });
      expect(JSON.stringify(error)).not.toContain(claimToken);
      expect(request).toHaveBeenCalledOnce();
    }
  });

  it("rejects a verification URI outside the exact QA.army claim route", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({
      ...registration(),
      claim: {
        ...registration().claim,
        attempt: { ...registration().claim.attempt, verification_uri: `https://evil.example/claim?token=${attemptToken}` },
      },
    }));
    const client = new WorkosAgentRegistrationClient(request, 100);
    await expect(client.register("person@example.com")).rejects.toMatchObject({ code: "INVALID_RESPONSE", attempts: 1 });
  });
});
