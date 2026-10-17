import { createHash } from 'node:crypto';

interface Api { operation(path: string, method?: 'GET' | 'POST', body?: unknown, version?: number, key?: string): Promise<unknown> }
interface Selection { test_id: string; version: number }
export interface GroupRunInput { project_id: string; group_id: string; request_key: string; selection: Selection[] }
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid management receipt');
  return value as Record<string, unknown>;
};
export async function runGroup(api: Api, input: GroupRunInput) {
  if (!/^prj_[a-f0-9]{32}$/.test(input.project_id) || !/^tgr_[a-f0-9]{32}$/.test(input.group_id)
    || !/^[A-Za-z0-9_.:-]{8,128}$/.test(input.request_key) || !Array.isArray(input.selection)
    || input.selection.length < 1 || input.selection.length > 20 || input.selection.some(s => !s || !/^tst_[a-f0-9]{32}$/.test(s.test_id) || !Number.isSafeInteger(s.version) || s.version < 1)
    || new Set(input.selection.map(s => s.test_id)).size !== input.selection.length) throw new Error('Group Run requires Project, Group, a stable request key and 1–20 unique Test IDs with versions');
  const selected = [...input.selection].sort((a,b) => a.test_id.localeCompare(b.test_id));
  const children: Record<string, unknown>[] = [];
  const key = (test: Selection, operation: string) => `group-${createHash('sha256').update(JSON.stringify([input.project_id,input.group_id,input.request_key,test.test_id,operation])).digest('hex')}`;
  let stage = 'PREFLIGHT';
  let activeTest: string | null = null;
  try {
    const group = object(object(await api.operation(`/v1/test-groups/${input.group_id}`)).test_group);
    if (group.id !== input.group_id || group.project_id !== input.project_id) throw new Error('Group scope changed');
    for (const selectedTest of selected) {
      activeTest = selectedTest.test_id;
      const test = object(object(await api.operation(`/v1/tests/${selectedTest.test_id}`)).test);
      if (test.id !== selectedTest.test_id || test.project_id !== input.project_id || test.group_id !== input.group_id || test.enabled !== true || test.version !== selectedTest.version) throw new Error('Selected Test changed or is disabled');
    }
    for (const selectedTest of selected) {
      activeTest = selectedTest.test_id; stage = 'CREATE';
      const run = object(await api.operation('/v1/runs','POST',{test_id:selectedTest.test_id},undefined,key(selectedTest,'create')));
      const child: Record<string, unknown> = {test_id:selectedTest.test_id,test_version:selectedTest.version,run_id:run.id,status:run.status,started:false};
      children.push(child);
      stage = 'BINDING';
      if (!/^run_[a-f0-9]{32}$/.test(String(run.id)) || run.project_id !== input.project_id || run.test_group_id !== input.group_id || run.test_id !== selectedTest.test_id
        || ![2,3,4,5].includes(Number(run.context_schema_version)) || !Number.isSafeInteger(run.test_version) || run.test_version !== selectedTest.version
        || !/^sha256:[a-f0-9]{64}$/.test(String(run.context_hash))) throw new Error('Immutable Test version or scope is unavailable or changed');
      child.context_hash=run.context_hash;
      child.evidence_path=`/v1/runs/${run.id}/evidence`;
    }
    for (let index=0; index<children.length; index++) {
      const child=children[index]!; const selectedTest=selected[index]!; activeTest=selectedTest.test_id;
      if (child.status !== 'READY') { child.reused=true; continue; }
      stage='START';
      const started=object(await api.operation(`/v1/runs/${child.run_id}/start`,'POST',{},undefined,key(selectedTest,'start')));
      child.status=started.status; child.started=true;
    }
    return {status:'DISPATCHED',project_id:input.project_id,group_id:input.group_id,request_key:input.request_key,selection:selected,children,atomic:false};
  } catch {
    // Before any start, release only known READY children from this request.
    // Never cancel a child after a possibly successful start or an unknown create.
    if (stage === 'CREATE' || stage === 'BINDING') {
      for (let index=0; index<children.length; index++) {
        const child=children[index]!;
        if (child.status !== 'READY' || !/^run_[a-f0-9]{32}$/.test(String(child.run_id))) continue;
        try {
          const cancelled=object(await api.operation(`/v1/runs/${child.run_id}/cancel`,'POST',{},undefined,key(selected[index]!,'cancel')));
          child.status=cancelled.status; child.cleanup=cancelled.status === 'CANCELLED' ? 'CANCELLED_BEFORE_START' : 'REQUIRES_RECONCILIATION';
        } catch { child.cleanup='CANCELLATION_OUTCOME_UNKNOWN'; }
      }
    }
    // An uncertain mutation is never retried. Keep all known IDs so the caller can reconcile.
    return {status:'INCOMPLETE',project_id:input.project_id,group_id:input.group_id,request_key:input.request_key,selection:selected,children,atomic:false,
      stopped_at:{stage,test_id:activeTest},code:stage==='PREFLIGHT'?'SELECTION_NOT_VERIFIED':stage==='BINDING'?'IMMUTABLE_SELECTION_NOT_VERIFIED':'MUTATION_OUTCOME_REQUIRES_RECONCILIATION',
      remediation:'Inspect known Run IDs and resolve the stopped operation before retrying with the same selection and request key. Known READY children are cancelled before dispatch on preparation failure. Inspect cleanup outcomes and explicitly cancel any remaining unused READY Runs.'};
  }
}
