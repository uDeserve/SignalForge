import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createStore } from '../../api/src/store.js';
import {
  DecisionType,
  CaseStatus,
} from '../../../packages/core/src/index.js';
import {
  applyDecisionToCase,
  createDecisionRecord,
  parseOwnerCommand,
} from '../../../packages/github-bridge/src/index.js';

function parseJsonBody(rawBody) {
  if (!rawBody) return {};
  return JSON.parse(rawBody);
}

function getHeader(headers, name) {
  const lower = String(name).toLowerCase();
  return headers?.[lower] ?? headers?.[name] ?? null;
}

function verifyGithubSignature(rawBody, signatureHeader, secret) {
  if (!secret) {
    return { ok: true, reason: 'no secret configured' };
  }
  if (!signatureHeader) {
    return { ok: false, reason: 'missing signature' };
  }
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const provided = Buffer.from(String(signatureHeader));
  if (expected.length !== provided.length) {
    return { ok: false, reason: 'invalid signature' };
  }
  return {
    ok: timingSafeEqual(expected, provided),
    reason: 'invalid signature',
  };
}

function parseIssueReference(payload) {
  const issue = payload?.issue ?? payload?.repository?.issue ?? payload?.issue_comment?.issue;
  if (!issue) return null;
  return {
    repo: payload?.repository?.full_name ?? payload?.repository?.name ?? '',
    number: issue.number,
    state: issue.state,
    title: issue.title,
    body: issue.body,
    url: issue.html_url,
  };
}

function toGithubActor(payload) {
  return {
    type: 'github',
    id: payload?.sender?.login ?? 'github:unknown',
  };
}

export function createSignalForgeGithubApp({ store = createStore(), logger = console, secret = process.env.GITHUB_WEBHOOK_SECRET } = {}) {
  async function handleWebhook({ headers = {}, rawBody = '', body = {} }) {
    const eventName = getHeader(headers, 'x-github-event');
    if (!eventName) {
      return { statusCode: 400, error: { code: 'invalid_request', message: 'missing x-github-event header' } };
    }

    const signature = getHeader(headers, 'x-hub-signature-256');
    const verification = verifyGithubSignature(rawBody, signature, secret);
    if (!verification.ok) {
      return { statusCode: 401, error: { code: 'unauthorized', message: verification.reason } };
    }

    if (eventName === 'ping') {
      return { statusCode: 200, body: { ok: true, message: 'pong' } };
    }

    if (eventName === 'issues') {
      const action = body?.action;
      const issue = parseIssueReference(body);
      if (!issue) {
        return { statusCode: 200, body: { ignored: true } };
      }
      const publication = store.findPublicationByIssue({ repo: issue.repo, number: issue.number });
      if (!publication) {
        return { statusCode: 200, body: { ignored: true } };
      }

      const nextSync = {
        status: action === 'closed' ? 'closed' : action === 'reopened' ? 'active' : publication.sync?.status ?? 'active',
        lastSyncedAt: new Date().toISOString(),
        lastEvent: action,
      };
      const updatedPublication = store.updatePublicationSync(publication.id, nextSync);
      const caseRecord = store.getCase(publication.caseId);
      if (caseRecord && action === 'closed') {
        const nextCase = {
          ...caseRecord,
          status: CaseStatus.closed,
          updatedAt: new Date().toISOString(),
        };
        store.upsertCase(nextCase, nextCase.clustering.fingerprint);
      }
      if (caseRecord && action === 'reopened') {
        const nextCase = {
          ...caseRecord,
          status: CaseStatus.published,
          updatedAt: new Date().toISOString(),
        };
        store.upsertCase(nextCase, nextCase.clustering.fingerprint);
      }
      return { statusCode: 200, body: { publicationId: updatedPublication?.id ?? publication.id, synced: true } };
    }

    if (eventName === 'issue_comment') {
      const issue = parseIssueReference(body);
      const commentBody = body?.comment?.body ?? '';
      const command = parseOwnerCommand(commentBody);
      if (!issue || !command) {
        return { statusCode: 200, body: { ignored: true } };
      }
      const publication = store.findPublicationByIssue({ repo: issue.repo, number: issue.number });
      if (!publication) {
        return { statusCode: 200, body: { ignored: true } };
      }
      const caseRecord = store.getCase(publication.caseId);
      if (!caseRecord) {
        return { statusCode: 200, body: { ignored: true } };
      }

      const decision = command.decision;
      const decisionRecord = createDecisionRecord(caseRecord.id, {
        actorId: toGithubActor(body).id,
        actorType: toGithubActor(body).type,
        decision,
        reason: 'github_issue_comment',
        payload: command.payload ?? {},
      });
      store.saveDecision(decisionRecord);
      const nextCase = applyDecisionToCase(caseRecord, decisionRecord);
      store.upsertCase(nextCase, nextCase.clustering.fingerprint);
      return {
        statusCode: 200,
        body: {
          caseId: nextCase.id,
          decisionId: decisionRecord.id,
          statusAfterDecision: nextCase.status,
        },
      };
    }

    return { statusCode: 200, body: { ignored: true } };
  }

  const server = createServer(async (req, res) => {
    let rawBody = '';
    try {
      rawBody = await new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > 1_000_000) {
            reject(new Error('Payload too large'));
            req.destroy();
          }
        });
        req.on('end', () => resolve(raw));
        req.on('error', reject);
      });
    } catch (error) {
      res.writeHead(error?.message === 'Payload too large' ? 413 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'invalid_request', message: error.message } }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/webhooks/github') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'not_found', message: 'route not found' } }));
      return;
    }

    try {
      const body = parseJsonBody(rawBody);
      const result = await handleWebhook({ headers: req.headers, rawBody, body });
      if (result.error) {
        res.writeHead(result.statusCode, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      res.writeHead(result.statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: result.body }));
    } catch (error) {
      logger.error?.(error);
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'invalid_request', message: error.message } }));
    }
  });

  return { server, store, handleWebhook };
}

function main() {
  const port = Number(process.env.PORT || 8788);
  const { server } = createSignalForgeGithubApp();
  server.listen(port, () => {
    console.log(`SignalForge GitHub App listening on http://localhost:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
