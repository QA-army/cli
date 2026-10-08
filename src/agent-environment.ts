// SPDX-License-Identifier: MIT
export const agentEnvironments = {
  production: {
    apiOrigin: "https://api.qa.army",
    claimOrigin: "https://app.qa.army",
    issuer: "https://heavenly-experience-04.authkit.app",
    audience: "client_01M0ZCWE5WHYV84Y3M2GCQ5DCA",
    agentAccount: "agent-identity",
    profileAccount: "profile-api-key",
  },
  staging: {
    apiOrigin: "https://staging.qa.army",
    claimOrigin: "https://staging.qa.army",
    issuer: "https://flourishing-network-03-staging.authkit.app",
    audience: "client_01M0ZCWDP5Y22AEQQHHHGY8SBX",
    agentAccount: "agent-identity-staging",
    profileAccount: "profile-api-key-staging",
  },
} as const;

export type AgentEnvironment = keyof typeof agentEnvironments;

export function agentEnvironmentForApi(value: string): AgentEnvironment {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("The QA.army Product API origin is invalid"); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("The QA.army Product API origin is invalid");
  }
  for (const environment of ["production", "staging"] as const) {
    if (url.origin === agentEnvironments[environment].apiOrigin) return environment;
  }
  throw new Error("Claimed agent identities require an exact supported QA.army Product API origin");
}
