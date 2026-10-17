import { type RunReceipt, type VenkatApi } from "./api.js";

const RUN_EVENTS_V2 = "application/vnd.venkat.run-events.v2+json";

interface EvidenceArtifact {
  readonly evidence_id: string;
  readonly type: string;
  readonly media_type: string;
  readonly byte_size: number;
  readonly captured_at: string;
}

interface EvidenceRef {
  readonly evidence_id: string;
  readonly kind: string;
  readonly relation: string;
}

interface StepResult {
  readonly step_id: string;
  readonly index: number;
  readonly type: string;
  readonly instruction: string;
  readonly result: string;
  readonly failure_reason?: string;
  readonly assertion_message?: string;
  readonly evidence: readonly EvidenceLink[];
}

interface EvidenceLink {
  readonly evidence_id: string;
  readonly type: string;
  readonly relation?: string;
  readonly media_type?: string;
  readonly evidence_url: string;
  readonly download_command: string;
}

export interface RunFailure {
  readonly step_number?: number;
  readonly step_type?: string;
  readonly instruction?: string;
  readonly reason: string;
  readonly evidence_url: string;
  readonly details_available: boolean;
  readonly evidence_available: boolean;
}

export interface RunEvidenceReport {
  readonly run_id: string;
  readonly status: string;
  readonly evidence_url: string;
  readonly steps: readonly StepResult[];
  readonly artifacts: readonly (EvidenceArtifact & {
    readonly evidence_url: string;
    readonly download_command: string;
  })[];
  readonly diagnostics: {
    readonly step_results: "available" | "unavailable";
    readonly evidence_catalog: "available" | "unavailable";
  };
}

export async function runEvidenceReport(api: VenkatApi, runId: string): Promise<RunEvidenceReport> {
  const [catalog, run, ledger] = await Promise.all([
    api.operation(`/v1/runs/${encodeURIComponent(runId)}/evidence`),
    api.get(runId),
    readLedger(api, runId).catch(() => undefined),
  ]);
  const evidence = evidenceArtifacts(catalog);
  return buildReport(run, evidence, ledger?.events);
}

export async function addFailureDiagnostics(
  api: VenkatApi,
  run: RunReceipt,
): Promise<RunReceipt & { readonly failure: RunFailure }> {
  const [catalogResult, ledgerResult] = await Promise.allSettled([
    api.operation(`/v1/runs/${encodeURIComponent(run.id)}/evidence`),
    readLedger(api, run.id),
  ]);
  const evidence = catalogResult.status === "fulfilled" ? evidenceArtifacts(catalogResult.value) : [];
  const events = ledgerResult.status === "fulfilled" ? ledgerResult.value.events : undefined;
  const report = buildReport(run, evidence, events, catalogResult.status === "fulfilled");
  const failed = report.steps.find((step) => step.result === "FAILED" || step.result === "ERROR");
  return {
    ...run,
    failure: {
      ...(failed ? {
        step_number: failed.index,
        step_type: failed.type,
        instruction: failed.instruction,
      } : {}),
      reason: failed?.failure_reason
        ?? failed?.assertion_message
        ?? sanitizeText(run.outcome_summary ?? `Run ended with ${run.status}`),
      evidence_url: run.run_url,
      details_available: Boolean(failed),
      evidence_available: catalogResult.status === "fulfilled" && evidence.length > 0,
    },
  };
}

export function failureLine(run: RunReceipt & { readonly failure: RunFailure }): string {
  const { failure } = run;
  const prefix = failure.step_number === undefined
    ? `Run ${run.status}`
    : `Step ${failure.step_number} ${run.status}${failure.instruction ? `: ${failure.instruction}` : ""}`;
  return `${prefix} — ${failure.reason} — ${failure.evidence_url}`;
}

export function evidenceText(report: RunEvidenceReport): string {
  const lines = [`Run ${report.run_id} ${report.status}`, `Evidence: ${report.evidence_url}`];
  if (report.steps.length === 0) lines.push("No per-step results are available from the API.");
  for (const step of report.steps) {
    lines.push(`${step.index}. [${step.result}] ${step.type} ${step.instruction}${step.failure_reason ? ` — ${step.failure_reason}` : ""}`);
    for (const artifact of step.evidence) {
      lines.push(`   ${artifact.type}: ${artifact.evidence_id} (${artifact.download_command})`);
    }
  }
  for (const artifact of report.artifacts.filter((item) =>
    !report.steps.some((step) => step.evidence.some((link) => link.evidence_id === item.evidence_id)))) {
    lines.push(`Artifact ${artifact.type}: ${artifact.evidence_id} (${artifact.download_command})`);
  }
  return lines.join("\n");
}

async function readLedger(api: VenkatApi, runId: string) {
  const events: Record<string, unknown>[] = [];
  let after = 0;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const value = await api.operation(
      `/v1/runs/${encodeURIComponent(runId)}/events?after=${after}&limit=500`,
      "GET", undefined, undefined, undefined, RUN_EVENTS_V2,
    );
    const page = object(value);
    if (page.schema_version !== "run-event-page.v2" || page.run_id !== runId || !Array.isArray(page.events)) {
      throw new Error("QA.army returned an invalid Run event ledger");
    }
    events.push(...page.events.map(object));
    if (page.has_more === false) return { events };
    if (!Number.isSafeInteger(page.next_after) || Number(page.next_after) <= after) {
      throw new Error("QA.army returned an invalid Run event cursor");
    }
    after = Number(page.next_after);
  }
  throw new Error("QA.army Run event ledger exceeded the pagination limit");
}

function buildReport(
  run: RunReceipt,
  evidence: readonly EvidenceArtifact[],
  events?: readonly Record<string, unknown>[],
  catalogAvailable = true,
): RunEvidenceReport {
  const artifacts = evidence.map((artifact) => ({
    ...artifact,
    evidence_url: run.run_url,
    download_command: downloadCommand(artifact.evidence_id),
  }));
  return {
    run_id: run.id,
    status: run.status,
    evidence_url: run.run_url,
    steps: events ? stepResults(events, evidence, run.run_url) : [],
    artifacts,
    diagnostics: {
      step_results: events ? "available" : "unavailable",
      evidence_catalog: catalogAvailable ? "available" : "unavailable",
    },
  };
}

function stepResults(
  events: readonly Record<string, unknown>[],
  artifacts: readonly EvidenceArtifact[],
  evidenceUrl: string,
): readonly StepResult[] {
  const steps = new Map<string, {
    step_id: string;
    index: number;
    type: string;
    instruction: string;
    result: string;
    failure_reason?: string;
    assertion_message?: string;
    refs: EvidenceRef[];
    sensitive: boolean;
  }>();
  for (const event of events) {
    const correlation = optionalObject(event.correlation);
    const stepId = typeof correlation?.step_id === "string" ? correlation.step_id : undefined;
    if (event.kind === "step.state") {
      const payload = optionalObject(event.safe_payload);
      const snapshot = optionalObject(payload?.step);
      if (!stepId || !snapshot || !Number.isSafeInteger(snapshot.position)
        || typeof snapshot.type !== "string" || typeof snapshot.title !== "string") continue;
      const sensitive = sensitiveInstruction(snapshot.title);
      const current = steps.get(stepId);
      const summary = safeDetail(payload?.summary, sensitive);
      steps.set(stepId, {
        step_id: stepId,
        index: Number(snapshot.position) + 1,
        type: snapshot.type,
        instruction: sanitizeInstruction(snapshot.title),
        result: typeof event.outcome === "string" ? event.outcome : current?.result ?? "RUNNING",
        ...(event.outcome === "FAILED" || event.outcome === "ERROR"
          ? { failure_reason: summary ?? safeDetail(payload?.reason_code, sensitive) }
          : current?.failure_reason ? { failure_reason: current.failure_reason } : {}),
        ...(current?.assertion_message ? { assertion_message: current.assertion_message } : {}),
        refs: [...(current?.refs ?? []), ...eventRefs(event)],
        sensitive,
      });
      continue;
    }
    if (event.kind === "assertion" && stepId) {
      const current = steps.get(stepId);
      if (!current) continue;
      const payload = optionalObject(event.safe_payload);
      const message = safeDetail(payload?.summary, current.sensitive);
      const failureReason = assertionReason(payload, current.sensitive) ?? message ?? current.failure_reason;
      steps.set(stepId, {
        ...current,
        ...(message ? { assertion_message: message } : {}),
        ...(event.outcome === "FAILED" || event.outcome === "ERROR"
          ? failureReason ? { failure_reason: failureReason } : {}
          : {}),
        refs: [...current.refs, ...eventRefs(event)],
      });
      continue;
    }
    if (stepId && steps.has(stepId)) {
      const current = steps.get(stepId)!;
      steps.set(stepId, { ...current, refs: [...current.refs, ...eventRefs(event)] });
    }
  }
  const byId = new Map(artifacts.map((artifact) => [artifact.evidence_id, artifact]));
  return [...steps.values()].sort((left, right) => left.index - right.index).map((step) => ({
    step_id: step.step_id,
    index: step.index,
    type: step.type,
    instruction: step.instruction,
    result: step.result,
    ...(step.failure_reason ? { failure_reason: step.failure_reason } : {}),
    ...(step.assertion_message ? { assertion_message: step.assertion_message } : {}),
    evidence: uniqueRefs(step.refs).map((ref) => {
      const artifact = byId.get(ref.evidence_id);
      return {
        evidence_id: ref.evidence_id,
        type: ref.kind,
        relation: ref.relation,
        ...(artifact ? { media_type: artifact.media_type } : {}),
        evidence_url: evidenceUrl,
        download_command: downloadCommand(ref.evidence_id),
      };
    }),
  }));
}

function assertionReason(payload: Record<string, unknown> | undefined, sensitive: boolean): string | undefined {
  if (sensitive) return "[REDACTED sensitive step detail]";
  const expectation = safeDetail(payload?.expectation, false);
  const actual = safeDetail(payload?.actual_summary, false);
  if (expectation && actual) return `Expected ${expectation}; observed ${actual}`;
  return safeDetail(payload?.reason_code, false);
}

function evidenceArtifacts(value: unknown): readonly EvidenceArtifact[] {
  const body = object(value);
  if (!Array.isArray(body.evidence)) throw new Error("QA.army returned an invalid evidence catalog");
  return body.evidence.map((item) => {
    const artifact = object(item);
    return {
      evidence_id: String(artifact.evidence_id),
      type: String(artifact.type),
      media_type: String(artifact.media_type),
      byte_size: Number(artifact.byte_size),
      captured_at: String(artifact.captured_at),
    };
  });
}

function eventRefs(event: Record<string, unknown>): EvidenceRef[] {
  if (!Array.isArray(event.evidence_refs)) return [];
  return event.evidence_refs.flatMap((value) => {
    const ref = optionalObject(value);
    return ref && typeof ref.evidence_id === "string" && typeof ref.kind === "string" && typeof ref.relation === "string"
      ? [{ evidence_id: ref.evidence_id, kind: ref.kind, relation: ref.relation }]
      : [];
  });
}

function uniqueRefs(refs: readonly EvidenceRef[]): readonly EvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.evidence_id}:${ref.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeInstruction(value: string): string {
  return sanitizeText(value)
    .replace(/\b(type|fill|enter|input)\s+("[^"]*"|'[^']*'|[^\s,;]+)(?=\s+(?:into|in|for|to)\b)/gi, "$1 [REDACTED]");
}

function sanitizeText(value: string): string {
  return value.replace(
    /\b(password|passcode|secret|token|api[-_ ]?key)(\s*(?:is|=|:)?\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1$2[REDACTED]",
  );
}

function sensitiveInstruction(value: string): boolean {
  return /\b(password|passcode|secret|token|api[-_ ]?key|credential)\b/i.test(value);
}

function safeDetail(value: unknown, sensitive: boolean): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return sensitive ? "[REDACTED sensitive step detail]" : sanitizeText(value);
}

function downloadCommand(evidenceId: string): string {
  return `qa-army evidence download --evidence ${evidenceId} --output <new-file>`;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("QA.army returned invalid Run evidence");
  }
  return value as Record<string, unknown>;
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
