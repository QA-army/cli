import {describe,it,expect,vi} from 'vitest';
import {runCli} from '../src/cli.js';
describe('Daily memory command adapters',()=>{
 it('reads a Project set and preserves explicit revisioned answers',async()=>{
 const request=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({questions:[],answers:[]})));
 const io={out:vi.fn(),error:vi.fn()};const env={QA_ARMY_ACCESS_TOKEN:'fixture-token'};const project='prj_'+'a'.repeat(32);
 expect(await runCli(['memories','questions','--project',project],env,io,request)).toBe(0);
 expect(String(request.mock.calls[0]![0])).toContain(`/v1/projects/${project}/memory/clarifications`);
 const answer={day:'2026-10-06',question_id:'mq_'+'b'.repeat(32),revision:0,choice:2,skipped:false,elaboration:'Preserve the cart'};
 expect(await runCli(['memories','answer','--project',project,'--input',JSON.stringify(answer)],env,io,request)).toBe(0);
 expect(JSON.parse(String(request.mock.calls[1]![1]?.body))).toEqual(answer);
 expect(await runCli(['memories','questions','--project','invalid'],env,io,request)).toBe(1);
 expect(request).toHaveBeenCalledTimes(2);
 });
});
