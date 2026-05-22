import { createStore } from '../../../apps/api/src/store.js';
import { createSignalForgeApi } from '../../../apps/api/src/index.js';
import { DelegationKind } from '../../core/src/index.js';

export function createSignalForgeMcpServer({ store = createStore(), logger = console } = {}) {
  const { handleRequest } = createSignalForgeApi({ store, logger });

  async function listCases(input = {}) {
    const response = await handleRequest({ method: 'GET', url: '/cases', body: {} });
    const items = response.body?.items ?? [];
    const limit = Number.isFinite(Number(input.limit)) ? Number(input.limit) : items.length;
    return {
      items: items.slice(0, limit).map((item) => ({
        id: item.id,
        title: item.canonicalTitle,
        status: item.status,
        type: item.classification?.primaryType,
        priority: item.decisionReadiness?.suggestedPriority,
      })),
    };
  }

  async function getCaseContext(input = {}) {
    if (!input.caseId) {
      throw new Error('caseId is required');
    }
    const response = await handleRequest({
      method: 'GET',
      url: `/cases/${input.caseId}/context`,
      body: {},
    });
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.body;
  }

  async function delegateCase(input = {}) {
    if (!input.caseId) {
      throw new Error('caseId is required');
    }
    const response = await handleRequest({
      method: 'POST',
      url: '/delegations',
      body: {
        caseId: input.caseId,
        kind: input.kind ?? DelegationKind.skill,
        target: input.target ?? {
          type: input.kind ?? DelegationKind.skill,
          name: input.targetName ?? 'default',
        },
        request: {
          reason: input.reason ?? 'agent_requested',
          context: input.context ?? {},
        },
      },
    });
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.body;
  }

  const tools = {
    list_cases: listCases,
    get_case_context: getCaseContext,
    delegate_case: delegateCase,
  };

  return {
    tools,
    async callTool(name, input = {}) {
      const tool = tools[name];
      if (!tool) {
        throw new Error(`unknown tool: ${name}`);
      }
      return tool(input);
    },
  };
}

export const signalforgeMcpServer = true;
