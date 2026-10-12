import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { VenkatApi } from './api.js';

export async function downloadEvidence(api: VenkatApi, evidenceId: string, destination: string) {
  const opened = await api.operation(`/v1/evidence/${evidenceId}/open`, 'POST', {}) as {
    evidence?: {evidence_id?: unknown; sha256?: unknown; byte_size?: unknown}; capability?: {url?: unknown; expires_at?: unknown};
  };
  const artifact = opened?.evidence;
  const maxBytes = 128 * 1024 * 1024;
  if (artifact?.evidence_id !== evidenceId || !/^[a-f0-9]{64}$/.test(String(artifact?.sha256))
    || !Number.isSafeInteger(artifact?.byte_size) || Number(artifact?.byte_size) < 0 || Number(artifact?.byte_size) > maxBytes) throw new Error('Evidence metadata is invalid or exceeds the 128 MiB download limit');
  let url: URL;
  try { url = new URL(String(opened.capability?.url)); } catch { throw new Error('Evidence access capability is invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || Date.parse(String(opened.capability?.expires_at)) <= Date.now()
    || !Number.isFinite(Date.parse(String(opened.capability?.expires_at)))) throw new Error('Evidence access capability is invalid or expired');
  // Open with exclusive creation before the download. Never overwrite a user's file.
  const file = await open(destination, 'wx', 0o600);
  let complete = false;
  try {
    let response: Response;
    try { response = await fetch(url, {redirect:'error',signal:AbortSignal.timeout(120000)}); }
    catch { throw new Error('Evidence download failed; request fresh access and retry'); }
    if (!response.ok || !response.body) throw new Error('Evidence download failed');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > Number(artifact.byte_size) || bytes > maxBytes) throw new Error('Evidence byte size does not match the finalized artifact');
      hash.update(chunk); await file.writeFile(chunk);
    }
    if (bytes !== artifact.byte_size || hash.digest('hex') !== artifact.sha256) throw new Error('Evidence integrity verification failed');
    complete = true;
    return {evidence_id:evidenceId,path:destination,byte_size:bytes,sha256:artifact.sha256,verified:true};
  } catch {
    throw new Error('Evidence download or integrity verification failed; no capability URL was retained');
  } finally {
    if (!complete) await file.truncate(0).catch(() => undefined);
    await file.close();
  }
}
