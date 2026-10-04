// SPDX-License-Identifier: MIT
import {
  QA_ARMY_CREDENTIAL_SERVICE,
  type NativeKeyringEntry,
  type NativeKeyringEntryFactory,
} from "./auth-store.js";

export const QA_ARMY_AGENT_IDENTITY_ACCOUNT = "agent-identity";

export interface AgentCredentialStoreLocation {
  readonly service: typeof QA_ARMY_CREDENTIAL_SERVICE;
  readonly account: typeof QA_ARMY_AGENT_IDENTITY_ACCOUNT;
}

export interface AgentCredential {
  readonly registrationId: string;
  readonly assertion: string;
  readonly assertionExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: string;
}

export interface AgentCredentialStore {
  readonly location: AgentCredentialStoreLocation;
  get(): Promise<AgentCredential | undefined>;
  set(credential: AgentCredential): Promise<void>;
  delete(): Promise<boolean>;
}

export class NativeAgentCredentialStore implements AgentCredentialStore {
  readonly location = {
    service: QA_ARMY_CREDENTIAL_SERVICE,
    account: QA_ARMY_AGENT_IDENTITY_ACCOUNT,
  } as const;

  constructor(private readonly entry: NativeKeyringEntryFactory = nativeAgentEntry) {}

  async get(): Promise<AgentCredential | undefined> {
    try {
      const value = await (await this.entry()).getPassword(AbortSignal.timeout(5_000));
      if (!value) return undefined;
      const parsed = JSON.parse(value) as unknown;
      return validAgentCredential(parsed) ? parsed : undefined;
    } catch {
      throw new Error("The native operating-system credential store is unavailable");
    }
  }

  async set(credential: AgentCredential): Promise<void> {
    if (!validAgentCredential(credential)) throw new Error("WorkOS returned an invalid agent credential");
    try {
      await (await this.entry()).setPassword(JSON.stringify(credential), AbortSignal.timeout(5_000));
    } catch {
      throw new Error("The native operating-system credential store is unavailable");
    }
  }

  async delete(): Promise<boolean> {
    try {
      return await (await this.entry()).deleteCredential(AbortSignal.timeout(5_000));
    } catch {
      throw new Error("The native operating-system credential store is unavailable");
    }
  }
}

export function validAgentCredential(value: unknown): value is AgentCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  if (Object.keys(record).some((key) => ![
    "registrationId", "assertion", "assertionExpiresAt", "refreshToken", "refreshExpiresAt",
  ].includes(key))) return false;
  return (
    typeof record.registrationId === "string" && /^agent_reg_[A-Za-z0-9]{20,64}$/.test(record.registrationId) &&
    typeof record.assertion === "string" && jwtPattern.test(record.assertion) && record.assertion.length <= 16_384 &&
    validTimestamp(record.assertionExpiresAt) &&
    typeof record.refreshToken === "string" && secretPattern.test(record.refreshToken) && record.refreshToken.length <= 4_096 &&
    validTimestamp(record.refreshExpiresAt)
  );
}

const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const secretPattern = /^[A-Za-z0-9._~-]{20,4096}$/;

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

async function nativeAgentEntry(): Promise<NativeKeyringEntry> {
  const { AsyncEntry } = await import("@napi-rs/keyring");
  return new AsyncEntry(QA_ARMY_CREDENTIAL_SERVICE, QA_ARMY_AGENT_IDENTITY_ACCOUNT);
}
