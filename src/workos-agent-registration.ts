// SPDX-License-Identifier: MIT
import { agentEnvironments, type AgentEnvironment } from "./agent-environment.js";
import type { AgentCredential } from "./agent-auth-store.js";

export const WORKOS_AGENT_ISSUER = "https://heavenly-experience-04.authkit.app";

const maximumResponseBytes = 32 * 1024;
const registrationPattern = /^agent_reg_[A-Za-z0-9]{20,64}$/;
const claimTokenPattern = /^clm_[A-Za-z0-9_-]{20,128}$/;
const attemptTokenPattern = /^(?:cat_|att_|cla_tkn_)[A-Za-z0-9_-]{20,128}$/;
const userCodePattern = /^[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8})?$/;
const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface AgentRegistration {
  readonly registrationId: string;
  readonly claimToken: string;
  readonly claimExpiresAt: string;
  readonly verificationUri: string;
  readonly verificationExpiresAt: string;
}

export interface ExchangedAgentToken {
  readonly accessToken: string;
  readonly expiresIn: number;
}

export interface AgentRegistrationProtocol {
  readonly environment?: AgentEnvironment;
  register(loginHint: string): Promise<AgentRegistration>;
  completeClaim(registration: AgentRegistration, userCode: string): Promise<AgentCredential>;
  exchangeAssertion(assertion: string): Promise<ExchangedAgentToken>;
  refresh(refreshToken: string): Promise<AgentCredential>;
}

export type AgentRegistrationFailureCode =
  | "NOT_CONFIGURED"
  | "INVALID_INPUT"
  | "DENIED"
  | "EXPIRED"
  | "REPLAYED"
  | "DEPENDENCY"
  | "INVALID_RESPONSE";

export class AgentRegistrationError extends Error {
  readonly attempts = 1;

  constructor(readonly code: AgentRegistrationFailureCode, readonly status: number | null) {
    super(code === "NOT_CONFIGURED" ? "WorkOS staging Agent Registration is not advertised by the verified issuer; enable the existing staging registration configuration before claiming" : "WorkOS agent registration could not be completed");
    this.name = "AgentRegistrationError";
  }
}

export class WorkosAgentRegistrationClient implements AgentRegistrationProtocol {
  constructor(
    private readonly request: FetchLike = fetch,
    private readonly timeoutMs = 8_000,
    readonly environment: AgentEnvironment = "production",
  ) {
    if (!Object.hasOwn(agentEnvironments, environment)) throw new Error("Unsupported agent environment");
  }

  async register(loginHint: string): Promise<AgentRegistration> {
    const email = canonicalEmail(loginHint);
    if (!email) throw new AgentRegistrationError("INVALID_INPUT", null);
    if (this.environment === "staging") await this.requireStagingDiscovery();
    const payload = await this.jsonRequest(`${agentEnvironments[this.environment].issuer}/agent/identity`, {
      type: "service_auth",
      login_hint: email,
    }, "register");
    return parseRegistration(payload, agentEnvironments[this.environment].claimOrigin);
  }

  async completeClaim(registration: AgentRegistration, userCode: string): Promise<AgentCredential> {
    if (!validVerificationUri(registration.verificationUri, agentEnvironments[this.environment].claimOrigin)) {
      throw new AgentRegistrationError("INVALID_INPUT", null);
    }
    if (!userCodePattern.test(userCode)) throw new AgentRegistrationError("INVALID_INPUT", null);
    const payload = await this.jsonRequest(`${agentEnvironments[this.environment].issuer}/agent/identity/claim/complete`, {
      claim_token: registration.claimToken,
      user_code: userCode,
    }, "complete");
    return parseCompletedCredential(payload, registration.registrationId);
  }

  async exchangeAssertion(assertion: string): Promise<ExchangedAgentToken> {
    if (!jwtPattern.test(assertion) || assertion.length > 16_384) {
      throw new AgentRegistrationError("INVALID_INPUT", null);
    }
    const form = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });
    const payload = await this.requestOnce(`${agentEnvironments[this.environment].issuer}/oauth2/token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }, "exchange");
    return parseAccessToken(payload);
  }

  async refresh(refreshToken: string): Promise<AgentCredential> {
    if (!/^[A-Za-z0-9._~-]{20,4096}$/.test(refreshToken)) {
      throw new AgentRegistrationError("INVALID_INPUT", null);
    }
    const payload = await this.jsonRequest(`${agentEnvironments[this.environment].issuer}/agent/identity`, {
      type: "refresh",
      refresh_token: refreshToken,
    }, "refresh");
    return parseRefreshedCredential(payload);
  }

  private async requireStagingDiscovery(): Promise<void> {
    const issuer = agentEnvironments.staging.issuer;
    const payload = record(await this.requestOnce(`${issuer}/.well-known/oauth-authorization-server`, {
      method: "GET", headers: { accept: "application/json" },
    }, "register"));
    const auth = payload.agent_auth;
    if (payload.issuer !== issuer || payload.jwks_uri !== `${issuer}/oauth2/jwks` ||
      !auth || typeof auth !== "object" || Array.isArray(auth)) {
      throw new AgentRegistrationError("NOT_CONFIGURED", null);
    }
    const discovery = auth as Readonly<Record<string, unknown>>;
    if (discovery.identity_endpoint !== `${issuer}/agent/identity` ||
      discovery.claim_endpoint !== `${issuer}/agent/identity/claim` ||
      discovery.skill !== `${issuer}/agent/auth.md` ||
      !Array.isArray(discovery.identity_types_supported) || !discovery.identity_types_supported.includes("service_auth")) {
      throw new AgentRegistrationError("NOT_CONFIGURED", null);
    }
  }

  private jsonRequest(url: string, body: Readonly<Record<string, string>>, phase: RequestPhase): Promise<unknown> {
    return this.requestOnce(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    }, phase);
  }

  private async requestOnce(url: string, init: RequestInit, phase: RequestPhase): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.request(url, { ...init, redirect: "error", signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new AgentRegistrationError(classify(response.status, phase), response.status);
      }
      return await readBoundedJson(response);
    } catch (error) {
      if (error instanceof AgentRegistrationError) throw error;
      throw new AgentRegistrationError("DEPENDENCY", null);
    } finally {
      clearTimeout(timeout);
    }
  }
}

type RequestPhase = "register" | "complete" | "exchange" | "refresh";

function parseRegistration(value: unknown, claimOrigin: string): AgentRegistration {
  const body = record(value);
  const claim = record(body.claim);
  const attempt = record(claim.attempt);
  if (
    typeof body.id !== "string" || !registrationPattern.test(body.id) || body.type !== "service_auth" ||
    typeof claim.token !== "string" || !claimTokenPattern.test(claim.token) || !validTimestamp(claim.expires_at) ||
    typeof attempt.verification_uri !== "string" || !validTimestamp(attempt.expires_at)
  ) throw new AgentRegistrationError("INVALID_RESPONSE", 200);
  const verificationUri = validVerificationUri(attempt.verification_uri, claimOrigin);
  if (!verificationUri) throw new AgentRegistrationError("INVALID_RESPONSE", 200);
  return {
    registrationId: body.id,
    claimToken: claim.token,
    claimExpiresAt: claim.expires_at,
    verificationUri,
    verificationExpiresAt: attempt.expires_at,
  };
}

function parseCompletedCredential(value: unknown, expectedRegistrationId: string): AgentCredential {
  const body = record(value);
  const identity = record(body.identity);
  const refresh = record(identity.refresh_token);
  if (
    body.id !== expectedRegistrationId || (body.status !== "claimed" && body.status !== "verified") ||
    typeof identity.assertion !== "string" || !jwtPattern.test(identity.assertion) || identity.assertion.length > 16_384 ||
    !validTimestamp(identity.expires_at) || typeof refresh.value !== "string" ||
    !/^[A-Za-z0-9._~-]{20,4096}$/.test(refresh.value) || !validTimestamp(refresh.expires_at)
  ) throw new AgentRegistrationError("INVALID_RESPONSE", 200);
  return {
    registrationId: expectedRegistrationId,
    assertion: identity.assertion,
    assertionExpiresAt: identity.expires_at,
    refreshToken: refresh.value,
    refreshExpiresAt: refresh.expires_at,
  };
}

function parseRefreshedCredential(value: unknown): AgentCredential {
  const body = record(value);
  const identity = record(body.identity);
  const registrationId = body.id;
  const refresh = record(identity.refresh_token);
  if (
    typeof registrationId !== "string" || !registrationPattern.test(registrationId) ||
    typeof identity.assertion !== "string" || !jwtPattern.test(identity.assertion) || identity.assertion.length > 16_384 ||
    !validTimestamp(identity.expires_at) || typeof refresh.value !== "string" ||
    !/^[A-Za-z0-9._~-]{20,4096}$/.test(refresh.value) || !validTimestamp(refresh.expires_at)
  ) throw new AgentRegistrationError("INVALID_RESPONSE", 200);
  return {
    registrationId,
    assertion: identity.assertion,
    assertionExpiresAt: identity.expires_at,
    refreshToken: refresh.value,
    refreshExpiresAt: refresh.expires_at,
  };
}

function parseAccessToken(value: unknown): ExchangedAgentToken {
  const body = record(value);
  if (
    typeof body.access_token !== "string" || !jwtPattern.test(body.access_token) || body.access_token.length > 16_384 ||
    typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer" ||
    typeof body.expires_in !== "number" ||
    !Number.isSafeInteger(body.expires_in) || body.expires_in < 1 || body.expires_in > 3_600
  ) throw new AgentRegistrationError("INVALID_RESPONSE", 200);
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

function validVerificationUri(value: string, claimOrigin: string): string | undefined {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return undefined;
  }
  if (uri.origin !== claimOrigin || uri.username || uri.password || uri.pathname !== "/auth/agent/claim" || uri.hash) return undefined;
  const token = uri.searchParams.get("token");
  if (uri.searchParams.size !== 1 || !token || !attemptTokenPattern.test(token)) return undefined;
  return uri.toString();
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maximumResponseBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AgentRegistrationError("INVALID_RESPONSE", response.status);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
    await response.body?.cancel().catch(() => undefined);
    throw new AgentRegistrationError("INVALID_RESPONSE", response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AgentRegistrationError("INVALID_RESPONSE", response.status);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maximumResponseBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AgentRegistrationError("INVALID_RESPONSE", response.status);
    }
    chunks.push(chunk.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length).toString("utf8")) as unknown;
  } catch {
    throw new AgentRegistrationError("INVALID_RESPONSE", response.status);
  }
}

function classify(status: number, phase: RequestPhase): AgentRegistrationFailureCode {
  if (status === 401 || status === 403) return "DENIED";
  if (status === 409) return "REPLAYED";
  if (status === 400 || status === 404 || status === 410 || status === 422) {
    return phase === "register" ? "INVALID_INPUT" : "EXPIRED";
  }
  return status >= 500 || status === 429 ? "DEPENDENCY" : "INVALID_RESPONSE";
}

function canonicalEmail(value: string): string | undefined {
  const email = value.trim().toLowerCase();
  return email.length >= 3 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentRegistrationError("INVALID_RESPONSE", 200);
  }
  return value as Readonly<Record<string, unknown>>;
}
