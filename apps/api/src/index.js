import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStore } from './store.js';
import {
  createSubmission,
  createCase,
  createRuntimeEvent,
  CaseStatus,
  PublicationTarget,
  RuntimeEventSources,
  CaseType,
} from '../../../packages/core/src/index.js';
import {
  createTriageEngine,
  synthesizeSubmissionCase,
} from '../../../packages/triage/src/index.js';
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

const DEFAULT_POLICY = Object.freeze({
  publishBias: 'lenient',
  privacyMode: 'strict',
});

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function dedupe(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function parseCasesQuery(url) {
  const target = new URL(url, 'http://signalforge.local');
  const publishedParam = target.searchParams.get('published');
  return {
    status: target.searchParams.get('status') ?? '',
    sourceKind: target.searchParams.get('sourceKind') ?? '',
    published:
      publishedParam === 'true' ? true : publishedParam === 'false' ? false : undefined,
  };
}

function buildExistingClusterHints(cases = []) {
  return cases.map((caseRecord) => ({
    caseId: caseRecord.id,
    clusterKey: caseRecord.clustering?.fingerprint ?? '',
    canonicalSummary: caseRecord.canonicalSummary,
    submissionCount: caseRecord.evidenceSummary?.submissionCount ?? 0,
    runtimeEventCount: caseRecord.evidenceSummary?.runtimeEventCount ?? 0,
    sourceKind: caseRecord.metadata?.sourceKind ?? '',
  }));
}

function computePublishPolicy(caseRecord) {
  if (!caseRecord.decisionReadiness?.actionable) return 'hold_and_watch';
  if (caseRecord.publication?.target !== PublicationTarget.github_issue) return 'hold_and_watch';
  if (caseRecord.publication?.published) return 'hold_and_watch';
  if (caseRecord.classification?.primaryType === CaseType.feature_request) return 'hold_and_watch';
  if ((caseRecord.evidenceSummary?.submissionCount ?? 0) >= 2) return 'publish_now';
  if ((caseRecord.evidenceSummary?.runtimeEventCount ?? 0) >= 2) return 'publish_now';
  if ((caseRecord.scoring?.severityScore ?? 0) >= 0.8) return 'publish_now';
  if ((caseRecord.metadata?.triage?.publishRecommendation ?? '') === 'publish' && (caseRecord.classification?.primaryType === CaseType.bug || caseRecord.classification?.primaryType === CaseType.ux)) {
    return 'publish_now';
  }
  return 'hold_and_watch';
}

function updateCaseAfterPolicy(caseRecord) {
  const publishPolicyOutcome = computePublishPolicy(caseRecord);
  return {
    ...caseRecord,
    decisionReadiness: {
      ...(caseRecord.decisionReadiness ?? {}),
      publishPolicyOutcome,
    },
    metadata: {
      ...(caseRecord.metadata ?? {}),
      triage: {
        ...(caseRecord.metadata?.triage ?? {}),
        publishRecommendation:
          caseRecord.metadata?.triage?.publishRecommendation ??
          (caseRecord.publication?.target === PublicationTarget.github_issue ? 'publish' : 'hold'),
      },
    },
  };
}

function buildSubmissionCaseRecord({ triaged, submission, existingCase, store }) {
  const now = new Date().toISOString();
  const submissionIds = dedupe([...(existingCase?.links?.submissionIds ?? []), submission.id]);
  const linkedSubmissions = store.listSubmissionsByIds(submissionIds);
  const synthesis = synthesizeSubmissionCase({
    submissions: linkedSubmissions,
    classification: triaged.classification,
    semantic: triaged.semantic,
  });
  const firstSeenAt = existingCase?.evidenceSummary?.firstSeenAt ?? submission.submittedAt;
  const latestSeenAt = [existingCase?.evidenceSummary?.latestSeenAt, submission.submittedAt].filter(Boolean).sort().at(-1) ?? submission.submittedAt;
  const submissionCount = submissionIds.length;
  const uniqueReporterCount = store.countUniqueReportersForSubmissionIds(submissionIds);
  const relatedCaseIds = dedupe([...(existingCase?.clustering?.relatedCaseIds ?? [])]);
  const publishTarget = triaged.actionable ? PublicationTarget.github_issue : PublicationTarget.none;
  const semanticClusterEstimate = Math.max(
    triaged.semantic?.clusterSizeEstimate ?? 1,
    existingCase?.metadata?.triage?.clusterSizeEstimate ?? 1,
    submissionCount,
  );
  const nextCase = createCase({
    id: existingCase?.id ?? `case_${randomUUID()}`,
    createdAt: existingCase?.createdAt ?? now,
    updatedAt: now,
    status:
      existingCase?.status === CaseStatus.published
        ? CaseStatus.published
        : triaged.actionable
          ? CaseStatus.ready_for_publish
          : CaseStatus.triaging,
    canonicalTitle: synthesis.title,
    canonicalSummary: synthesis.summary,
    classification: {
      ...(existingCase?.classification ?? {}),
      ...triaged.classification,
    },
    scoring: {
      ...(existingCase?.scoring ?? {}),
      ...triaged.scoring,
      duplicateConfidence: submissionCount > 1 ? Math.max(existingCase?.scoring?.duplicateConfidence ?? 0, triaged.scoring.duplicateConfidence ?? 0, 0.78) : triaged.scoring.duplicateConfidence,
    },
    clustering: {
      fingerprint: triaged.fingerprint,
      mergedSubmissionIds: submissionIds,
      relatedCaseIds,
      lastClusterAction: existingCase ? 'merge_existing' : triaged.semantic?.clusterAction ?? 'new_cluster',
    },
    evidenceSummary: {
      ...(existingCase?.evidenceSummary ?? {}),
      submissionCount,
      uniqueReporterCount,
      latestSeenAt,
      firstSeenAt,
      runtimeEventCount: existingCase?.evidenceSummary?.runtimeEventCount ?? 0,
      environments: existingCase?.evidenceSummary?.environments ?? [],
      releases: existingCase?.evidenceSummary?.releases ?? [],
      topErrorFingerprints: existingCase?.evidenceSummary?.topErrorFingerprints ?? [],
    },
    decisionReadiness: {
      actionable: triaged.actionable,
      missingInfo: existingCase?.decisionReadiness?.missingInfo ?? [],
      suggestedRepo: existingCase?.decisionReadiness?.suggestedRepo ?? 'org/repo',
      suggestedLabels: triaged.semantic?.suggestedLabels ?? existingCase?.decisionReadiness?.suggestedLabels ?? ['source:user-feedback'],
      suggestedPriority: triaged.scoring.severityScore >= 0.8 ? 'p1' : 'p2',
      suggestedOwner: existingCase?.decisionReadiness?.suggestedOwner ?? 'owner',
      publishPolicyOutcome: existingCase?.decisionReadiness?.publishPolicyOutcome ?? 'hold_and_watch',
    },
    publication: {
      ...(existingCase?.publication ?? {}),
      target: publishTarget,
      published: existingCase?.publication?.published ?? false,
      primaryPublicationId: existingCase?.publication?.primaryPublicationId,
    },
    links: {
      ...(existingCase?.links ?? {}),
      submissionIds,
      runtimeEventIds: existingCase?.links?.runtimeEventIds ?? [],
    },
    metadata: {
      ...(existingCase?.metadata ?? {}),
      sourceKind: 'user_feedback',
      triage: {
        ...(triaged.semantic ?? {}),
        clusterAction: existingCase ? 'merge_existing' : triaged.semantic?.clusterAction ?? 'new_cluster',
        clusterSizeEstimate: semanticClusterEstimate,
        publishRecommendation: triaged.semantic?.publishRecommendation ?? (publishTarget === PublicationTarget.github_issue ? 'publish' : 'hold'),
        confidence: triaged.semantic?.confidence ?? triaged.classification?.confidence ?? 0,
      },
    },
  });
  return updateCaseAfterPolicy(nextCase);
}

function createCaseRecordFromRuntimeEvent(event, triaged) {
  const now = new Date().toISOString();
  return updateCaseAfterPolicy(createCase({
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
      lastClusterAction: triaged.semantic?.clusterAction ?? 'new_cluster',
    },
    evidenceSummary: {
      submissionCount: 0,
      uniqueReporterCount: 0,
      runtimeEventCount: 1,
      firstSeenAt: event.occurredAt,
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
      publishPolicyOutcome: 'hold_and_watch',
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
  }));
}

function enrichCaseWithRuntimeEvent(caseRecord, event) {
  const runtimeEventIds = dedupe([...(caseRecord.links?.runtimeEventIds ?? []), event.id]);
  const environments = dedupe([...(caseRecord.evidenceSummary?.environments ?? []), event.environment].filter(Boolean));
  const releases = dedupe([...(caseRecord.evidenceSummary?.releases ?? []), event.release].filter(Boolean));
  const topErrorFingerprints = dedupe([...(caseRecord.evidenceSummary?.topErrorFingerprints ?? []), event.fingerprint].filter(Boolean));

  return updateCaseAfterPolicy({
    ...caseRecord,
    updatedAt: new Date().toISOString(),
    status: caseRecord.status === CaseStatus.closed ? CaseStatus.ready_for_publish : caseRecord.status,
    clustering: {
      ...(caseRecord.clustering ?? {}),
      lastClusterAction: runtimeEventIds.length > 1 ? 'merge_existing' : caseRecord.clustering?.lastClusterAction ?? 'new_cluster',
    },
    links: {
      ...(caseRecord.links ?? {}),
      runtimeEventIds,
    },
    evidenceSummary: {
      ...(caseRecord.evidenceSummary ?? {}),
      firstSeenAt: caseRecord.evidenceSummary?.firstSeenAt ?? event.occurredAt,
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
      triage: {
        ...(caseRecord.metadata?.triage ?? {}),
        clusterSizeEstimate: Math.max(caseRecord.metadata?.triage?.clusterSizeEstimate ?? 1, runtimeEventIds.length),
      },
    },
  });
}

function toInboxItem(caseRecord) {
  return {
    id: caseRecord.id,
    status: caseRecord.status,
    canonicalTitle: caseRecord.canonicalTitle,
    canonicalSummary: caseRecord.canonicalSummary,
    submissionCount: caseRecord.evidenceSummary?.submissionCount ?? 0,
    uniqueReporterCount: caseRecord.evidenceSummary?.uniqueReporterCount ?? 0,
    latestSeenAt: caseRecord.evidenceSummary?.latestSeenAt ?? caseRecord.updatedAt,
    classification: caseRecord.classification,
    publishPolicyOutcome: caseRecord.decisionReadiness?.publishPolicyOutcome ?? 'hold_and_watch',
    publication: caseRecord.publication,
    sourceKind: caseRecord.metadata?.sourceKind ?? 'user_feedback',
    clustering: caseRecord.clustering,
    decisionReadiness: caseRecord.decisionReadiness,
    evidenceSummary: caseRecord.evidenceSummary,
    metadata: caseRecord.metadata,
    updatedAt: caseRecord.updatedAt,
  };
}

export function createSignalForgeApi({
  store = createStore(),
  logger = console,
  triageEngine = createTriageEngine({ logger }),
  githubPublisher = createPreviewGitHubPublisher(),
} = {}) {
  async function maybeAutoPublish(caseRecord) {
    if (
      !caseRecord.decisionReadiness?.actionable ||
      caseRecord.publication?.target !== PublicationTarget.github_issue ||
      caseRecord.publication?.published ||
      caseRecord.decisionReadiness?.publishPolicyOutcome !== 'publish_now'
    ) {
      return caseRecord;
    }

    const published = await githubPublisher.publishCase({
      caseRecord,
      repo: caseRecord.decisionReadiness?.suggestedRepo ?? 'org/repo',
      mode: PublicationTarget.github_issue,
      publicRepo: true,
    });
    const publication = createIssuePublication(caseRecord, {
      repo: published.repo,
      mode: published.mode,
      externalId: published.result.externalId,
      url: published.result.url,
      number: published.result.number,
    });
    const storedPublication = store.savePublication({
      ...publication,
      snapshot: published.snapshot,
    });
    const nextCase = {
      ...caseRecord,
      status: CaseStatus.published,
      publication: {
        ...caseRecord.publication,
        published: true,
        target: storedPublication.target.mode,
        primaryPublicationId: storedPublication.id,
      },
      updatedAt: new Date().toISOString(),
    };
    return store.upsertCase(nextCase, nextCase.clustering.fingerprint);
  }

  async function triageAndUpsertSubmission(submission) {
    const existingClusters = buildExistingClusterHints(store.listCases());
    const triaged = await triageEngine.triageSubmission(submission, {
      requestId: `triage_${submission.id}`,
      policy: DEFAULT_POLICY,
      existingClusters,
    });
    const existingCase = store.findCaseByFingerprint(triaged.fingerprint);
    const caseRecord = buildSubmissionCaseRecord({
      triaged,
      submission,
      existingCase,
      store,
    });
    const storedCase = store.upsertCase(caseRecord, caseRecord.clustering.fingerprint);
    return maybeAutoPublish(storedCase);
  }

  async function handleRuntimeEvent(event) {
    const triaged = await triageEngine.triageRuntimeEvent(event, {
      requestId: `triage_${event.id}`,
      policy: DEFAULT_POLICY,
      existingClusters: buildExistingClusterHints(store.listCases()),
    });
    const existingCase = triaged.fingerprint ? store.findCaseByFingerprint(triaged.fingerprint) : null;
    const storedCase = existingCase
      ? store.upsertCase(enrichCaseWithRuntimeEvent(existingCase, event), existingCase.clustering.fingerprint)
      : store.upsertCase(createCaseRecordFromRuntimeEvent(event, triaged), triaged.fingerprint);
    return maybeAutoPublish(storedCase);
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
        let merged = 0;
        let ignored = 0;
        for (const submissionId of submissionIds) {
          const submission = store.getSubmission(submissionId);
          if (!submission) {
            ignored += 1;
            continue;
          }
          const before = store.listCases().length;
          const storedCase = await triageAndUpsertSubmission(submission);
          const after = store.listCases().length;
          caseIds.push(storedCase.id);
          if (after > before) created += 1;
          else merged += 1;
        }
        return { statusCode: 200, body: { caseIds, created, merged, ignored } };
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
        const storedCase = await handleRuntimeEvent(event);
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

      if (method === 'GET' && url?.startsWith('/cases')) {
        const route = new URL(url, 'http://signalforge.local');
        if (route.pathname === '/cases') {
          const filters = parseCasesQuery(url);
          const items = store.listCases({
            status: firstNonEmpty(filters.status),
            sourceKind: firstNonEmpty(filters.sourceKind),
            published: filters.published,
          }).map(toInboxItem);
          return { statusCode: 200, body: { items } };
        }
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
