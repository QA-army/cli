// SPDX-License-Identifier: MIT
import { agentEnvironments, agentEnvironmentForApi } from "./agent-environment.js";
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import {
  NativeAgentCredentialStore,
  type AgentCredentialStore,
} from "./agent-auth-store.js";
import {
  WorkosAgentRegistrationClient,
  type AgentRegistration,
  type AgentRegistrationProtocol,
} from "./workos-agent-registration.js";
import { openLinuxDesktopPortal } from "./linux-desktop-portal.js";

const userCodePattern = /^[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8})?$/;
const qaUserIdPattern = /^usr_[a-f0-9]{32}$/;

export interface AgentAuthAwaitingUserCode {
  readonly status: "AWAITING_USER_CODE";
  readonly registration_id: string;
  readonly verification_uri_origin: (typeof agentEnvironments)[keyof typeof agentEnvironments]["claimOrigin"];
  readonly verification_uri_path: "/auth/agent/claim";
  readonly expires_at: string;
}

export interface AgentAuthReceipt {
  readonly status: "AUTHENTICATED";
  readonly registration_id: string;
  readonly qa_user_id: string;
  readonly access_token_expires_in: number;
  readonly allowed_operation: "getSessionBootstrap";
  readonly credential_store: AgentCredentialStore["location"];
}

export interface AgentAuthCommand {
  registerAndClaim(input: {
    readonly loginHint: string;
    readonly productApiBaseUrl: string;
    readonly onAwaitingUserCode: (receipt: AgentAuthAwaitingUserCode) => void;
  }): Promise<AgentAuthReceipt>;
}

export interface SecretUserCodeReader {
  read(): Promise<string>;
}

export interface VerificationUriOpener {
  open(uri: string): Promise<void>;
}

export interface StdinOnlyChildProcess {
  readonly stdin: { end(value: string): void };
  once(event: "error", listener: () => void): this;
  once(event: "exit", listener: (code: number | null) => void): this;
  kill(): boolean;
}

export type StdinOnlyProcessLauncher = (
  command: string,
  args: readonly string[],
) => StdinOnlyChildProcess;

export type LinuxPortalOpenUri = (uri: string) => Promise<void>;

export class WorkosAgentAuthCommand implements AgentAuthCommand {
  constructor(
    private readonly workos?: AgentRegistrationProtocol,
    private readonly store?: AgentCredentialStore,
    private readonly codeReader: SecretUserCodeReader = new HiddenStdinUserCodeReader(),
    private readonly opener: VerificationUriOpener = new SystemVerificationUriOpener(),
    private readonly request: typeof fetch = fetch,
  ) {}

  async registerAndClaim(input: {
    readonly loginHint: string;
    readonly productApiBaseUrl: string;
    readonly onAwaitingUserCode: (receipt: AgentAuthAwaitingUserCode) => void;
  }): Promise<AgentAuthReceipt> {
    const environment = agentEnvironmentForApi(input.productApiBaseUrl);
    const productApiBaseUrl = agentEnvironments[environment].apiOrigin;
    const workos = this.workos ?? new WorkosAgentRegistrationClient(this.request, 8_000, environment);
    const store = this.store ?? new NativeAgentCredentialStore(undefined, environment);
    if ((workos.environment && workos.environment !== environment) || store.location.account !== agentEnvironments[environment].agentAccount) {
      throw new Error("Agent credentials and protocol must match the Product API environment");
    }
    const registration = await workos.register(input.loginHint);
    if (validatedVerificationUri(registration.verificationUri).origin !== agentEnvironments[environment].claimOrigin) {
      throw new Error("WorkOS returned a verification link for a different environment");
    }
    await this.opener.open(registration.verificationUri);
    input.onAwaitingUserCode(awaitingReceipt(registration));
    const userCode = await this.codeReader.read();
    if (!userCodePattern.test(userCode)) throw new Error("The one-time user code is invalid or expired");

    // Claim completion is deliberately called exactly once. A transport failure
    // is ambiguous and requires a fresh registration instead of an automatic replay.
    const credential = await workos.completeClaim(registration, userCode);
    await store.set(credential);
    const exchanged = await workos.exchangeAssertion(credential.assertion);
    const qaUserId = await verifyAllowedProductCall(productApiBaseUrl, exchanged.accessToken, this.request);
    return {
      status: "AUTHENTICATED",
      registration_id: registration.registrationId,
      qa_user_id: qaUserId,
      access_token_expires_in: exchanged.expiresIn,
      allowed_operation: "getSessionBootstrap",
      credential_store: store.location,
    };
  }
}

export class HiddenStdinUserCodeReader implements SecretUserCodeReader {
  constructor(private readonly input: Readable & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (mode: boolean) => unknown } = process.stdin) {}

  async read(): Promise<string> {
    const rawMode = Boolean(this.input.isTTY && this.input.setRawMode);
    const priorRaw = Boolean(this.input.isRaw);
    if (rawMode) this.input.setRawMode?.(true);
    this.input.resume();
    try {
      return await new Promise<string>((resolve, reject) => {
        let value = "";
        const finish = (error?: Error) => {
          this.input.off("data", onData);
          this.input.off("end", onEnd);
          this.input.off("error", onError);
          if (error) reject(error);
          else resolve(value.trim().toUpperCase());
        };
        const onEnd = () => finish();
        const onError = () => finish(new Error("The one-time user code could not be read securely"));
        const onData = (chunk: Buffer | string) => {
          for (const character of String(chunk)) {
            if (character === "\u0003") return finish(new Error("Agent authentication was cancelled"));
            if (character === "\r" || character === "\n") return finish();
            if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
            else if (value.length < 32 && /[A-Za-z0-9-]/.test(character)) value += character;
          }
        };
        this.input.on("data", onData);
        this.input.once("end", onEnd);
        this.input.once("error", onError);
      });
    } finally {
      if (rawMode) this.input.setRawMode?.(priorRaw);
      this.input.pause();
    }
  }
}

export class SystemVerificationUriOpener implements VerificationUriOpener {
  constructor(
    private readonly platform = process.platform,
    private readonly launcher: StdinOnlyProcessLauncher = launchStdinOnly,
    private readonly linuxPortal: LinuxPortalOpenUri = openLinuxDesktopPortal,
  ) {}

  async open(uri: string): Promise<void> {
    const target = validatedVerificationUri(uri);
    if (this.platform === "linux") {
      try {
        await this.linuxPortal(target.toString());
        return;
      } catch {
        throw new Error("The agent claim link could not be opened through the Linux desktop portal");
      }
    }
    if (this.platform === "darwin") {
      const escaped = target.toString().replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      return runStdinScript(this.launcher, "/usr/bin/osascript", [], `open location "${escaped}"\n`);
    }
    if (this.platform === "win32") {
      const escaped = target.toString().replaceAll("'", "''");
      const script = `$target = '${escaped}'\n$start = New-Object System.Diagnostics.ProcessStartInfo\n$start.FileName = $target\n$start.UseShellExecute = $true\n[System.Diagnostics.Process]::Start($start) | Out-Null\n`;
      return runStdinScript(
        this.launcher,
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"],
        script,
      );
    }
    throw new Error("A secret-safe browser opener is unavailable on this operating system");
  }
}

export class MacOsStdinVerificationUriOpener implements VerificationUriOpener {
  constructor(
    private readonly platform = process.platform,
    private readonly launcher: StdinOnlyProcessLauncher = launchStdinOnly,
  ) {}

  open(uri: string): Promise<void> {
    if (this.platform !== "darwin") {
      return Promise.reject(new Error("A secret-safe browser opener is unavailable on this operating system"));
    }
    return new SystemVerificationUriOpener(this.platform, this.launcher).open(uri);
  }
}

async function runStdinScript(
  launcher: StdinOnlyProcessLauncher,
  command: string,
  args: readonly string[],
  script: string,
): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = launcher(command, args);
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("The agent claim link could not be opened"));
      }, 5_000);
      child.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("The agent claim link could not be opened"));
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error("The agent claim link could not be opened"));
      });
      child.stdin.end(script);
    });
}

function launchStdinOnly(command: string, args: readonly string[]): StdinOnlyChildProcess {
  return spawn(command, [...args], { stdio: ["pipe", "ignore", "ignore"] }) as unknown as StdinOnlyChildProcess;
}

function awaitingReceipt(registration: AgentRegistration): AgentAuthAwaitingUserCode {
  const uri = validatedVerificationUri(registration.verificationUri);
  return {
    status: "AWAITING_USER_CODE",
    registration_id: registration.registrationId,
    verification_uri_origin: uri.origin as AgentAuthAwaitingUserCode["verification_uri_origin"],
    verification_uri_path: uri.pathname as "/auth/agent/claim",
    expires_at: registration.verificationExpiresAt,
  };
}

function validatedVerificationUri(value: string): URL {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    throw new Error("WorkOS returned an invalid verification link");
  }
  if (
    ![agentEnvironments.production.claimOrigin, agentEnvironments.staging.claimOrigin].some(origin => origin === uri.origin) || uri.username || uri.password || uri.pathname !== "/auth/agent/claim" || uri.hash ||
    uri.searchParams.size !== 1 || !/^(?:cat_|att_|cla_tkn_)[A-Za-z0-9_-]{20,128}$/.test(uri.searchParams.get("token") ?? "")
  ) throw new Error("WorkOS returned an invalid verification link");
  return uri;
}

async function verifyAllowedProductCall(baseUrl: string, accessToken: string, request: typeof fetch): Promise<string> {
  let response: Response;
  try {
    response = await request(`${baseUrl.replace(/\/$/, "")}/v1/session`, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new Error("The QA.army agent session could not be verified");
  }
  if (!response.ok) throw new Error("The QA.army agent session could not be verified");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The QA.army agent session could not be verified");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("The QA.army agent session could not be verified");
  }
  const user = (body as Readonly<Record<string, unknown>>).user;
  if (!user || typeof user !== "object" || Array.isArray(user)) {
    throw new Error("The QA.army agent session could not be verified");
  }
  const userId = (user as Readonly<Record<string, unknown>>).id;
  if (typeof userId !== "string" || !qaUserIdPattern.test(userId)) {
    throw new Error("The QA.army agent session could not be verified");
  }
  return userId;
}
