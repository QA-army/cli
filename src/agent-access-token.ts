// SPDX-License-Identifier: MIT
import {
  NativeAgentCredentialStore,
  type AgentCredential,
  type AgentCredentialStore,
} from "./agent-auth-store.js";
import {
  AgentRegistrationError,
  WorkosAgentRegistrationClient,
  type AgentRegistrationProtocol,
} from "./workos-agent-registration.js";

export interface ApiAccessTokenProvider {
  accessToken(): Promise<string>;
  reexchangeAfterUnauthorized(rejectedToken?: string): Promise<string>;
}

const expirySkewMs = 30_000;

export class WorkosAgentAccessTokenProvider implements ApiAccessTokenProvider {
  private inFlight: Promise<string> | undefined;
  private cached: { readonly value: string; readonly expiresAt: number } | undefined;

  constructor(
    private readonly store: AgentCredentialStore = new NativeAgentCredentialStore(),
    private readonly workos: AgentRegistrationProtocol = new WorkosAgentRegistrationClient(),
    private readonly now: () => number = Date.now,
    private initialCredential?: AgentCredential,
  ) {}

  async accessToken(): Promise<string> {
    if (this.inFlight) return this.inFlight;
    if (this.cached && this.cached.expiresAt > this.now() + expirySkewMs) return this.cached.value;
    return this.singleFlight(false);
  }

  async reexchangeAfterUnauthorized(rejectedToken?: string): Promise<string> {
    // A late 401 must not invalidate a token already replaced by another request.
    if (rejectedToken && this.cached && this.cached.value !== rejectedToken && this.cached.expiresAt > this.now()+expirySkewMs) return this.cached.value;
    return this.singleFlight(true);
  }

  private singleFlight(forceRefresh: boolean): Promise<string> {
    if (this.inFlight) return this.inFlight;
    const work = () => this.exchange(forceRefresh);
    const pending = this.store.withCredentialLock ? this.store.withCredentialLock(work) : work();
    this.inFlight = pending;
    void pending.finally(() => { if (this.inFlight === pending) this.inFlight = undefined; }).catch(() => undefined);
    return pending;
  }

  private async exchange(forceRefresh: boolean): Promise<string> {
    // Native clients re-read after acquiring the process lock: another process
    // may have rotated the persisted refresh credential while we waited.
    let credential = this.store.withCredentialLock ? await this.store.get() : this.initialCredential ?? await this.store.get();
    this.initialCredential = undefined;
    if (!credential) throw new Error("No QA.army credential is available");

    const assertionExpired = Date.parse(credential.assertionExpiresAt) <= this.now() + expirySkewMs;
    if (assertionExpired) {
      credential = await this.refresh(credential);
    }
    try {
      const exchanged = await this.workos.exchangeAssertion(credential.assertion);
      this.cached = { value: exchanged.accessToken, expiresAt: this.now() + exchanged.expiresIn * 1_000 };
      return exchanged.accessToken;
    } catch (error) {
      if (!forceRefresh && error instanceof AgentRegistrationError && error.code === "DENIED") {
        credential = await this.refresh(credential);
        const exchanged = await this.workos.exchangeAssertion(credential.assertion);
        this.cached = { value: exchanged.accessToken, expiresAt: this.now() + exchanged.expiresIn * 1_000 };
        return exchanged.accessToken;
      }
      throw error;
    }
  }

  private async refresh(credential: AgentCredential): Promise<AgentCredential> {
    if (Date.parse(credential.refreshExpiresAt) <= this.now() + expirySkewMs) {
      throw new Error("The QA.army agent identity has expired; start a new claim-link ceremony");
    }
    const refreshed = await this.workos.refresh(credential.refreshToken);
    if (refreshed.registrationId !== credential.registrationId) {
      throw new Error("WorkOS returned an invalid agent credential");
    }
    await this.store.set(refreshed);
    return refreshed;
  }
}
