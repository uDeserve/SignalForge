import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../../apps/api/src/store.js';
import { createSignalForgeApi } from '../../../apps/api/src/index.js';
import { createSignalForgeMcpServer } from '../src/index.js';

async function seedCase() {
  const store = createStore(':memory:');
  const { handleRequest } = createSignalForgeApi({ store, logger: { error() {} } });
  const submissionResponse = await handleRequest({
    method: 'POST',
    url: '/submissions',
    body: {
      source: 'web_widget',
      content: {
        title: 'Save freezes',
        body: 'The page hangs on save and returns 500. Contact me at demo@example.com https://secret.example.com',
      },
      evidence: { runtimeErrors: [{ message: 'timeout' }] },
    },
  });
  await handleRequest({
    method: 'POST',
    url: '/triage/run',
    body: { submissionIds: [submissionResponse.body.submissionId] },
  });
  const casesResponse = await handleRequest({ method: 'GET', url: '/cases', body: {} });
  return { store, handleRequest, caseId: casesResponse.body.items[0].id };
}

test('mcp server lists cases and fetches case context', async () => {
  const { store, caseId } = await seedCase();
  const mcp = createSignalForgeMcpServer({ store, logger: { error() {} } });
  const cases = await mcp.callTool('list_cases', { limit: 10 });
  assert.equal(cases.items.length, 1);
  assert.equal(cases.items[0].id, caseId);

  const context = await mcp.callTool('get_case_context', { caseId });
  assert.equal(context.case.id, caseId);
  assert.deepEqual(context.delegations, []);
});

test('mcp server creates delegation records through api semantics', async () => {
  const { store, caseId } = await seedCase();
  const mcp = createSignalForgeMcpServer({ store, logger: { error() {} } });
  const delegated = await mcp.callTool('delegate_case', {
    caseId,
    kind: 'skill',
    targetName: 'hermes',
    reason: 'owner_requested',
  });
  assert.equal(delegated.caseId, caseId);

  const context = await mcp.callTool('get_case_context', { caseId });
  assert.equal(context.delegations.length, 1);
  assert.equal(context.case.status, 'delegated');
});
