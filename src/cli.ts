// SPDX-License-Identifier: MIT
import { VenkatApi, type CommandRuntime } from "./api.js";
import { ExecutorInlineFunctionOnlyTransport, parseRunWebCommand, type RunWebTransport } from "./web-run-client.js";
import {
  NativeApiKeyCredentialStore,
  type ApiKeyCredentialStore,
  validApiKey,
} from "./auth-store.js";
import { WorkosAgentAuthCommand, type AgentAuthCommand } from "./agent-auth-flow.js";
import { NativeAgentCredentialStore, type AgentCredentialStore } from "./agent-auth-store.js";
import { WorkosAgentAccessTokenProvider } from "./agent-access-token.js";
import { WorkosAgentRegistrationClient, type AgentRegistrationProtocol } from "./workos-agent-registration.js";
import { setupProject } from "./setup.js";

export const QA_ARMY_CLI_VERSION = "0.2.8";
export const QA_ARMY_API_ORIGIN = "https://api.qa.army";
export const CAPABILITY_REQUEST_EXIT_CODE = 2;

const runWorkspace = "/workspace";
const capabilityRequestBase = "https://github.com/QA-army/cli/issues/new";

const supportedCommands = [
  "prs list", "prs get", "prs cancel", "prs rerun", "prs promote", "prs settings", "prs configure", "prs usage",
  "auth agent-register", "auth status", "auth logout", "status", "logout", "signout",
  "setup", "create test", "workspaces list", "workspaces create", "workspaces get",
  "builds list", "builds reserve", "builds complete",
  "workspaces update", "projects list", "projects create", "projects star", "projects unstar",
  "members list", "invitations create", "groups list", "groups get", "groups create",
  "groups update", "tests list", "tests get", "tests create", "tests update", "tests archive",
  "tests delete", "tests run", "runs list", "runs create", "runs get", "runs start",
  "runs watch", "runs wait", "runs cancel", "api-keys list", "api-keys create",
  "memories list", "memories create", "memories update", "memories approve", "memories reject", "memories archive", "memories delete", "memories clear", "memories settings", "memories graph", "memories summary", "memories import", "memories history",
  "api-keys revoke", "capabilities", "docs", "request capability",
] as const;

const requestedTestRunFlags = [
  "--local", "--group", "--env", "--environment", "--project-environment-id",
  "--url", "--mode", "--platform", "--device-model", "--app-id", "--headed",
  "--browser", "--output", "--parallel", "--debug", "--system-prompt-file",
] as const;

const requestedCommands = [
  "agent init", "run (local browser)", "projects get", "projects update", "projects delete",
  "projects environments", "projects environments-create", "projects environments-delete",
  "projects credentials", "projects credentials-create", "projects files", "groups delete", "groups add-test",
  "groups remove-test", "tests enable", "tests disable",
  ...requestedTestRunFlags.map((flag) => `tests run ${flag}`),
  "upload-app", "ci", "pr run-dynamic",
] as const;

const apiActions: Readonly<Record<string, readonly string[]>> = {
  prs: ["list", "get", "cancel", "rerun", "promote", "settings", "configure", "usage"],
  builds: ["list", "reserve", "complete"],
  memories: ["questions", "answer", "list", "create", "update", "approve", "reject", "archive", "delete", "clear", "settings", "graph", "summary", "import", "history"],
  workspaces: ["list", "create", "get", "update"],
  projects: ["list", "create", "star", "unstar"],
  members: ["list"],
  invitations: ["create"],
  groups: ["list", "get", "create", "update"],
  tests: ["list", "get", "create", "update", "archive", "delete", "run"],
  runs: ["list", "create", "get", "start", "watch", "wait", "cancel"],
};

export interface CliIo {
  readonly out: (value: string) => void;
  readonly error: (value: string) => void;
}

export async function runCli(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  io: CliIo,
  request: typeof fetch = fetch,
  runWeb: RunWebTransport = new ExecutorInlineFunctionOnlyTransport(),
  commandRuntime?: CommandRuntime,
  credentialStore: ApiKeyCredentialStore = new NativeApiKeyCredentialStore(),
  agentAuth?: AgentAuthCommand,
  agentCredentialStore: AgentCredentialStore = new NativeAgentCredentialStore(),
  agentProtocol: AgentRegistrationProtocol = new WorkosAgentRegistrationClient(request),
): Promise<number> {
  try {
    if (args.includes("--api-key")) {
      throw new Error("API keys must not be provided in process arguments; use WorkOS agent registration or secret injection");
    }
    if (args.length === 1 && ["-V", "--version"].includes(args[0]!)) {
      io.out(QA_ARMY_CLI_VERSION);
      return 0;
    }
    if (args[0] === "help" || args.includes("-h") || args.includes("--help")) {
      const subject = args[0] === "help" ? args.slice(1) : args.filter((value) => value !== "-h" && value !== "--help");
      io.out(helpText(subject));
      return 0;
    }

    const command = args.filter((value) => value !== "--json");
    if (command.length === 0) {
      io.out(helpText([]));
      return 0;
    }
    if (command[0] === "capabilities") {
      if (command.length !== 1) throw new Error("Usage: qa-army capabilities [--json]");
      io.out(JSON.stringify(capabilityInventory(), null, 2));
      return 0;
    }
    if (command[0] === "docs") {
      if (command.length > 2) throw new Error("Usage: qa-army docs [topic] [--json]");
      const topic = command[1] ?? "root";
      io.out(JSON.stringify({
        status: "AVAILABLE",
        topic,
        documentation_url: topic === "root" ? "https://qa.army/cli" : `https://qa.army/cli#${encodeURIComponent(topic)}`,
        help: helpText(topic === "root" ? [] : [topic]),
      }, null, 2));
      return 0;
    }
    if (command[0] === "request" && command[1] === "capability") {
      const capability = command.slice(2).join(" ").trim();
      if (!capability) throw new Error('Usage: qa-army request capability "command or feature"');
      return emitCapabilityRequest(io, capability);
    }

    const alias = rootAlias(command);
    if (alias) command.splice(0, command.length, ...alias);

    const requested = requestedCapability(command);
    if (requested) return emitCapabilityRequest(io, requested);

    if (command[0] === "web") {
      const binding = requiredRunBinding(environment);
      const result = await runWeb.execute(binding, await parseRunWebCommand(command.slice(1), runWorkspace));
      io.out(JSON.stringify(result ?? null, null, 2));
      return 0;
    }
    if (command[0] === "auth" && command.length === 1) {
      io.out(helpText(["auth"]));
      return 0;
    }
    if (command[0] === "auth" && command[1] === "status" && command.length === 2) {
      return await authenticationStatus(environment, io, credentialStore, agentCredentialStore);
    }
    if (command[0] === "auth" && command[1] === "logout" && command.length === 2) {
      const [profileApiKey, agentIdentity] = await Promise.all([
        credentialStore.delete(),
        agentCredentialStore.delete(),
      ]);
      io.out(JSON.stringify({
        removed: { profile_api_key: profileApiKey, agent_identity: agentIdentity },
        credential_stores: [credentialStore.location, agentCredentialStore.location],
      }, null, 2));
      return 0;
    }
    if (command[0] === "auth" && command[1] === "agent-register") {
      const options = readFlags(command.slice(2));
      onlyFlags(options, ["--email"]);
      const productApiBaseUrl = agentApiOrigin(apiUrl(environment));
      const authCommand = agentAuth ?? new WorkosAgentAuthCommand(undefined, undefined, undefined, undefined, request);
      const result = await authCommand.registerAndClaim({
        loginHint: required(options, "--email"),
        productApiBaseUrl,
        onAwaitingUserCode: (receipt) => io.out(JSON.stringify(receipt, null, 2)),
      });
      io.out(JSON.stringify(result, null, 2));
      return 0;
    }

    const baseUrl = apiUrl(environment);
    if (command[0] === "setup") {
      const options = readFlags(command.slice(1));
      onlyFlags(options, ["--app-url", "--project-name", "--input", "--workspace"]);
      const credential = await claimedAgentCredential(environment, baseUrl, agentCredentialStore, agentProtocol);
      const receipt = await setupProject(new VenkatApi(baseUrl, credential, request, commandRuntime), {
        appUrl: required(options, "--app-url"),
        projectName: required(options, "--project-name"),
        test: jsonObject(required(options, "--input")),
        ...(options.has("--workspace") ? { workspaceId: rawId(options, "--workspace", "wsp") } : {}),
      }, undefined, (started) => io.out(JSON.stringify(started, null, 2)));
      io.out(JSON.stringify(receipt, null, 2));
      return receipt.setup_status === "COMPLETED" && receipt.run_status === "PASSED" ? 0 : 1;
    }
    if (command[0] === "api-keys") {
      const [, action, ...flags] = command;
      if (!action) {
        io.out(helpText(["api-keys"]));
        return 0;
      }
      if (!["list", "create", "revoke"].includes(action)) {
        throw new Error(`Unknown command: api-keys ${action}`);
      }
      const token = requiredAccessToken(environment);
      const api = new VenkatApi(baseUrl, token, request, commandRuntime);
      const options = readFlags(flags);
      const result = await executeApiKeys(api, action, options, credentialStore);
      io.out(JSON.stringify(result, null, 2));
      return 0;
    }

    if (command.length === 1) {
      io.out(helpText(command));
      return 0;
    }
    if (command[0] === "create" && command[1] !== "test") {
      throw new Error(`Unknown command: ${command.slice(0, 2).join(" ")}`);
    }
    if (command[0] !== "create" && !apiActions[command[0]!]?.includes(command[1]!)) {
      throw new Error(`Unknown command: ${command.slice(0, 2).join(" ")}`);
    }

    const credential = await apiCredential(environment, baseUrl, credentialStore, agentCredentialStore, agentProtocol);
    const api = new VenkatApi(baseUrl, credential, request, commandRuntime);
    if (command[0] === "create" && command[1] === "test") {
      const options = readFlags(command.slice(2));
      onlyFlags(options, ["--project", "--input"]);
      const result = await execute(api, "tests", "create", options);
      io.out(JSON.stringify(result, null, 2));
      return 0;
    }
    if (command[0] === "tests" && command[1] === "run") {
      return executeTestRun(api, command.slice(2), io);
    }

    const [resource, action, ...flags] = command;
    if (!resource || !action) {
      io.out(helpText(resource ? [resource] : []));
      return 0;
    }
    const options = readFlags(flags);
    const result = await execute(api, resource, action, options);
    io.out(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : "QA.army CLI failed");
    return 1;
  }
}

async function authenticationStatus(
  environment: Readonly<Record<string, string | undefined>>,
  io: CliIo,
  profileStore: ApiKeyCredentialStore,
  agentStore: AgentCredentialStore,
): Promise<number> {
  if (environment.QA_ARMY_API_KEY && !validApiKey(environment.QA_ARMY_API_KEY)) {
    throw new Error("QA_ARMY_API_KEY is invalid");
  }
  const injectedAccessToken = accessToken(environment);
  const shouldReadNativeStores = !environment.QA_ARMY_API_KEY && !injectedAccessToken;
  const profileCredential = shouldReadNativeStores ? await profileStore.get() : undefined;
  const agentCredential = shouldReadNativeStores && !profileCredential ? await agentStore.get() : undefined;
  const source = environment.QA_ARMY_API_KEY
    ? "environment"
    : injectedAccessToken ? "access_token"
    : profileCredential ? "native_credential_store"
    : agentCredential ? "agent_identity" : "none";
  const location = source === "agent_identity" ? agentStore.location : profileStore.location;
  io.out(JSON.stringify({ authenticated: source !== "none", source, credential_store: location }, null, 2));
  return source === "none" ? 1 : 0;
}

async function claimedAgentCredential(
  environment: Readonly<Record<string, string | undefined>>,
  baseUrl: string,
  store: AgentCredentialStore,
  protocol: AgentRegistrationProtocol,
): Promise<string | WorkosAgentAccessTokenProvider> {
  const injected = accessToken(environment);
  if (injected) return injected;
  agentApiOrigin(baseUrl);
  const credential = await store.get();
  if (!credential) throw new Error("No claimed QA.army agent identity is available; run qa-army auth agent-register first");
  return new WorkosAgentAccessTokenProvider(store, protocol, Date.now, credential);
}

async function executeApiKeys(
  api: VenkatApi,
  action: string,
  flags: ReadonlyMap<string, string>,
  store: ApiKeyCredentialStore,
) {
  if (action === "list") {
    onlyFlags(flags, []);
    return api.operation("/v1/api-keys");
  }
  if (action === "create") {
    onlyFlags(flags, ["--input"]);
    const response = createdApiKey(await api.operation("/v1/api-keys", "POST", jsonObject(required(flags, "--input"))));
    try {
      await store.set(response.secret);
    } catch {
      try {
        await api.operation(`/v1/api-keys/${encodeURIComponent(String(response.apiKey.id))}`, "DELETE");
      } catch {
        // The native-store failure is actionable; revocation is best effort.
      }
      throw new Error("The native operating-system credential store could not save the API key");
    }
    return { api_key: response.apiKey, credential_store: store.location };
  }
  if (action === "revoke") {
    onlyFlags(flags, ["--key"]);
    const keyId = rawId(flags, "--key", "key");
    await api.operation(`/v1/api-keys/${encodeURIComponent(keyId)}`, "DELETE");
    return { revoked: true, api_key_id: keyId };
  }
  throw new Error("Unknown API-key command");
}

async function apiCredential(
  environment: Readonly<Record<string, string | undefined>>,
  baseUrl: string,
  profileStore: ApiKeyCredentialStore,
  agentStore: AgentCredentialStore,
  agentProtocol: AgentRegistrationProtocol,
): Promise<string | WorkosAgentAccessTokenProvider> {
  const override = environment.QA_ARMY_API_KEY;
  if (override) {
    if (!validApiKey(override)) throw new Error("QA_ARMY_API_KEY is invalid");
    return override;
  }
  const injected = accessToken(environment);
  if (injected) return injected;
  if (baseUrl !== QA_ARMY_API_ORIGIN) {
    throw new Error(`Native credentials may only be sent to ${QA_ARMY_API_ORIGIN}; inject a credential explicitly for an alternate API`);
  }
  const stored = await profileStore.get();
  if (stored) return stored;
  const agentCredential = await agentStore.get();
  if (agentCredential) {
    agentApiOrigin(baseUrl);
    return new WorkosAgentAccessTokenProvider(agentStore, agentProtocol, Date.now, agentCredential);
  }
  throw new Error("No QA.army credential is available; run qa-army auth agent-register first");
}

async function executeTestRun(api: VenkatApi, args: readonly string[], io: CliIo): Promise<number> {
  const requestedFlag = requestedTestRunFlag(args);
  if (requestedFlag) return emitCapabilityRequest(io, `tests run ${requestedFlag}`);

  const wait = args.includes("--wait");
  const positional = args[0]?.startsWith("--") ? undefined : args[0];
  const flagArgs = args.filter((value, index) => value !== "--wait" && value !== "--remote" && !(index === 0 && positional));
  const options = readFlags(flagArgs);
  onlyFlags(options, ["--test", "--timeout", "--interval"]);
  const testId = validateId(positional ?? required(options, "--test"), "tst", "test ID");
  const created = await api.create(testId);
  const started = await api.start(created.id);
  if (!wait) {
    io.out(JSON.stringify({ command_status: "STARTED", run: started }, null, 2));
    return 0;
  }
  const timeout = optionalDuration(options, "--timeout", 15 * 60_000, 1_000, 60 * 60_000);
  const interval = optionalDuration(options, "--interval", 1_000, 100, 30_000);
  const terminal = await api.wait(started.id, timeout, interval);
  io.out(JSON.stringify({ command_status: "COMPLETED", run: terminal }, null, 2));
  return terminal.status === "PASSED" ? 0 : 1;
}

async function execute(api: VenkatApi, resource: string, action: string, flags: ReadonlyMap<string, string>) {
  const input = () => jsonObject(required(flags, "--input"));
  const version = () => positiveInteger(required(flags, "--version"), "--version");
  if(resource==='prs'){
    if(action==='list'){onlyFlags(flags,['--project']);return api.operation(`/v1/projects/${id(flags,'--project','prj')}/pr-verifications`);}
    if(action==='usage'){onlyFlags(flags,['--workspace']);return api.operation(`/v1/workspaces/${id(flags,'--workspace','wsp')}/pr-usage`);}
    if(action==='settings'){onlyFlags(flags,['--integration']);return api.operation(`/v1/integrations/${id(flags,'--integration','int')}/dynamic-tests`);}
    if(action==='get'){onlyFlags(flags,['--verification']);return api.operation(`/v1/pr-verifications/${id(flags,'--verification','prv')}`);}
    onlyFlags(flags,action==='configure'?['--integration','--input','--request-key']:action==='promote'?['--verification','--test','--group','--request-key']:['--verification','--request-key']);
    const key=required(flags,'--request-key');if(!/^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new Error('--request-key must be 8-128 safe characters');
    if(action==='configure')return api.operation(`/v1/integrations/${id(flags,'--integration','int')}/dynamic-tests`,'PUT',input(),undefined,key);
    return api.operation(`/v1/pr-verifications/${id(flags,'--verification','prv')}/${action}`,'POST',action==='promote'?{test_id:id(flags,'--test','tst'),group_id:id(flags,'--group','tgr')}:{},undefined,key);
  }
  if(resource==='memories'){
    const path=`/v1/projects/${id(flags,'--project','prj')}/memory`;
    if(action==='questions'){onlyFlags(flags,['--project','--day']);const day=flags.get('--day');if(day&&!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new Error('--day must use YYYY-MM-DD');return api.operation(path+'/clarifications'+(day?'/'+day:''));}
    if(action==='answer'){onlyFlags(flags,['--project','--input']);return api.operation(path+'/clarifications','POST',input());}
    if(['list','graph','summary'].includes(action)){onlyFlags(flags,['--project']);return api.operation(path+(action==='list'?'':`/${action}`));}
    if(action==='clear'){onlyFlags(flags,['--project']);return api.operation(path,'DELETE');}
    if(action==='history'){onlyFlags(flags,['--project']);return api.operation(path+'/history','POST',{});}
    if(['create','import','settings'].includes(action)){onlyFlags(flags,['--project','--input']);return api.operation(path+(action==='create'?'':action==='import'?'/imports':'/settings'),action==='settings'?'PATCH':'POST',input());}
    onlyFlags(flags,['--project','--memory','--version',...(action==='update'?['--input']:[])]);
    const recordPath=path+`/${id(flags,'--memory','mem')}`;
    return api.operation(recordPath,action==='update'?'PATCH':'POST',action==='update'?{...input(),revision:version()}:{revision:version(),decision:action==='approve'?'APPROVED':action==='reject'?'REJECTED':'ARCHIVED'});
  }
  switch (`${resource}.${action}`) {
    case "builds.list": onlyFlags(flags, ["--project"]); return api.operation(`/v1/projects/${id(flags, "--project", "prj")}/builds`);
    case "builds.reserve": {
      onlyFlags(flags, ["--project", "--input", "--request-key"]);
      const key = required(flags, "--request-key");
      if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) throw new Error("--request-key must be 8-128 safe characters");
      return api.operation(`/v1/projects/${id(flags, "--project", "prj")}/builds`, "POST", input(), undefined, key);
    }
    case "builds.complete": onlyFlags(flags, ["--build"]); return api.operation(`/v1/builds/${id(flags, "--build", "nbd")}/complete`, "POST", {});
    case "workspaces.list": onlyFlags(flags, []); return api.operation("/v1/workspaces");
    case "workspaces.create": onlyFlags(flags, ["--input"]); return api.operation("/v1/workspaces", "POST", input());
    case "workspaces.get": onlyFlags(flags, ["--workspace"]); return api.operation(`/v1/workspaces/${id(flags, "--workspace", "wsp")}`);
    case "workspaces.update": onlyFlags(flags, ["--workspace", "--input"]); return api.operation(`/v1/workspaces/${id(flags, "--workspace", "wsp")}`, "PATCH", input());
    case "projects.list": onlyFlags(flags, ["--workspace"]); return api.operation(`/v1/workspaces/${id(flags, "--workspace", "wsp")}/projects`);
    case "projects.create": onlyFlags(flags, ["--workspace", "--input"]); return api.operation(`/v1/workspaces/${id(flags, "--workspace", "wsp")}/projects`, "POST", input());
    case "projects.star": onlyFlags(flags, ["--project"]); return api.operation(`/v1/projects/${id(flags, "--project", "prj")}/star`, "PUT");
    case "projects.unstar": onlyFlags(flags, ["--project"]); return api.operation(`/v1/projects/${id(flags, "--project", "prj")}/star`, "DELETE");
    case "members.list": onlyFlags(flags, ["--workspace"]); return api.operation(`/v1/workspaces/${id(flags, "--workspace", "wsp")}/members`);
    case "invitations.create": onlyFlags(flags, ["--workspace", "--input"]); return api.operation(`/v1/workspaces/${id(flags, "--workspace", "wsp")}/invitations`, "POST", input());
    case "groups.list": onlyFlags(flags, ["--project"]); return api.operation(`/v1/projects/${id(flags, "--project", "prj")}/test-groups`);
    case "groups.create": onlyFlags(flags, ["--project", "--input"]); return api.operation(`/v1/projects/${id(flags, "--project", "prj")}/test-groups`, "POST", input());
    case "groups.get": onlyFlags(flags, ["--group"]); return api.operation(`/v1/test-groups/${id(flags, "--group", "tgr")}`);
    case "groups.update": onlyFlags(flags, ["--group", "--version", "--input"]); return api.operation(`/v1/test-groups/${id(flags, "--group", "tgr")}`, "PATCH", input(), version());
    case "tests.list": onlyFlags(flags, ["--project"]); return api.operation(`/v1/projects/${id(flags, "--project", "prj")}/tests`);
    case "tests.create": onlyFlags(flags, ["--project", "--input"]); return api.operation(`/v1/projects/${id(flags, "--project", "prj")}/tests`, "POST", input());
    case "tests.get": onlyFlags(flags, ["--test"]); return api.operation(`/v1/tests/${id(flags, "--test", "tst")}`);
    case "tests.update": onlyFlags(flags, ["--test", "--version", "--input"]); return api.operation(`/v1/tests/${id(flags, "--test", "tst")}`, "PUT", input(), version());
    case "tests.archive": onlyFlags(flags, ["--test", "--version"]); await api.operation(`/v1/tests/${id(flags, "--test", "tst")}`, "DELETE", undefined, version()); return { archived: true };
    case "tests.delete": {
      onlyFlags(flags, ["--test"]);
      const testId = id(flags, "--test", "tst");
      const detail = record(await api.operation(`/v1/tests/${testId}`), "QA.army returned an invalid Test");
      const test = record(detail.test, "QA.army returned an invalid Test");
      const currentVersion = test.version;
      if (!Number.isSafeInteger(currentVersion) || Number(currentVersion) < 1) throw new Error("QA.army returned an invalid Test");
      await api.operation(`/v1/tests/${testId}`, "DELETE", undefined, Number(currentVersion));
      return { archived: true, test_id: decodeURIComponent(testId), version: currentVersion };
    }
    case "runs.list": {
      onlyFlags(flags, ["--test", "--before", "--limit"]);
      const limit = flags.has("--limit") ? positiveInteger(required(flags, "--limit"), "--limit", 50) : 20;
      return api.list(rawId(flags, "--test", "tst"), flags.get("--before"), limit);
    }
    case "runs.create": onlyFlags(flags, ["--test"]); return api.create(rawId(flags, "--test", "tst"));
    case "runs.get": onlyFlags(flags, ["--run"]); return api.get(rawId(flags, "--run", "run"));
    case "runs.start": onlyFlags(flags, ["--run"]); return api.start(rawId(flags, "--run", "run"));
    case "runs.watch": onlyFlags(flags, ["--run", "--after"]); return api.watch(rawId(flags, "--run", "run"), optionalCursor(flags));
    case "runs.wait": {
      onlyFlags(flags, ["--run", "--timeout", "--interval"]);
      return api.wait(
        rawId(flags, "--run", "run"),
        optionalDuration(flags, "--timeout", 15 * 60_000, 1_000, 60 * 60_000),
        optionalDuration(flags, "--interval", 1_000, 100, 30_000),
      );
    }
    case "runs.cancel": onlyFlags(flags, ["--run"]); return api.cancel(rawId(flags, "--run", "run"));
    default: throw new Error(`Unknown command: ${resource} ${action}`);
  }
}

function capabilityInventory() {
  return {
    cli_version: QA_ARMY_CLI_VERSION,
    status: "AVAILABLE",
    supported: supportedCommands,
    request_capability: requestedCommands,
    api_base_url: `${QA_ARMY_API_ORIGIN}/v1`,
    openapi_url: `${QA_ARMY_API_ORIGIN}/v1/openapi.json`,
  };
}

function requestedCapability(args: readonly string[]): string | undefined {
  const [resource, action] = args;
  if (!resource) return undefined;
  if (resource === "tests" && action === "run") {
    const flag = requestedTestRunFlag(args.slice(2));
    if (flag) return `tests run ${flag}`;
  }
  if (["agent", "run", "upload-app", "ci", "pr"].includes(resource)) {
    return resource === "run" ? "run (local browser)" : [resource, action].filter(Boolean).join(" ");
  }
  const missing: Record<string, readonly string[]> = {
    projects: ["get", "update", "delete", "environments", "environments-create", "environments-delete", "credentials", "credentials-create", "files"],
    groups: ["delete", "add-test", "remove-test"],
    tests: ["enable", "disable"],
  };
  if (action && missing[resource]?.includes(action)) return `${resource} ${action}`;
  return undefined;
}

function requestedTestRunFlag(args: readonly string[]): string | undefined {
  return args.find((value): value is typeof requestedTestRunFlags[number] => (
    requestedTestRunFlags.includes(value as typeof requestedTestRunFlags[number])
  ));
}

function emitCapabilityRequest(io: CliIo, capability: string): number {
  const normalized = capability.replace(/\s+/g, " ").trim().slice(0, 160);
  const title = `CLI capability: ${normalized}`;
  const query = new URLSearchParams({ template: "feature_request.yml", title });
  io.out(JSON.stringify({
    status: "REQUEST_CAPABILITY",
    capability: normalized,
    available: false,
    message: "This command is recognized but is not backed by a production QA.army API yet.",
    request_url: `${capabilityRequestBase}?${query.toString()}`,
    exit_code: CAPABILITY_REQUEST_EXIT_CODE,
  }, null, 2));
  return CAPABILITY_REQUEST_EXIT_CODE;
}

function rootAlias(args: readonly string[]): string[] | undefined {
  if (args[0] === "status") return ["auth", "status", ...args.slice(1)];
  if (args[0] === "logout" || args[0] === "signout") return ["auth", "logout", ...args.slice(1)];
  return undefined;
}

function helpText(subject: readonly string[]): string {
  const topic = subject.join(" ");
  if (topic && requestedCapability(subject)) {
    return `qa-army ${topic}\n\n[request capability] Recognized for parity, but not backed by a production QA.army API.\nRun: qa-army request capability "${topic}"`;
  }
  const detail: Record<string, string> = {
    builds: "Usage: qa-army builds <list|reserve|complete> [--project prj_...] [--input JSON --request-key KEY] [--build nbd_...]",
    prs: "Usage: qa-army prs <list|get|cancel|rerun|promote|settings|configure|usage> --project prj_... | --verification prv_... | --integration int_... | --workspace wsp_... [--input JSON] [--test tst_... --group tgr_...] [--request-key KEY]. Pilot only. Reruns may consume up to three new Runs; planning is included.",
    memories: "Usage: qa-army memories <questions|answer|list|create|update|approve|reject|archive|clear|settings|graph|summary|import|history> --project prj_... [--input JSON] [--memory mem_... --version N]",
    auth: "Usage: qa-army auth <agent-register|status|logout> [options]",
    setup: 'Usage: qa-army setup --app-url <url> --project-name <name> --input <SaveTestRequest-JSON> [--workspace wsp_...]',
    workspaces: "Usage: qa-army workspaces <list|create|get|update> [options]",
    projects: "Usage: qa-army projects <list|create|star|unstar> [options]",
    groups: "Usage: qa-army groups <list|get|create|update> [options]",
    tests: "Usage: qa-army tests <list|get|create|update|archive|delete|run> [options]",
    runs: "Usage: qa-army runs <list|create|get|start|watch|wait|cancel> [options]",
    "api-keys": "Usage: qa-army api-keys <list|create|revoke> [options]",
    capabilities: "Usage: qa-army capabilities [--json]",
    request: 'Usage: qa-army request capability "command or feature"',
  };
  if (subject[0] && detail[subject[0]]) return detail[subject[0]]!;
  return `QA.army CLI ${QA_ARMY_CLI_VERSION}\n\nUsage: qa-army [options] <command>\n\nCommands:\n  auth           WorkOS agent registration and native credential lifecycle\n  status         Show safe authentication metadata\n  setup          Create/reuse a Project and Test, then run it to completion\n  workspaces     Manage Workspaces\n  projects       List, create, star, and unstar Projects\n  groups         Manage Test Groups\n  tests          Manage durable Tests and run them remotely\n  runs           List, create, start, wait for, inspect, and cancel Runs\n  prs            Configure and inspect dynamic PR verification (assisted pilot)\n  api-keys       Manage profile API keys using an injected user token\n  capabilities   Print supported and request-capability commands\n  docs [topic]   Print agent-friendly CLI documentation metadata\n  request capability <name>\n                 Produce a stable request receipt for a missing capability\n\nOptions:\n  -V, --version  Print version\n  -h, --help     Show help\n  --json         Accepted on all commands; successful command output is JSON\n\nProduction API: ${QA_ARMY_API_ORIGIN}/v1\nDocumentation: https://qa.army/cli`;
}

function readFlags(args: readonly string[]): ReadonlyMap<string, string> {
  if (args.length % 2 !== 0) throw new Error("Every option requires a value");
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--") || result.has(name)) throw new Error("Invalid option");
    result.set(name, value);
  }
  return result;
}

function onlyFlags(flags: ReadonlyMap<string, string>, allowed: readonly string[]) {
  for (const name of flags.keys()) if (!allowed.includes(name)) throw new Error(`Unknown option: ${name}`);
}

function required(flags: ReadonlyMap<string, string>, name: string) {
  const value = flags.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function rawId(flags: ReadonlyMap<string, string>, name: string, prefix: "wsp" | "prj" | "tgr" | "tst" | "run" | "key" | "mem" | "nbd" | "prv" | "int") {
  return validateId(required(flags, name), prefix, name);
}

function id(flags: ReadonlyMap<string, string>, name: string, prefix: "wsp" | "prj" | "tgr" | "tst" | "run" | "key" | "mem" | "nbd" | "prv" | "int") {
  return encodeURIComponent(rawId(flags, name, prefix));
}

function validateId(value: string, prefix: "wsp" | "prj" | "tgr" | "tst" | "run" | "key" | "mem" | "nbd" | "prv" | "int", label: string) {
  if (!new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function positiveInteger(value: string, label: string, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`${label} is invalid`);
  return parsed;
}

function optionalDuration(
  flags: ReadonlyMap<string, string>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = flags.get(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} is invalid`);
  return parsed;
}

function optionalCursor(flags: ReadonlyMap<string, string>) {
  const raw = flags.get("--after") ?? "0";
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000_000) throw new Error("--after is invalid");
  return parsed;
}

function jsonObject(value: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { throw new Error("--input must be valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--input must be a JSON object");
  return parsed as Record<string, unknown>;
}

function createdApiKey(value: unknown): { readonly apiKey: Record<string, unknown>; readonly secret: string } {
  const payload = record(value, "QA.army returned an invalid API-key response");
  const apiKey = record(payload.api_key, "QA.army returned an invalid API-key response");
  const secret = payload.secret;
  if (
    typeof apiKey.id !== "string" || !/^key_[a-f0-9]{32}$/.test(apiKey.id)
    || typeof apiKey.name !== "string" || typeof apiKey.prefix !== "string"
    || typeof secret !== "string" || !validApiKey(secret)
  ) throw new Error("QA.army returned an invalid API-key response");
  return { apiKey, secret };
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function apiUrl(environment: Readonly<Record<string, string | undefined>>): string {
  const raw = environment.QA_ARMY_API_URL ?? environment.VENKAT_API_URL ?? QA_ARMY_API_ORIGIN;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("QA_ARMY_API_URL must be a valid HTTPS URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("QA_ARMY_API_URL must be an HTTPS origin without credentials, query, or fragment");
  }
  if (parsed.pathname === "/v1" || parsed.pathname === "/v1/") parsed.pathname = "/";
  if (parsed.pathname !== "/") throw new Error("QA_ARMY_API_URL must be an origin or end in /v1");
  return parsed.origin;
}

function agentApiOrigin(baseUrl: string): string {
  if (baseUrl !== QA_ARMY_API_ORIGIN) {
    throw new Error(`Claimed agent identities may only be sent to ${QA_ARMY_API_ORIGIN}`);
  }
  return baseUrl;
}

function accessToken(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  return environment.QA_ARMY_ACCESS_TOKEN ?? environment.VENKAT_ACCESS_TOKEN;
}

function requiredAccessToken(environment: Readonly<Record<string, string | undefined>>): string {
  const value = accessToken(environment);
  if (!value) throw new Error("QA_ARMY_ACCESS_TOKEN is required for profile API-key management");
  return value;
}

function requiredRunBinding(environment: Readonly<Record<string, string | undefined>>): string {
  const value = environment.VENKAT_RUN_BINDING;
  if (!value || !/^bnd_[a-f0-9]{32}$/.test(value)) throw new Error("Run-scoped Browser binding is unavailable");
  return value;
}
