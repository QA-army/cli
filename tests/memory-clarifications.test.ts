import { describe, it, expect, vi } from 'vitest';
import { runCli } from '../src/cli.js';

const project = 'prj_' + 'a'.repeat(32);
const env = { QA_ARMY_ACCESS_TOKEN: 'fixture-token' };
const answer = {
  day: '2026-10-06', question_id: 'mq_' + 'b'.repeat(32), revision: 0,
  choice: 2, skipped: false,
};
function harness(status = 200) {
  const request = vi.fn<typeof fetch>(async () => new Response(
    JSON.stringify(status === 200 ? { questions: [], answers: [] } : { error: 'stale_revision' }),
    { status },
  ));
  const io = { out: vi.fn(), error: vi.fn() };
  const submit = (input: unknown) => runCli([
    'memories', 'answer', '--project', project, '--input', JSON.stringify(input),
  ], env, io, request);
  return { request, io, submit };
}

describe('Daily memory command adapters', () => {
  it('reads a Project set and rejects invalid Project identifiers', async () => {
    const { request, io } = harness();
    expect(await runCli(['memories', 'questions', '--project', project], env, io, request)).toBe(0);
    expect(String(request.mock.calls[0]![0])).toContain(`/v1/projects/${project}/memory/clarifications`);
    expect(await runCli(['memories', 'questions', '--project', 'invalid'], env, io, request)).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['first choice', { ...answer, choice: 0 }],
    ['second choice', { ...answer, choice: 1 }],
    ['third choice', answer],
    ['skipped answer', { ...answer, choice: null, skipped: true }],
    ['correction', { ...answer, revision: 7 }],
    ['leap day', { ...answer, day: '2024-02-29' }],
    ['empty elaboration', { ...answer, elaboration: '' }],
    ['unmodified elaboration', { ...answer, elaboration: '  Preserve the cart\n雪\t  ' }],
    ['maximum elaboration', { ...answer, elaboration: 'a'.repeat(2000) }],
  ])('forwards a valid %s without rewriting it', async (_name, input) => {
    const { request, submit } = harness();
    expect(await submit(input)).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toMatch(new RegExp(`/v1/projects/${project}/memory/clarifications$`));
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it.each(['day', 'question_id', 'revision', 'choice', 'skipped'])('rejects missing %s before HTTP', async (field) => {
    const input: Record<string, unknown> = { ...answer };
    delete input[field];
    const { request, io, submit } = harness();
    expect(await submit(input)).toBe(1);
    expect(io.error).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null], ['array', []], ['primitive', 'answer'],
    ['unknown field', { ...answer, workspace_id: 'untrusted' }],
    ['numeric day', { ...answer, day: 20261006 }],
    ['day shape', { ...answer, day: '2026-1-06' }],
    ['invalid day', { ...answer, day: '2026-04-31' }],
    ['invalid leap day', { ...answer, day: '2026-02-29' }],
    ['invalid month', { ...answer, day: '2026-13-01' }],
    ['question prefix', { ...answer, question_id: 'mem_' + 'b'.repeat(32) }],
    ['question length', { ...answer, question_id: 'mq_b' }],
    ['question case', { ...answer, question_id: 'mq_' + 'B'.repeat(32) }],
    ['negative revision', { ...answer, revision: -1 }],
    ['fractional revision', { ...answer, revision: 0.5 }],
    ['string revision', { ...answer, revision: '0' }],
    ['null revision', { ...answer, revision: null }],
    ['negative choice', { ...answer, choice: -1 }],
    ['fourth choice', { ...answer, choice: 3 }],
    ['fractional choice', { ...answer, choice: 1.5 }],
    ['string choice', { ...answer, choice: '2' }],
    ['null choice without skip', { ...answer, choice: null }],
    ['choice with skip', { ...answer, skipped: true }],
    ['missing skipped choice', { day: answer.day, question_id: answer.question_id, revision: 0, skipped: true }],
    ['string skipped', { ...answer, skipped: 'false' }],
    ['null skipped', { ...answer, skipped: null }],
    ['null elaboration', { ...answer, elaboration: null }],
    ['numeric elaboration', { ...answer, elaboration: 123 }],
    ['long elaboration', { ...answer, elaboration: 'a'.repeat(2001) }],
    ['blank elaboration', { ...answer, elaboration: ' \t\n' }],
    ['control character', { ...answer, elaboration: 'cart\u0000' }],
  ])('rejects %s before HTTP', async (_name, input) => {
    const { request, io, submit } = harness();
    expect(await submit(input)).toBe(1);
    expect(io.error).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before HTTP', async () => {
    const { request, io } = harness();
    expect(await runCli(['memories', 'answer', '--project', project, '--input', '{'], env, io, request)).toBe(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('leaves revision conflict handling to the server without resubmitting', async () => {
    const { request, submit } = harness(409);
    expect(await submit({ ...answer, revision: 7 })).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body)).revision).toBe(7);
  });
});
