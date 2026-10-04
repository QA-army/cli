// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { NativeAgentCredentialStore, type AgentCredential } from "../src/agent-auth-store.js";
import type { NativeKeyringEntry } from "../src/auth-store.js";

const credential: AgentCredential = {
  registrationId: `agent_reg_${"R".repeat(26)}`,
  assertion: "header.payload.signature",
  assertionExpiresAt: "2026-09-11T12:00:00.000Z",
  refreshToken: `rt_${"A".repeat(30)}`,
  refreshExpiresAt: "2026-10-08T12:00:00.000Z",
};

function entry(overrides: Partial<NativeKeyringEntry> = {}): NativeKeyringEntry {
  return {
    getPassword: vi.fn().mockResolvedValue(undefined),
    setPassword: vi.fn().mockResolvedValue(undefined),
    deleteCredential: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("native WorkOS agent credential store", () => {
  it("writes assertion and rotating refresh material directly to one native-vault record", async () => {
    const native = entry({ getPassword: vi.fn().mockResolvedValue(JSON.stringify(credential)) });
    const store = new NativeAgentCredentialStore(async () => native);
    expect(store.location).toEqual({ service: "qa.army.cli", account: "agent-identity" });

    await store.set(credential);
    await expect(store.get()).resolves.toEqual(credential);
    expect(native.setPassword).toHaveBeenCalledWith(JSON.stringify(credential), expect.any(AbortSignal));
  });

  it("rejects malformed records and redacts native-vault failures", async () => {
    const store = new NativeAgentCredentialStore(async () => entry({
      setPassword: vi.fn().mockRejectedValue(new Error(credential.assertion)),
      getPassword: vi.fn().mockRejectedValue(new Error(credential.refreshToken)),
    }));
    await expect(store.set({ ...credential, assertion: "invalid" })).rejects.toThrow("WorkOS returned an invalid agent credential");
    await expect(store.set(credential)).rejects.toThrow("The native operating-system credential store is unavailable");
    await expect(store.get()).rejects.toThrow("The native operating-system credential store is unavailable");
  });
});
