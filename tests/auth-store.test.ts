// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import {
  NativeApiKeyCredentialStore,
  type NativeKeyringEntry,
} from "../src/auth-store.js";

const credential = () => `qa_live_${"1".repeat(32)}_${"A".repeat(43)}`;

function entry(overrides: Partial<NativeKeyringEntry> = {}): NativeKeyringEntry {
  return {
    getPassword: vi.fn().mockResolvedValue(undefined),
    setPassword: vi.fn().mockResolvedValue(undefined),
    deleteCredential: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("native operating-system API-key store", () => {
  it("uses the QA.army service/account and passes the secret only to the direct native binding", async () => {
    const native = entry({ getPassword: vi.fn().mockResolvedValue(credential()) });
    const store = new NativeApiKeyCredentialStore(async () => native);
    expect(store.location).toEqual({ service: "qa.army.cli", account: "profile-api-key" });
    await store.set(credential());
    await expect(store.get()).resolves.toBe(credential());
    await store.delete();
    expect(native.setPassword).toHaveBeenCalledWith(credential(), expect.any(AbortSignal));
    expect(native.deleteCredential).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("rejects invalid values and sanitizes native backend failures", async () => {
    const store = new NativeApiKeyCredentialStore(async () => entry({
      setPassword: vi.fn().mockRejectedValue(new Error("underlying secret value")),
      getPassword: vi.fn().mockRejectedValue(new Error("locked with details")),
    }));
    await expect(store.set("not-a-key")).rejects.toThrow("QA.army returned an invalid API key");
    await expect(store.set(credential())).rejects.toThrow("The native operating-system credential store is unavailable");
    await expect(store.get()).rejects.toThrow("The native operating-system credential store is unavailable");
  });
});
