/** Project only public finalized metadata; never forward access capabilities. */
export function evidenceMetadata(value: unknown, runId: string) {
  const body = object(value);
  if (!Array.isArray(body.evidence) || body.evidence.length > 512) throw new Error('QA.army returned an invalid evidence catalog');
  return {evidence: body.evidence.map(item => {
    const artifact=object(item);
    if (!/^evd_[a-f0-9]{32}$/.test(String(artifact.evidence_id)) || artifact.run_id !== runId
      || !Number.isSafeInteger(artifact.attempt) || Number(artifact.attempt)<1 || Number(artifact.attempt)>100
      || !['state_trace','console','network','command_journal','screenshot','replay','manifest'].includes(String(artifact.type))
      || typeof artifact.media_type !== 'string' || artifact.media_type.length<1 || artifact.media_type.length>200
      || !/^[a-f0-9]{64}$/.test(String(artifact.sha256)) || !Number.isSafeInteger(artifact.byte_size) || Number(artifact.byte_size)<0
      || typeof artifact.captured_at !== 'string' || !Number.isFinite(Date.parse(artifact.captured_at))
      || (artifact.type === 'replay' ? !Number.isSafeInteger(artifact.replay_part) || Number(artifact.replay_part)<1 || Number(artifact.replay_part)>128 || !['video/mp4','video/webm'].includes(artifact.media_type) : artifact.replay_part !== null)) throw new Error('QA.army returned invalid evidence metadata');
    return {evidence_id:artifact.evidence_id,run_id:artifact.run_id,attempt:artifact.attempt,replay_part:artifact.replay_part,type:artifact.type,media_type:artifact.media_type,sha256:artifact.sha256,byte_size:artifact.byte_size,captured_at:artifact.captured_at};
  })};
}
function object(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('QA.army returned invalid evidence metadata');
  return value as Record<string,unknown>;
}
