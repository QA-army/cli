// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";

describe("native credential-store package", () => {
  it("loads the current operating-system keyring adapter", async () => {
    const keyring = await import("@napi-rs/keyring");
    expect(typeof keyring.AsyncEntry).toBe("function");
  });
});
