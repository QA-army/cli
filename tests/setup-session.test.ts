import {describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SetupSessionClient,NativeSetupCredentialStore,runInstantSetup,type SetupCredentialStore} from '../src/setup-session.js';
const proof=`qas_${'a'.repeat(32)}.${'b'.repeat(64)}`;
const receipt={id:`set_${'a'.repeat(32)}`,state:'READY',workspace_id:`wsp_${'c'.repeat(32)}`,project_id:`prj_${'d'.repeat(32)}`,
  inbox_email:'example.com-qa@qa.army',expires_at:'2099-01-01T00:00:00Z',blocker:null,run_id:null};
const store=():SetupCredentialStore=>({get:vi.fn().mockResolvedValue(proof),set:vi.fn().mockResolvedValue(undefined)});
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
describe('opt-in setup session',()=>{
 it('persists recovery proof before the first network mutation',async()=>{
   const saved=store();vi.mocked(saved.get).mockResolvedValue(undefined);let persisted='';vi.mocked(saved.set).mockImplementation(async p=>{persisted=p;});
   const request=vi.fn(async(_url:unknown,init?:RequestInit)=>{expect(persisted).toMatch(/^qas_/);expect((init?.headers as Record<string,string>).authorization).toBe(`Bearer ${persisted}`);
     return response({setup:{...receipt,id:`set_${persisted.slice(4,36)}`}});});
   await new SetupSessionClient('https://api.qa.army',saved,request as typeof fetch).prepare('https://example.com','Example');
 });
 it('makes no request if the native store fails',async()=>{
   const saved=store();vi.mocked(saved.get).mockRejectedValue(new Error('locked'));const request=vi.fn();
   await expect(new SetupSessionClient('https://api.qa.army',saved,request).prepare('https://example.com','Example')).rejects.toThrow('locked');expect(request).not.toHaveBeenCalled();
 });
 it('recovers the same identity after a lost response and does not automatically repeat POST',async()=>{
   const saved=store();const request=vi.fn().mockRejectedValueOnce(new Error('reset')).mockResolvedValue(response({setup:receipt}));
   const client=new SetupSessionClient('https://api.qa.army',saved,request);
   await expect(client.prepare('https://example.com','Example')).rejects.toThrow('interrupted');expect(request).toHaveBeenCalledTimes(1);
   expect((await client.status()).id).toBe(receipt.id);expect(request.mock.calls[1]?.[1].method).toBe('GET');expect(saved.set).not.toHaveBeenCalled();
 });
 it('never follows redirects with setup credentials',async()=>{
   const request=vi.fn().mockResolvedValue(response({setup:receipt}));await new SetupSessionClient('https://api.qa.army',store(),request).status();
   expect(request.mock.calls[0]?.[1].redirect).toBe('error');
   expect(()=>new SetupSessionClient('https://attacker.example',store(),request)).toThrow('only');
 });
 it('projects only safe receipt fields',async()=>{
   const request=vi.fn().mockResolvedValue(response({setup:{...receipt,proof_hash:'SECRET',access_token:'SECRET'}}));
   expect(JSON.stringify(await new SetupSessionClient('https://api.qa.army',store(),request).status())).not.toContain('SECRET');
 });
 it('keeps WorkOS credentials separate from the setup record',async()=>{
   const entry={getPassword:vi.fn().mockResolvedValue(proof),setPassword:vi.fn(),deleteCredential:vi.fn()};
   const saved=new NativeSetupCredentialStore('https://example.com',async()=>entry);expect(await saved.get()).toBe(proof);
   await saved.set(proof);expect(entry.setPassword).toHaveBeenCalledOnce();
 });
 it('serializes concurrent credential initialization without overwriting the winner',async()=>{
   const directory=await mkdtemp(join(tmpdir(),'qa-setup-lock-'));let persisted:string|undefined;
   const entry={getPassword:vi.fn(async()=>persisted),setPassword:vi.fn(async(value:string)=>{persisted=value;}),deleteCredential:vi.fn()};
   try{
     const a=new NativeSetupCredentialStore('https://example.com',async()=>entry,directory);
     const b=new NativeSetupCredentialStore('https://example.com',async()=>entry,directory);
     const results=await Promise.allSettled([a.getOrCreate(),b.getOrCreate()]);
     expect(results.some(r=>r.status==='fulfilled')).toBe(true);expect(entry.setPassword).toHaveBeenCalledOnce();
     expect(await b.getOrCreate()).toBe(persisted);
   }finally{await rm(directory,{recursive:true,force:true});}
 });
 it('does not start a weaker Test when mail is unavailable',async()=>{
   const request=vi.fn().mockResolvedValue(response({setup:{...receipt,state:'ACTION_REQUIRED',blocker:'MAIL_UNAVAILABLE'}}));
   const emit=vi.fn();expect(await runInstantSetup(new SetupSessionClient('https://api.qa.army',store(),request),{
     appUrl:'https://example.com',projectName:'Example',test:{enabled:true,steps:[{type:'assert',enabled:true,instruction:'Expected'}]}},emit,request)).toBe(1);
   expect(request).toHaveBeenCalledTimes(1);expect(emit.mock.calls.at(-1)?.[0]).toMatchObject({setup_status:'ACTION_REQUIRED',blocker:'MAIL_UNAVAILABLE'});
 });
 it('emits the started Run before waiting, refreshes 401 once, and reuses mutation identity',async()=>{
   const runId='run_'+'e'.repeat(32),testId='tst_'+'f'.repeat(32);
   const run={id:runId,status:'QUEUED',workspace_id:receipt.workspace_id,project_id:receipt.project_id,test_id:testId,test_group_id:null,
     run_url:`https://app.qa.army/dashboard/trial/projects/${receipt.project_id}/tests/${testId}/runs/${runId}`,
     context_schema_version:1,context_hash:'sha256:'+'0'.repeat(64),resolved_at:'2026-10-05T00:00:00Z'};
   const emit=vi.fn();let first=true;const keys:string[]=[];
   const request=vi.fn(async(url:unknown,init?:RequestInit)=>{
     const path=new URL(String(url)).pathname;
     if(path==='/v1/setup-sessions')return response({setup:receipt});
     if(path.endsWith('/access'))return response({access_token:`qag_${'a'.repeat(32)}.${'b'.repeat(64)}`});
     if(path.endsWith('/tests'))return response({test:{id:testId,project_id:receipt.project_id}});
     if(path==='/v1/runs')return response({run:{...run,status:'READY'}});
     if(path.endsWith('/start')){keys.push((init?.headers as Record<string,string>)['idempotency-key']!);if(first){first=false;return response({},401);}return response({run});}
     expect(emit.mock.calls.some(([r])=>r.setup_status==='RUN_STARTED')).toBe(true);
     return response({run:{...run,status:'PASSED',outcome_summary:'Persisted state verified'}});
   });
   expect(await runInstantSetup(new SetupSessionClient('https://api.qa.army',store(),request),{
     appUrl:'https://example.com',projectName:'Example',test:{enabled:true,steps:[{type:'assert',enabled:true,instruction:'Expected'}]}},emit,request)).toBe(0);
   expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
   expect(emit.mock.calls.at(-1)?.[0]).toMatchObject({setup_status:'COMPLETED',run_id:runId,run_status:'PASSED'});
 });
 it('never claims a previous Test did not start when a recovery read is unavailable',async()=>{
   const request=vi.fn().mockResolvedValue(response({},503));
   await expect(new SetupSessionClient('https://api.qa.army',store(),request).status()).rejects.toThrow('Do not replay signup');
   expect(request).toHaveBeenCalledTimes(1);
 });
});
