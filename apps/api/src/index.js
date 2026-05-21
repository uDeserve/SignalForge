import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStore } from './store.js';
import { createSubmission, createCase, CaseStatus, PublicationTarget } from '../../../packages/core/src/index.js';
import { triageSubmission } from '../../../packages/triage/src/index.js';
import {
  applyDecisionToCase,
  buildPublicationSnapshot,
  createDecisionRecord,
  createIssuePublication,
  parseOwnerCommand,
} from '../../../packages/github-bridge/src/index.js';

export function createSignalForgeApi({ store = createStore(), logger = console } = {}) {
  function createCaseRecordFromSubmission(submission) {
    const triaged = triageSubmission(submission);
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
        suggestedLabels: ['source:user-feedback'],
        suggestedPriority: triaged.scoring.severityScore >= 0.8 ? 'p1' : 'p2',
      },
      publication: {
        target: triaged.actionable ? PublicationTarget.github_issue : PublicationTarget.none,
        published: false,
      },
      links: {
        submissionIds: [submission.id],
      },
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
          const caseRecord = createCaseRecordFromSubmission(submission);
          const storedCase = store.upsertCase(caseRecord, caseRecord.clustering.fingerprint);
          caseIds.push(storedCase.id);
          created += storedCase.id === caseRecord.id ? 1 : 0;
        }
        return { statusCode: 200, body: { caseIds, created, merged: submissionIds.length - created, ignored: 0 } };
      }

      if (method === 'GET' && url === '/cases') {
        return { statusCode: 200, body: { items: store.listCases() } };
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
        const publication = createIssuePublication(caseRecord, {
          repo: payload.repo ?? caseRecord.decisionReadiness?.suggestedRepo ?? 'org/repo',
          mode: payload.mode ?? PublicationTarget.github_issue,
          externalId: `issue_${caseRecord.id}`,
          url: `https://github.com/${payload.repo ?? caseRecord.decisionReadiness?.suggestedRepo ?? 'org/repo'}/issues/1`,
          number: 1,
        });
        const stored = store.savePublication({
          ...publication,
          snapshot: buildPublicationSnapshot(caseRecord, { publicRepo: true }),
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
  const { server } = createSignalForgeApi();
  server.listen(port, () => {
    console.log(`SignalForge API listening on http://localhost:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
