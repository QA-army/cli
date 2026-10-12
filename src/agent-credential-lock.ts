import { mkdir, lstat, open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Contains only an exclusive lock marker, never credentials. All native clients use it. */
export async function withAgentCredentialLock<T>(work: () => Promise<T>): Promise<T> {
  const directory = join(homedir(), '.qa-army-auth-lock');
  await mkdir(directory, {mode:0o700}).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw new Error('The native agent refresh lock is unavailable'); });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))) throw new Error('The native agent refresh lock directory must be private and owned by the current user');
  const path = join(directory, 'agent-identity.lock');
  const deadline = Date.now()+30000;
  let handle;
  while (!handle) {
    try { handle = await open(path,'wx',0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('The native agent refresh lock is unavailable');
      if (Date.now() >= deadline) throw new Error('Agent authentication is busy. Close other QA.army CLI/MCP processes and retry. If a process crashed, remove only ~/.qa-army-auth-lock/agent-identity.lock after confirming none remain.');
      await new Promise(resolve => setTimeout(resolve,100));
    }
  }
  try { return await work(); }
  finally { await handle.close(); await unlink(path); }
}
