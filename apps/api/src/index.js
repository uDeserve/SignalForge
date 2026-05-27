import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStore } from './store.js';
import { createSubmission, createCase, createRuntimeEvent, CaseStatus, PublicationTarget, RuntimeEventSources } from '../../../packages/core/src/index.js';
import { createTriageEngine, triageRuntimeEvent } from '../../../packages/triage/src/index.js';
import { createDeepSeekSubmissionAnalyzer } from '../../../packages/triage/src/deepseek.js';
import {
  applyDecisionToCase,
  buildCaseContext,
  createPreviewGitHubPublisher,
  createDecisionRecord,
  createIssuePublication,
  parseOwnerCommand,
} from '../../../packages/github-bridge/src/index.js';
import { DelegationKind, DelegationStatus } from '../../../packages/core/src/index.js';

export function createSignalForgeApi({
  store = createStore(),
  logger = console,
  triageEngine = createTriageEngine({ logger }),
  githubPublisher = createPreviewGitHubPublisher(),
} = {}) {
  async function createCaseRecordFromSubmission(submission) {
    const triaged = await triageEngine.triageSubmission(submission, {
      requestId: `triage_${submission.id}`,
      policy: {
        publishBias: 'lenient',
        privacyMode: 'strict',
      },
    });
    const now = new Date().toISOString();
    return createCase({
      id: `case_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      status: triaged.actionable ? CaseStatus.ready_for_publish : CaseStatus.triaging,
      canonicalTitle: triaged.canonicalTitle,
      canonicalSummary: triaged.canonicalSummary,
      classification: triaged.classification,
      scoring: triaged.scoring,
      clustering: {
        fingerprint: triaged.fingerprint,
        mergedSubmissionIds: [submission.id],
        relatedCaseIds: [],
      },
      evidenceSummary: {
        submissionCount: 1,
        latestSeenAt: submission.submittedAt,
      },
      decisionReadiness: {
        actionable: triaged.actionable,
        missingInfo: [],
        suggestedRepo: 'org/repo',
        suggestedLabels: triaged.semantic?.suggestedLabels ?? ['source:user-feedback'],
        suggestedPriority: triaged.scoring.severityScore >= 0.8 ? 'p1' : 'p2',
        suggestedOwner: 'owner',
      },
      publication: {
        target: triaged.actionable ? PublicationTarget.github_issue : PublicationTarget.none,
        published: false,
      },
      links: {
        submissionIds: [submission.id],
      },
      metadata: {
        triage: triaged.semantic ?? null,
        sourceKind: 'user_feedback',
      },
    });
  }

  async function createCaseRecordFromRuntimeEvent(event) {
    const triaged = await triageEngine.triageRuntimeEvent(event, {
      requestId: `triage_${event.id}`,
      policy: {
        publishBias: 'lenient',
        privacyMode: 'strict',
      },
    });
    const now = new Date().toISOString();
    return createCase({
      id: `case_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      status: triaged.actionable ? CaseStatus.ready_for_publish : CaseStatus.triaging,
      canonicalTitle: triaged.canonicalTitle,
      canonicalSummary: triaged.canonicalSummary,
      classification: triaged.classification,
      scoring: triaged.scoring,
      clustering: {
        fingerprint: triaged.fingerprint,
        mergedSubmissionIds: [],
        relatedCaseIds: [],
      },
      evidenceSummary: {
        submissionCount: 0,
        runtimeEventCount: 1,
        latestSeenAt: event.occurredAt,
        environments: [event.environment].filter(Boolean),
        releases: [event.release].filter(Boolean),
        topErrorFingerprints: [event.fingerprint].filter(Boolean),
      },
      decisionReadiness: {
        actionable: triaged.actionable,
        missingInfo: [],
        suggestedRepo: 'org/repo',
        suggestedLabels: triaged.semantic?.suggestedLabels ?? ['source:runtime-signal'],
        suggestedPriority: triaged.scoring.severityScore >= 0.8 ? 'p1' : 'p2',
        suggestedOwner: 'owner',
      },
      publication: {
        target: triaged.actionable ? PublicationTarget.github_issue : PublicationTarget.none,
        published: false,
      },
      links: {
        submissionIds: [],
        runtimeEventIds: [event.id],
      },
      metadata: {
        triage: triaged.semantic ?? null,
        sourceKind: 'runtime_signal',
        runtimeSummary: {
          environments: [event.environment].filter(Boolean),
          releases: [event.release].filter(Boolean),
          topFingerprints: [event.fingerprint].filter(Boolean),
        },
      },
    });
  }

  function enrichCaseWithRuntimeEvent(caseRecord, event) {
    const runtimeEventIds = [...new Set([...(caseRecord.links?.runtimeEventIds ?? []), event.id])];
    const environments = [...new Set([...(caseRecord.evidenceSummary?.environments ?? []), event.environment].filter(Boolean))];
    const releases = [...new Set([...(caseRecord.evidenceSummary?.releases ?? []), event.release].filter(Boolean))];
    const topErrorFingerprints = [...new Set([...(caseRecord.evidenceSummary?.topErrorFingerprints ?? []), event.fingerprint].filter(Boolean))];

    return {
      ...caseRecord,
      updatedAt: new Date().toISOString(),
      status: caseRecord.status === CaseStatus.closed ? CaseStatus.ready_for_publish : caseRecord.status,
      links: {
        ...(caseRecord.links ?? {}),
        runtimeEventIds,
      },
      evidenceSummary: {
        ...(caseRecord.evidenceSummary ?? {}),
        latestSeenAt: event.occurredAt,
        runtimeEventCount: runtimeEventIds.length,
        environments,
        releases,
        topErrorFingerprints,
      },
      metadata: {
        ...(caseRecord.metadata ?? {}),
        runtimeSummary: {
          environments,
          releases,
          topFingerprints: topErrorFingerprints,
        },
      },
    };
  }

  function toRuntimeEventFromSentry(payload) {
    const exception = payload?.exception?.values?.[0] ?? {};
    return createRuntimeEvent({
      id: `evt_${randomUUID()}`,
      source: RuntimeEventSources.sentry,
      occurredAt: payload?.timestamp ?? new Date().toISOString(),
      environment: payload?.environment ?? 'unknown',
      release: payload?.release ?? '',
      route: payload?.request?.url ?? payload?.transaction ?? '',
      fingerprint: Array.isArray(payload?.fingerprint) ? payload.fingerprint.join('|') : '',
      error: {
        type: exception?.type ?? payload?.level ?? 'Error',
        message: exception?.value ?? payload?.message ?? 'Runtime failure detected.',
      },
      tags: payload?.tags ?? {},
      context: payload?.contexts ?? {},
      raw: payload,
    });
  }

  async function handleRequest({ method, url, body }) {
    try {
      if (method === 'GET' && url === '/health') {
        return { statusCode: 200, body: { ok: true } };
      }

      if (method === 'POST' && url === '/submissions') {
        const now = new Date().toISOString();
        const submission = createSubmission({
          id: `sub_${randomUUID()}`,
          submittedAt: now,
          source: body.source,
          reporter: body.reporter,
          appContext: body.appContext,
          content: body.content,
          evidence: body.evidence,
          privacy: body.privacy,
          raw: body.raw ?? {},
        });
        store.saveSubmission(submission);
        return { statusCode: 201, body: { submissionId: submission.id, status: 'accepted' } };
      }

      if (method === 'POST' && url === '/triage/run') {
        const submissionIds = Array.isArray(body.submissionIds) ? body.submissionIds : [];
        const caseIds = [];
        let created = 0;
        for (const submissionId of submissionIds) {
          const submission = store.getSubmission(submissionId);
          if (!submission) continue;
          const caseRecord = await createCaseRecordFromSubmission(submission);
          const storedCase = store.upsertCase(caseRecord, caseRecord.clustering.fingerprint);
          caseIds.push(storedCase.id);
          created += storedCase.id === caseRecord.id ? 1 : 0;
        }
        return { statusCode: 200, body: { caseIds, created, merged: submissionIds.length - created, ignored: 0 } };
      }

      if (method === 'POST' && url === '/runtime-events') {
        const event = createRuntimeEvent({
          id: `evt_${randomUUID()}`,
          source: body.source,
          occurredAt: body.occurredAt ?? new Date().toISOString(),
          environment: body.environment,
          release: body.release,
          route: body.route,
          fingerprint: body.fingerprint,
          error: body.error,
          tags: body.tags,
          context: body.context,
          raw: body.raw ?? {},
        });
        store.saveRuntimeEvent(event);
        const fingerprint = triageRuntimeEvent(event).fingerprint;
        const existingCase = fingerprint ? store.listCases().find((item) => item.clustering?.fingerprint === fingerprint) : null;
        const storedCase = existingCase
          ? store.upsertCase(enrichCaseWithRuntimeEvent(existingCase, event), existingCase.clustering.fingerprint)
          : store.upsertCase(await createCaseRecordFromRuntimeEvent(event), fingerprint);
        return { statusCode: 201, body: { runtimeEventId: event.id, caseId: storedCase.id } };
      }

      if (method === 'POST' && url === '/runtime-events/ingest/sentry') {
        const event = toRuntimeEventFromSentry(body ?? {});
        return handleRequest({
          method: 'POST',
          url: '/runtime-events',
          body: {
            source: event.source,
            occurredAt: event.occurredAt,
            environment: event.environment,
            release: event.release,
            route: event.route,
            fingerprint: event.fingerprint,
            error: event.error,
            tags: event.tags,
            context: event.context,
            raw: event.raw,
          },
        });
      }

      if (method === 'GET' && url === '/cases') {
        return { statusCode: 200, body: { items: store.listCases() } };
      }

      if (method === 'POST' && url === '/delegations') {
        const caseId = body?.caseId;
        const caseRecord = store.getCase(caseId);
        if (!caseRecord) {
          return { statusCode: 404, error: { code: 'not_found', message: 'case not found' } };
        }
        const now = new Date().toISOString();
        const delegation = {
          id: `del_${randomUUID()}`,
          caseId: caseRecord.id,
          createdAt: now,
          updatedAt: now,
          kind: body?.kind ?? DelegationKind.skill,
          status: body?.status ?? DelegationStatus.queued,
          target: body?.target ?? {
            type: DelegationKind.skill,
            name: body?.target?.name ?? 'default',
          },
          request: body?.request ?? {
            reason: body?.reason ?? 'owner_requested',
            context: body?.context ?? {},
          },
          result: body?.result ?? {},
        };
        store.saveDelegation(delegation);
        const nextCase = {
          ...caseRecord,
          status: body?.markCaseDelegated === false ? caseRecord.status : 'delegated',
          updatedAt: now,
          delegations: [...(caseRecord.delegations ?? []), delegation.id],
        };
        store.upsertCase(nextCase, nextCase.clustering.fingerprint);
        return { statusCode: 201, body: { delegationId: delegation.id, caseId: caseRecord.id } };
      }

      if (method === 'POST' && url?.startsWith('/cases/') && url.endsWith('/publish')) {
        const id = url.split('/')[2];
        const caseRecord = store.getCase(id);
        if (!caseRecord) {
          return { statusCode: 404, error: { code: 'not_found', message: 'case not found' } };
        }
        if (!caseRecord.decisionReadiness?.actionable || caseRecord.publication?.target === PublicationTarget.none) {
          return { statusCode: 422, error: { code: 'unprocessable', message: 'case is not ready for publication' } };
        }
        const payload = body?.target ?? {};
        const published = await githubPublisher.publishCase({
          caseRecord,
          repo: payload.repo ?? caseRecord.decisionReadiness?.suggestedRepo ?? 'org/repo',
          mode: payload.mode ?? PublicationTarget.github_issue,
          publicRepo: payload.publicRepo ?? true,
        });
        const publication = createIssuePublication(caseRecord, {
          repo: published.repo,
          mode: published.mode,
          externalId: published.result.externalId,
          url: published.result.url,
          number: published.result.number,
        });
        const stored = store.savePublication({
          ...publication,
          snapshot: published.snapshot,
        });
        const nextCase = {
          ...caseRecord,
          status: CaseStatus.published,
          publication: {
            ...caseRecord.publication,
            published: true,
            target: publication.target.mode,
            primaryPublicationId: stored.id,
          },
          updatedAt: new Date().toISOString(),
        };
        store.upsertCase(nextCase, nextCase.clustering.fingerprint);
        return { statusCode: 201, body: { publicationId: stored.id, caseId: caseRecord.id, result: stored.result } };
      }

      if (method === 'POST' && url?.startsWith('/cases/') && url.endsWith('/decisions')) {
        const id = url.split('/')[2];
        const caseRecord = store.getCase(id);
        if (!caseRecord) {
          return { statusCode: 404, error: { code: 'not_found', message: 'case not found' } };
        }
        const decisionInput = body ?? {};
        const decision = decisionInput.decision ?? parseOwnerCommand(decisionInput.commentBody)?.decision;
        if (!decision) {
          return { statusCode: 422, error: { code: 'unprocessable', message: 'decision is required' } };
        }
        const parsed = parseOwnerCommand(decisionInput.commentBody ?? '');
        const record = createDecisionRecord(caseRecord.id, {
          actorId: decisionInput.actor?.id ?? 'github:owner',
          actorType: decisionInput.actor?.type ?? 'owner',
          decision,
          reason: decisionInput.reason ?? '',
          payload: decisionInput.payload ?? parsed?.payload ?? {},
        });
        store.saveDecision(record);
        const nextCase = applyDecisionToCase(caseRecord, record);
        store.upsertCase(nextCase, nextCase.clustering.fingerprint);
        return { statusCode: 201, body: { decisionId: record.id, caseId: caseRecord.id, statusAfterDecision: nextCase.status } };
      }

      if (method === 'GET' && url?.startsWith('/cases/') && url.endsWith('/publications')) {
        const id = url.split('/')[2];
        return { statusCode: 200, body: { items: store.listPublications(id) } };
      }

      if (method === 'GET' && url?.startsWith('/cases/') && url.endsWith('/decisions')) {
        const id = url.split('/')[2];
        return { statusCode: 200, body: { items: store.listDecisions(id) } };
      }

      if (method === 'GET' && url?.startsWith('/cases/') && url.endsWith('/delegations')) {
        const id = url.split('/')[2];
        return { statusCode: 200, body: { items: store.listDelegations(id) } };
      }

      if (method === 'GET' && url?.startsWith('/cases/') && url.endsWith('/context')) {
        const id = url.split('/')[2];
        const item = store.getCase(id);
        if (!item) {
          return { statusCode: 404, error: { code: 'not_found', message: 'case not found' } };
        }
        return {
          statusCode: 200,
          body: buildCaseContext(item, {
            decisions: store.listDecisions(id),
            delegations: store.listDelegations(id),
            publications: store.listPublications(id),
            runtimeEvents: store.listRuntimeEventsByIds(item.links?.runtimeEventIds ?? []),
          }),
        };
      }

      if (method === 'GET' && url?.startsWith('/cases/')) {
        const id = url.split('/')[2];
        const item = store.getCase(id);
        if (!item) {
          return { statusCode: 404, error: { code: 'not_found', message: 'case not found' } };
        }
        return { statusCode: 200, body: item };
      }

      return { statusCode: 404, error: { code: 'not_found', message: 'route not found' } };
    } catch (error) {
      logger.error?.(error);
      const statusCode = error?.message === 'Payload too large' ? 413 : 400;
      return { statusCode, error: { code: 'invalid_request', message: error.message } };
    }
  }

  const server = createServer(async (req, res) => {
    let body = {};
    if (req.method === 'POST') {
      try {
        body = await new Promise((resolve, reject) => {
          let raw = '';
          req.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > 1_000_000) {
              reject(new Error('Payload too large'));
              req.destroy();
            }
          });
          req.on('end', () => {
            if (!raw) {
              resolve({});
              return;
            }
            try {
              resolve(JSON.parse(raw));
            } catch (error) {
              reject(error);
            }
          });
          req.on('error', reject);
        });
      } catch (error) {
        res.writeHead(error?.message === 'Payload too large' ? 413 : 400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'invalid_request', message: error.message } }));
        return;
      }
    }

    const result = await handleRequest({ method: req.method, url: req.url, body });
    if (result.error) {
      res.writeHead(result.statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    res.writeHead(result.statusCode, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: result.body }));
  });

  return { server, store, handleRequest };
}

function main() {
  const port = Number(process.env.PORT || 8787);
  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY || '';
  const deepSeekBaseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const deepSeekModel = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const triageEngine = deepSeekApiKey
    ? createTriageEngine({
        logger: console,
        submissionAnalyzer: createDeepSeekSubmissionAnalyzer({
          apiKey: deepSeekApiKey,
          baseUrl: deepSeekBaseUrl,
          model: deepSeekModel,
        }),
      })
    : createTriageEngine({ logger: console });
  const { server } = createSignalForgeApi({ triageEngine, logger: console });
  server.listen(port, () => {
    console.log(`SignalForge API listening on http://localhost:${port}`);
    console.log(`SignalForge triage mode: ${deepSeekApiKey ? `llm (${deepSeekModel})` : 'heuristic fallback'}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
