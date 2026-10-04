// SPDX-License-Identifier: MIT
export const QA_ARMY_CREDENTIAL_SERVICE = "qa.army.cli";
export const QA_ARMY_API_KEY_ACCOUNT = "profile-api-key";

export interface CredentialStoreLocation {
  readonly service: typeof QA_ARMY_CREDENTIAL_SERVICE;
  readonly account: typeof QA_ARMY_API_KEY_ACCOUNT;
}

export interface ApiKeyCredentialStore {
  readonly location: CredentialStoreLocation;
  get(): Promise<string | undefined>;
  set(secret: string): Promise<void>;
  delete(): Promise<boolean>;
}

export interface NativeKeyringEntry {
  getPassword(signal?: AbortSignal): Promise<string | undefined>;
  setPassword(secret: string, signal?: AbortSignal): Promise<void>;
  deleteCredential(signal?: AbortSignal): Promise<boolean>;
}

export type NativeKeyringEntryFactory = () => Promise<NativeKeyringEntry>;

export class NativeApiKeyCredentialStore implements ApiKeyCredentialStore {
  readonly location = {
    service: QA_ARMY_CREDENTIAL_SERVICE,
    account: QA_ARMY_API_KEY_ACCOUNT,
  } as const;

  constructor(private readonly entry: NativeKeyringEntryFactory = nativeEntry) {}

  async get(): Promise<string | undefined> {
    try {
      const secret = await (await this.entry()).getPassword(AbortSignal.timeout(5_000));
      return secret && validApiKey(secret) ? secret : undefined;
    } catch {
      throw new Error("The native operating-system credential store is unavailable");
    }
  }

  async set(secret: string): Promise<void> {
    if (!validApiKey(secret)) throw new Error("QA.army returned an invalid API key");
    try {
      await (await this.entry()).setPassword(secret, AbortSignal.timeout(5_000));
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

export function validApiKey(value: string): boolean {
  return /^qa_live_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(value);
}

async function nativeEntry(): Promise<NativeKeyringEntry> {
  const { AsyncEntry } = await import("@napi-rs/keyring");
  return new AsyncEntry(QA_ARMY_CREDENTIAL_SERVICE, QA_ARMY_API_KEY_ACCOUNT);
}
