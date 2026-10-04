// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  HiddenStdinUserCodeReader,
  MacOsStdinVerificationUriOpener,
  SystemVerificationUriOpener,
  WorkosAgentAuthCommand,
  type StdinOnlyChildProcess,
} from "../src/agent-auth-flow.js";
import type { AgentCredentialStore } from "../src/agent-auth-store.js";
import type { AgentRegistrationProtocol } from "../src/workos-agent-registration.js";

const registrationId = `agent_reg_${"R".repeat(26)}`;
const attemptToken = `cat_${"A".repeat(24)}_-B6G8`;
const claimToken = `clm_${"C".repeat(26)}`;
const userCode = "BCDF-GHJK";
const assertion = "header.payload.signature";
const refreshToken = `rt_${"T".repeat(30)}`;
const accessToken = "access.payload.signature";
const qaUserId = `usr_${"1".repeat(32)}`;

function fixture(overrides: { readonly storeFailure?: boolean } = {}) {
  const order: string[] = [];
  const protocol: AgentRegistrationProtocol = {
    register: vi.fn(async () => {
      order.push("register");
      return {
        registrationId,
        claimToken,
        claimExpiresAt: "2026-09-08T18:00:00.000Z",
        verificationUri: `https://app.qa.army/auth/agent/claim?token=${attemptToken}`,
        verificationExpiresAt: "2026-09-08T17:30:00.000Z",
      };
    }),
    completeClaim: vi.fn(async () => {
      order.push("complete");
      return {
        registrationId,
        assertion,
        assertionExpiresAt: "2026-09-11T17:00:00.000Z",
        refreshToken,
        refreshExpiresAt: "2026-10-08T17:00:00.000Z",
      };
    }),
    exchangeAssertion: vi.fn(async () => {
      order.push("exchange");
      return { accessToken, expiresIn: 300 };
    }),
    refresh: vi.fn(),
  };
  const store: AgentCredentialStore = {
    location: { service: "qa.army.cli", account: "agent-identity" },
    get: vi.fn(),
    set: vi.fn(async () => {
      order.push("vault");
      if (overrides.storeFailure) throw new Error("native store unavailable");
    }),
    delete: vi.fn(),
  };
  const opener = { open: vi.fn(async () => { order.push("open"); }) };
  const codeReader = { read: vi.fn(async () => { order.push("read"); return userCode; }) };
  const request = vi.fn<typeof fetch>(async () => {
    order.push("api");
    return new Response(JSON.stringify({ user: { id: qaUserId }, destination: { kind: "create_workspace", path: "/onboarding/workspace" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { order, protocol, store, opener, codeReader, request };
}

describe("one-link manual-code agent authentication", () => {
  it("opens one link, consumes one hidden code, vaults credentials before exchange, and verifies M2", async () => {
    const f = fixture();
    const awaiting: unknown[] = [];
    const command = new WorkosAgentAuthCommand(f.protocol, f.store, f.codeReader, f.opener, f.request);
    const result = await command.registerAndClaim({
      loginHint: "person@example.com",
      productApiBaseUrl: "https://api.qa.army",
      onAwaitingUserCode: (value) => awaiting.push(value),
    });

    expect(f.order).toEqual(["register", "open", "read", "complete", "vault", "exchange", "api"]);
    expect(f.opener.open).toHaveBeenCalledOnce();
    expect(f.codeReader.read).toHaveBeenCalledOnce();
    expect(f.protocol.completeClaim).toHaveBeenCalledOnce();
    expect(f.store.set).toHaveBeenCalledOnce();
    expect(f.request.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${accessToken}` });
    expect(awaiting).toEqual([{
      status: "AWAITING_USER_CODE",
      registration_id: registrationId,
      verification_uri_origin: "https://app.qa.army",
      verification_uri_path: "/auth/agent/claim",
      expires_at: "2026-09-08T17:30:00.000Z",
    }]);
    expect(result).toEqual({
      status: "AUTHENTICATED",
      registration_id: registrationId,
      qa_user_id: qaUserId,
      access_token_expires_in: 300,
      allowed_operation: "getSessionBootstrap",
      credential_store: f.store.location,
    });
    const visible = JSON.stringify([awaiting, result]);
    for (const secret of [attemptToken, claimToken, userCode, assertion, refreshToken, accessToken]) {
      expect(visible).not.toContain(secret);
    }
  });

  it("does not exchange or call QA.army when the post-claim native-vault write fails", async () => {
    const f = fixture({ storeFailure: true });
    const command = new WorkosAgentAuthCommand(f.protocol, f.store, f.codeReader, f.opener, f.request);
    await expect(command.registerAndClaim({
      loginHint: "person@example.com",
      productApiBaseUrl: "https://api.qa.army",
      onAwaitingUserCode: () => undefined,
    })).rejects.toThrow("native store unavailable");
    expect(f.protocol.completeClaim).toHaveBeenCalledOnce();
    expect(f.protocol.exchangeAssertion).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
  });

  it("rejects an attacker-controlled Product API origin before registration or token exchange", async () => {
    const f = fixture();
    const command = new WorkosAgentAuthCommand(f.protocol, f.store, f.codeReader, f.opener, f.request);
    await expect(command.registerAndClaim({
      loginHint: "person@example.com",
      productApiBaseUrl: "https://attacker.example/collect",
      onAwaitingUserCode: () => undefined,
    })).rejects.toThrow("The QA.army Product API origin is invalid");
    expect(f.protocol.register).not.toHaveBeenCalled();
    expect(f.protocol.completeClaim).not.toHaveBeenCalled();
    expect(f.protocol.exchangeAssertion).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
  });

  it("reads a TTY user code with echo disabled and restores terminal mode", async () => {
    const modes: boolean[] = [];
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      isRaw: boolean;
      setRawMode(mode: boolean): void;
    };
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = (mode) => { modes.push(mode); input.isRaw = mode; };
    const read = new HiddenStdinUserCodeReader(input).read();
    input.end("bcdf-ghjk\n");

    await expect(read).resolves.toBe(userCode);
    expect(modes).toEqual([true, false]);
  });

  it("opens the token-bearing URI through stdin with an empty child-process argument list", async () => {
    const calls: Array<{ readonly command: string; readonly args: readonly string[]; readonly stdin: string }> = [];
    const launcher = (command: string, args: readonly string[]): StdinOnlyChildProcess => {
      const emitter = new EventEmitter();
      const call = { command, args, stdin: "" };
      calls.push(call);
      const child = Object.assign(emitter, {
        stdin: { end: (value: string) => { call.stdin = value; queueMicrotask(() => emitter.emit("exit", 0)); } },
        kill: () => true,
      });
      return child as unknown as StdinOnlyChildProcess;
    };
    const uri = `https://app.qa.army/auth/agent/claim?token=${attemptToken}`;
    await new MacOsStdinVerificationUriOpener("darwin", launcher).open(uri);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("/usr/bin/osascript");
    expect(calls[0]?.args).toEqual([]);
    expect(calls[0]?.stdin).toContain(uri);
    expect(JSON.stringify(calls[0]?.args)).not.toContain(attemptToken);
  });

  it("opens Windows verification through a stdin script with only static process arguments", async () => {
    const calls: Array<{ readonly command: string; readonly args: readonly string[]; readonly stdin: string }> = [];
    const launcher = successfulLauncher(calls);
    const uri = `https://app.qa.army/auth/agent/claim?token=${attemptToken}`;

    await new SystemVerificationUriOpener("win32", launcher).open(uri);

    expect(calls[0]?.command).toBe("powershell.exe");
    expect(calls[0]?.stdin).toContain(uri);
    expect(JSON.stringify(calls[0]?.args)).not.toContain(attemptToken);
  });

  it("opens Linux verification in process through the desktop portal", async () => {
    const portal = vi.fn(async () => undefined);
    const launcher = vi.fn();
    const uri = `https://app.qa.army/auth/agent/claim?token=${attemptToken}`;

    await new SystemVerificationUriOpener("linux", launcher, portal).open(uri);

    expect(portal).toHaveBeenCalledWith(uri);
    expect(launcher).not.toHaveBeenCalled();
  });
});

function successfulLauncher(
  calls: Array<{ readonly command: string; readonly args: readonly string[]; readonly stdin: string }>,
) {
  return (command: string, args: readonly string[]): StdinOnlyChildProcess => {
    const emitter = new EventEmitter();
    const call = { command, args, stdin: "" };
    calls.push(call);
    return Object.assign(emitter, {
      stdin: { end: (value: string) => { call.stdin = value; queueMicrotask(() => emitter.emit("exit", 0)); } },
      kill: () => true,
    }) as unknown as StdinOnlyChildProcess;
  };
}
