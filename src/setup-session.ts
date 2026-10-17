// SPDX-License-Identifier: MIT
import { createHash,randomBytes } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { QA_ARMY_CREDENTIAL_SERVICE,type NativeKeyringEntry } from './auth-store.js';
export interface SetupCredentialStore { get():Promise<string|undefined>;set(value:string):Promise<void>;getOrCreate?():Promise<string> }
export class NativeSetupCredentialStore implements SetupCredentialStore {
  constructor(private readonly appUrl:string,private readonly entry?:()=>Promise<NativeKeyringEntry>,
    private readonly lockDirectory=join(homedir(),'.qa-army','setup-locks')) {}
  private async native(){if(this.entry)return this.entry();const {AsyncEntry}=await import('@napi-rs/keyring');
    return new AsyncEntry(QA_ARMY_CREDENTIAL_SERVICE,`setup-${createHash('sha256').update(new URL(this.appUrl).href).digest('hex')}`);}
  async get(){try{const value=await (await this.native()).getPassword(AbortSignal.timeout(5000));
    if(value&&!proofPattern.test(value))throw new Error();return value??undefined;}catch{throw new Error('The native setup credential store is unavailable');}}
  async set(value:string){if(!proofPattern.test(value))throw new Error('Invalid setup credential');
    try{await(await this.native()).setPassword(value,AbortSignal.timeout(5000));}catch{throw new Error('The native setup credential store is unavailable');}}
  async getOrCreate():Promise<string>{
    const existing=await this.get();if(existing)return existing;
    // The lock contains no credential. A second CLI must not overwrite recovery
    // material while the first request may already be reserving the exact inbox.
    const directory=this.lockDirectory;await mkdir(directory,{recursive:true,mode:0o700});
    const path=join(directory,createHash('sha256').update(new URL(this.appUrl).href).digest('hex'));
    let lock;
    try{lock=await open(path,'wx',0o600);}catch{throw new Error('Setup credential initialization is already in progress or was interrupted. Read setup status before retrying; do not replace stored credentials.');}
    try{
      const raced=await this.get();if(raced)return raced;
      const value=newProof();await this.set(value);return value;
    }finally{await lock.close();await unlink(path);}
  }
}
const proofPattern=/^qas_[a-f0-9]{32}\.[a-f0-9]{64}$/;
const newProof=()=>`qas_${randomBytes(16).toString('hex')}.${randomBytes(32).toString('hex')}`;
export interface SetupSessionReceipt {
  readonly id:string;readonly state:'PREPARING'|'READY'|'ACTION_REQUIRED'|'EXPIRED'|'CLAIMED';
  readonly workspace_id:string|null;readonly project_id:string|null;readonly inbox_email:string|null;
  readonly expires_at:string;readonly blocker:string|null;readonly run_id:string|null;
}
export class SetupSessionClient {
  private proof:string|undefined;
  constructor(private readonly baseUrl:string,private readonly store:SetupCredentialStore,private readonly request:typeof fetch=fetch) {
    if(baseUrl!=='https://api.qa.army')throw new Error('Setup credentials may only be sent to https://api.qa.army');
  }
  async prepare(appUrl:string,projectName:string):Promise<SetupSessionReceipt>{
    // Persist before the first mutation. Lost responses can be reconciled without
    // minting another identity, and a locked keyring makes no network requests.
    this.proof=this.store.getOrCreate?await this.store.getOrCreate():await this.store.get();
    if(!this.proof){this.proof=newProof();await this.store.set(this.proof);}
    const value=await this.call('/v1/setup-sessions','POST',{app_url:appUrl,project_name:projectName});
    return parseReceipt(value,this.id());
  }
  async status():Promise<SetupSessionReceipt>{
    await this.load();return parseReceipt(await this.call(`/v1/setup-sessions/${this.id()}`,'GET'),this.id());
  }
  async accessToken():Promise<string>{
    await this.load();const value=await this.call(`/v1/setup-sessions/${this.id()}/access`,'POST');
    if(!value||typeof value!=='object'||!('access_token'in value)||typeof value.access_token!=='string'||!/^qag_[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value.access_token))throw new Error('Invalid setup access response');
    return value.access_token;
  }
  reexchangeAfterUnauthorized(){return this.accessToken();}
  private async load(){this.proof??=await this.store.get();if(!this.proof)throw new Error('No recoverable setup exists for this application');}
  private id(){if(!this.proof||!proofPattern.test(this.proof))throw new Error('Invalid setup credential');return `set_${this.proof.slice(4,36)}`;}
  private async call(path:string,method:'GET'|'POST',body?:unknown):Promise<unknown>{
    let response:Response;
    try{response=await this.request(`${this.baseUrl}${path}`,{method,redirect:'error',signal:AbortSignal.timeout(10_000),
      headers:{authorization:`Bearer ${this.proof}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
    catch{throw new Error('Setup response was interrupted. Run setup status for this application; do not repeat a Test or create a new setup identity.');}
    if(!response.ok){await response.body?.cancel().catch(()=>undefined);
      if([404,503].includes(response.status))throw new Error('Instant setup is unavailable. Reconcile any existing Run before continuing through qa-army auth agent-register and authenticated setup. Do not replay signup or create a replacement Run.');
      throw new Error(`Setup request failed (${response.status}); inspect the existing setup before continuing`);}
    return response.json();
  }
}
function parseReceipt(value:unknown,id:string):SetupSessionReceipt{
  if(!value||typeof value!=='object'||!('setup'in value)||!value.setup||typeof value.setup!=='object')throw new Error('Invalid setup receipt');
  const row=value.setup as Record<string,unknown>;
  if(row.id!==id||!['PREPARING','READY','ACTION_REQUIRED','EXPIRED','CLAIMED'].includes(String(row.state))||typeof row.expires_at!=='string'||!Number.isFinite(Date.parse(row.expires_at)))throw new Error('Invalid setup receipt');
  for(const [key,prefix]of [['workspace_id','wsp'],['project_id','prj'],['run_id','run']]as const){
    if(row[key]!==null&&(typeof row[key]!=='string'||!new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(row[key])))throw new Error('Invalid setup resource binding');}
  if(row.inbox_email!==null&&(typeof row.inbox_email!=='string'||!/^[-a-z0-9.]+-qa@qa\.army$/.test(row.inbox_email)))throw new Error('Invalid setup inbox');
  if(row.blocker!==null&&(typeof row.blocker!=='string'||!['ADDRESS_CONFLICT','ADDRESS_UNSUPPORTED','TARGET_UNAVAILABLE','MAIL_UNAVAILABLE','CREDENTIAL_UNAVAILABLE','ADMISSION_CLOSED','RATE_LIMITED'].includes(row.blocker)))throw new Error('Invalid setup state');
  // Explicit projection: never echo credentials accidentally included in a response.
  return {id,state:row.state as SetupSessionReceipt['state'],workspace_id:row.workspace_id as string|null,project_id:row.project_id as string|null,
    inbox_email:row.inbox_email as string|null,expires_at:row.expires_at,blocker:row.blocker as string|null,run_id:row.run_id as string|null};
}

export async function runInstantSetup(client:SetupSessionClient,input:{appUrl:string;projectName:string;test:Readonly<Record<string,unknown>>},
  emit:(receipt:unknown)=>void,request:typeof fetch=fetch,runtime={now:()=>Date.now(),sleep:(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))}) {
  const {VenkatApi}=await import('./api.js');
  if(input.test.enabled!==true||!Array.isArray(input.test.steps)||!input.test.steps.some(s=>s&&typeof s==='object'&&s.type==='assert'&&s.enabled===true))throw new Error('Setup requires an enabled authored Test with an enabled assertion');
  let setup=await client.prepare(input.appUrl,input.projectName);emit({setup_status:'PREPARING',...setup});
  const deadline=runtime.now()+30_000;
  while(setup.state==='PREPARING'&&runtime.now()<deadline){await runtime.sleep(1000);setup=await client.status();}
  if(setup.state!=='READY'||!setup.project_id){emit({setup_status:'ACTION_REQUIRED',...setup,auth_url:'https://qa.army/auth.md'});return 1;}
  emit({setup_status:'TEST_INBOX_READY',setup_id:setup.id,project_id:setup.project_id,test_inbox_email:setup.inbox_email});
  // The API refreshes this memory-only access token on 401 with identical mutation keys.
  let cached:string|undefined;
  const api=new VenkatApi('https://api.qa.army',{accessToken:async()=>cached??=await client.accessToken(),
    reexchangeAfterUnauthorized:async()=>cached=await client.reexchangeAfterUnauthorized()},request,runtime);
  let run;
  if(setup.run_id){run=await api.get(setup.run_id);}else{
    const key=(operation:string)=>createHash('sha256').update(`${operation}:${setup.id}`).digest('hex');
    const saved=await api.operation(`/v1/projects/${setup.project_id}/tests`,'POST',input.test,undefined,key('first-test')) as {test:{id:string;project_id:string}};
    if(!saved?.test||!/^tst_[a-f0-9]{32}$/.test(saved.test.id)||saved.test.project_id!==setup.project_id)throw new Error('Invalid first Test binding');
    run=await api.operation('/v1/runs','POST',{test_id:saved.test.id},undefined,key('first-run')) as import('./api.js').RunReceipt;
    run=await api.operation(`/v1/runs/${run.id}/start`,'POST',undefined,undefined,key('start-first-run')) as import('./api.js').RunReceipt;
  }
  emit({setup_status:'RUN_STARTED',setup_id:setup.id,run_id:run.id,run_status:run.status,run_url:run.run_url});
  const result=await api.wait(run.id);
  emit({setup_status:'COMPLETED',setup_id:setup.id,run_id:result.id,run_status:result.status,run_url:result.run_url,
    outcome_summary:result.outcome_summary,test_inbox_email:setup.inbox_email});
  return result.status==='PASSED'?0:1;
}
