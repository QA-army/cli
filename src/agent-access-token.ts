// SPDX-License-Identifier: MIT
import { agentEnvironments } from "./agent-environment.js";
import type { ApiAccessTokenProvider } from "./api.js";
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

const expirySkewMs = 30_000;

export class WorkosAgentAccessTokenProvider implements ApiAccessTokenProvider {
  private cached: { readonly value: string; readonly expiresAt: number } | undefined;

  constructor(
    private readonly store: AgentCredentialStore = new NativeAgentCredentialStore(),
    private readonly workos: AgentRegistrationProtocol = new WorkosAgentRegistrationClient(),
    private readonly now: () => number = Date.now,
    private initialCredential?: AgentCredential,
  ) {
    if (workos.environment && store.location.account !== agentEnvironments[workos.environment].agentAccount) {
      throw new Error("Agent credential store must match the WorkOS environment");
    }
  }

  async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.now() + expirySkewMs) return this.cached.value;
    return this.exchange(false);
  }

  async reexchangeAfterUnauthorized(): Promise<string> {
    this.cached = undefined;
    return this.exchange(true);
  }

  private async exchange(forceRefresh: boolean): Promise<string> {
    let credential = this.initialCredential ?? await this.store.get();
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
