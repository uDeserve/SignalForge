import {
  CaseStatus,
  DecisionType,
  PublicationTarget,
} from '../../core/src/index.js';

function normalizeLabel(label) {
  return String(label ?? '').trim().toLowerCase();
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, '[redacted-email]')
    .replace(/\b\d{6,}\b/g, '[redacted-number]')
    .trim();
}

function isValidGitHubAssignee(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (text === 'owner') return false;
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37})$/.test(text);
}

export function buildIssueTitle(caseRecord) {
  return caseRecord?.canonicalTitle?.trim() || 'SignalForge case';
}

export function buildIssueBody(caseRecord, { publicRepo = true } = {}) {
  const triage = caseRecord?.metadata?.triage ?? {};
  const lines = [];
  lines.push('## Summary');
  lines.push(publicRepo ? sanitizeText(caseRecord?.canonicalSummary) || 'No summary provided.' : caseRecord?.canonicalSummary?.trim() || 'No summary provided.');
  lines.push('');
  lines.push('## Impact');
  lines.push(`Type: ${caseRecord?.classification?.primaryType ?? 'unknown'}`);
  lines.push(`Severity: ${caseRecord?.classification?.severity ?? 'unknown'}`);
  if (triage?.confidence !== undefined) {
    lines.push(`Confidence: ${triage.confidence}`);
  }
  if (triage?.suggestedNextAction) {
    lines.push(`Suggested next action: ${triage.suggestedNextAction}`);
  }
  lines.push('');
  lines.push('## Evidence');
  lines.push(`Submissions: ${caseRecord?.evidenceSummary?.submissionCount ?? 0}`);
  lines.push(`Runtime events: ${caseRecord?.evidenceSummary?.runtimeEventCount ?? 0}`);
  if (triage?.clusterSizeEstimate) {
    lines.push(`Cluster size: ${triage.clusterSizeEstimate}`);
  }
  if (caseRecord?.evidenceSummary?.topErrorFingerprints?.length) {
    lines.push(`Error fingerprints: ${caseRecord.evidenceSummary.topErrorFingerprints.join(', ')}`);
  }
  if (caseRecord?.evidenceSummary?.environments?.length) {
    lines.push(`Environments: ${caseRecord.evidenceSummary.environments.join(', ')}`);
  }
  if (triage?.affectedSurface) {
    lines.push(`Affected surface: ${publicRepo ? sanitizeText(triage.affectedSurface) : triage.affectedSurface}`);
  }
  lines.push('');
  lines.push('## Platform Metadata');
  lines.push(`Case ID: ${caseRecord?.id ?? 'unknown'}`);
  lines.push(`Status: ${caseRecord?.status ?? 'unknown'}`);
  lines.push(`Publication target: ${caseRecord?.publication?.target ?? 'unknown'}`);
  if (triage?.triageMode) {
    lines.push(`Triage mode: ${triage.triageMode}`);
  }
  if (triage?.openQuestions?.length) {
    lines.push('');
    lines.push('## Open Questions');
    for (const question of triage.openQuestions) {
      lines.push(`- ${publicRepo ? sanitizeText(question) : question}`);
    }
  }
  if (!publicRepo && caseRecord?.decisionReadiness?.missingInfo?.length) {
    lines.push('');
    lines.push('## Internal Notes');
    lines.push(`Missing info: ${caseRecord.decisionReadiness.missingInfo.join(', ')}`);
  }
  if (publicRepo) {
    lines.push('');
    lines.push('## Privacy');
    lines.push('Sensitive raw logs, screenshots, URLs, and direct user identifiers are intentionally omitted.');
  }
  return lines.join('\n');
}

export function selectGitHubLabels(caseRecord) {
  const labels = new Set(caseRecord?.decisionReadiness?.suggestedLabels ?? caseRecord?.metadata?.triage?.suggestedLabels ?? []);
  const primaryType = caseRecord?.classification?.primaryType;
  if (primaryType) labels.add(`type:${normalizeLabel(primaryType).replace(/_/g, '-')}`);
  const priority = caseRecord?.decisionReadiness?.suggestedPriority;
  if (priority) labels.add(`priority:${normalizeLabel(priority)}`);
  if (!labels.size) {
    labels.add(caseRecord?.metadata?.sourceKind === 'runtime_signal' ? 'source:runtime-signal' : 'source:user-feedback');
  }
  return [...labels];
}

export function parseOwnerCommand(commentBody) {
  const text = String(commentBody ?? '').trim();
  if (!text.startsWith('/')) return null;

  const [command, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();

  if (command === 'accept') {
    return { decision: DecisionType.accept };
  }
  if (command === 'reject') {
    return { decision: DecisionType.reject };
  }
  if (command === 'needs-info') {
    return { decision: DecisionType.needs_info };
  }
  if (command === 'defer') {
    return { decision: DecisionType.defer };
  }
  if (command === 'publish') {
    return { decision: DecisionType.publish };
  }
  if (command === 'delegate' && arg) {
    return {
      decision: DecisionType.delegate_fix,
      payload: {
        delegateTarget: 'skill',
        delegateConfig: { skillName: arg },
      },
    };
  }
  if (command === 'merge-into' && arg) {
    return {
      decision: DecisionType.merge,
      payload: {
        mergeIntoCaseId: arg,
      },
    };
  }

  return null;
}

export function applyDecisionToCase(caseRecord, decisionRecord) {
  const decision = decisionRecord?.decision;
  const next = structuredClone(caseRecord);
  if (decision === DecisionType.accept) {
    next.status = CaseStatus.accepted;
  } else if (decision === DecisionType.reject) {
    next.status = CaseStatus.rejected;
  } else if (decision === DecisionType.needs_info) {
    next.status = CaseStatus.needs_info;
  } else if (decision === DecisionType.defer) {
    next.status = CaseStatus.triaging;
  } else if (decision === DecisionType.publish) {
    next.status = CaseStatus.ready_for_publish;
  } else if (decision === DecisionType.delegate_fix) {
    next.status = CaseStatus.delegated;
  } else if (decision === DecisionType.merge) {
    next.status = CaseStatus.merged;
  }
  next.updatedAt = decisionRecord?.madeAt ?? next.updatedAt;
  return next;
}

export function buildPublicationSnapshot(caseRecord, { publicRepo = true } = {}) {
  return {
    title: buildIssueTitle(caseRecord),
    body: buildIssueBody(caseRecord, { publicRepo }),
    labels: selectGitHubLabels(caseRecord),
    assignees: isValidGitHubAssignee(caseRecord?.decisionReadiness?.suggestedOwner)
      ? [caseRecord.decisionReadiness.suggestedOwner]
      : [],
  };
}

export function createIssuePublication(caseRecord, { repo, mode = PublicationTarget.github_issue, externalId, url, number }) {
  return {
    id: `pub_${caseRecord.id}`,
    caseId: caseRecord.id,
    createdAt: new Date().toISOString(),
    target: {
      provider: 'github',
      repo,
      mode,
    },
    result: {
      externalId,
      url,
      number,
    },
    snapshot: buildPublicationSnapshot(caseRecord),
    sync: {
      status: 'active',
      lastSyncedAt: new Date().toISOString(),
    },
  };
}

export function createDecisionRecord(caseId, { actorId = 'owner', actorType = 'owner', decision, reason = '', payload = {} }) {
  return {
    id: `dec_${caseId}_${Date.now()}`,
    caseId,
    madeAt: new Date().toISOString(),
    actor: {
      type: actorType,
      id: actorId,
    },
    decision,
    reason,
    payload,
  };
}

export function buildCaseContext(caseRecord, extras = {}) {
  return {
    case: caseRecord,
    decisions: extras.decisions ?? [],
    delegations: extras.delegations ?? [],
    publications: extras.publications ?? [],
    runtimeEvents: extras.runtimeEvents ?? [],
  };
}

export function parseGitHubRepo(input, fallback = 'org/repo') {
  const value = String(input ?? fallback).trim();
  const match = value.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) {
    throw new Error(`invalid github repo: ${value}`);
  }
  return {
    owner: match[1],
    repo: match[2],
    fullName: `${match[1]}/${match[2]}`,
  };
}

export function createPreviewGitHubPublisher() {
  return {
    kind: 'preview',
    async publishCase({ caseRecord, repo, mode = PublicationTarget.github_issue, publicRepo = true }) {
      const resolvedRepo = parseGitHubRepo(repo);
      return {
        repo: resolvedRepo.fullName,
        mode,
        snapshot: buildPublicationSnapshot(caseRecord, { publicRepo }),
        result: {
          externalId: `preview_issue_${caseRecord.id}`,
          url: `https://github.com/${resolvedRepo.fullName}/issues/1`,
          number: 1,
        },
        transport: {
          provider: 'github',
          authMode: 'preview',
        },
      };
    },
  };
}

export function createPatGitHubPublisher({
  token,
  apiBaseUrl = 'https://api.github.com',
  fetchImpl = globalThis.fetch,
  userAgent = 'SignalForge/0.1.0',
} = {}) {
  if (!token) {
    throw new Error('github token is required for PAT publisher');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is required for PAT publisher');
  }

  const normalizedBaseUrl = String(apiBaseUrl).replace(/\/$/, '');

  return {
    kind: 'pat',
    async publishCase({ caseRecord, repo, mode = PublicationTarget.github_issue, publicRepo = true }) {
      if (mode !== PublicationTarget.github_issue) {
        throw new Error(`unsupported github publication mode: ${mode}`);
      }

      const resolvedRepo = parseGitHubRepo(repo);
      const snapshot = buildPublicationSnapshot(caseRecord, { publicRepo });
      const response = await fetchImpl(
        `${normalizedBaseUrl}/repos/${resolvedRepo.owner}/${resolvedRepo.repo}/issues`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': userAgent,
          },
          body: JSON.stringify({
            title: snapshot.title,
            body: snapshot.body,
            labels: snapshot.labels,
            assignees: snapshot.assignees,
          }),
        },
      );

      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(`github issue publish failed: ${response.status} ${message}`.trim());
      }

      const issue = await response.json();
      return {
        repo: resolvedRepo.fullName,
        mode,
        snapshot,
        result: {
          externalId: String(issue.id),
          url: issue.html_url,
          number: issue.number,
        },
        transport: {
          provider: 'github',
          authMode: 'pat',
        },
      };
    },
  };
}

async function publishIssueViaGithubApi({
  token,
  apiBaseUrl = 'https://api.github.com',
  fetchImpl = globalThis.fetch,
  userAgent = 'SignalForge/0.1.0',
  caseRecord,
  repo,
  mode = PublicationTarget.github_issue,
  publicRepo = true,
  authMode = 'pat',
}) {
  if (!token) {
    throw new Error(`github token is required for ${authMode} publisher`);
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error(`fetch implementation is required for ${authMode} publisher`);
  }
  if (mode !== PublicationTarget.github_issue) {
    throw new Error(`unsupported github publication mode: ${mode}`);
  }

  const resolvedRepo = parseGitHubRepo(repo);
  const snapshot = buildPublicationSnapshot(caseRecord, { publicRepo });
  const normalizedBaseUrl = String(apiBaseUrl).replace(/\/$/, '');
  const response = await fetchImpl(
    `${normalizedBaseUrl}/repos/${resolvedRepo.owner}/${resolvedRepo.repo}/issues`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
      },
      body: JSON.stringify({
        title: snapshot.title,
        body: snapshot.body,
        labels: snapshot.labels,
        assignees: snapshot.assignees,
      }),
    },
  );

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`github issue publish failed: ${response.status} ${message}`.trim());
  }

  const issue = await response.json();
  return {
    repo: resolvedRepo.fullName,
    mode,
    snapshot,
    result: {
      externalId: String(issue.id),
      url: issue.html_url,
      number: issue.number,
    },
    transport: {
      provider: 'github',
      authMode,
    },
  };
}

function base64UrlEncode(input) {
  const source = typeof input === 'string' ? Buffer.from(input) : Buffer.from(input);
  return source.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function importGithubAppPrivateKey(privateKeyPem) {
  if (!privateKeyPem) {
    throw new Error('github app private key is required');
  }
  const pem = String(privateKeyPem).trim();
  const isPkcs1 = pem.includes('BEGIN RSA PRIVATE KEY');
  const createKey = await import('node:crypto').then(({ createPrivateKey }) => createPrivateKey);
  if (isPkcs1) {
    return createKey({
      key: pem,
      format: 'pem',
      type: 'pkcs1',
    });
  }
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const keyData = Buffer.from(body, 'base64');
  return createKey({
    key: keyData,
    format: 'der',
    type: 'pkcs8',
  });
}

export async function createGitHubAppJwt({
  appId,
  privateKeyPem,
  now = Math.floor(Date.now() / 1000),
} = {}) {
  if (!appId) {
    throw new Error('github app id is required');
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iat: now - 60,
    exp: now + 9 * 60,
    iss: String(appId),
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const cryptoKey = await importGithubAppPrivateKey(privateKeyPem);
  const signature = await import('node:crypto').then(({ sign }) =>
    sign('RSA-SHA256', Buffer.from(signingInput), cryptoKey),
  );
  return `${signingInput}.${base64UrlEncode(Buffer.from(signature))}`;
}

export function createJwtGitHubAppInstallationTokenProvider({
  appId,
  privateKeyPem,
  installationId = '',
  apiBaseUrl = 'https://api.github.com',
  fetchImpl = globalThis.fetch,
  userAgent = 'SignalForge/0.1.0',
} = {}) {
  if (!appId) {
    throw new Error('github app id is required');
  }
  if (!privateKeyPem) {
    throw new Error('github app private key is required');
  }
  if (!installationId) {
    throw new Error('github app installation id is required');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is required for github app installation token provider');
  }

  const normalizedBaseUrl = String(apiBaseUrl).replace(/\/$/, '');

  return {
    kind: 'jwt_installation_token',
    async getInstallationToken() {
      const jwt = await createGitHubAppJwt({ appId, privateKeyPem });
      const response = await fetchImpl(
        `${normalizedBaseUrl}/app/installations/${installationId}/access_tokens`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${jwt}`,
            'User-Agent': userAgent,
          },
        },
      );

      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(`github app installation token exchange failed: ${response.status} ${message}`.trim());
      }

      const tokenResponse = await response.json();
      return {
        token: tokenResponse.token,
        installationId: String(installationId),
        expiresAt: tokenResponse.expires_at ?? '',
      };
    },
  };
}

export function createGitHubPublisherFromEnv(env = process.env) {
  const publisherMode = String(env.GITHUB_PUBLISHER ?? 'preview').trim().toLowerCase();
  if (publisherMode === 'preview') {
    return createPreviewGitHubPublisher();
  }
  if (publisherMode === 'pat') {
    return createPatGitHubPublisher({
      token: env.GITHUB_TOKEN,
      apiBaseUrl: env.GITHUB_API_BASE_URL || 'https://api.github.com',
    });
  }
  if (publisherMode === 'app') {
    const hasJwtInputs = Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_INSTALLATION_ID);
    return createGitHubAppPublisher({
      installationTokenProvider: hasJwtInputs
        ? createJwtGitHubAppInstallationTokenProvider({
            appId: env.GITHUB_APP_ID,
            privateKeyPem: env.GITHUB_APP_PRIVATE_KEY,
            installationId: env.GITHUB_APP_INSTALLATION_ID,
            apiBaseUrl: env.GITHUB_API_BASE_URL || 'https://api.github.com',
          })
        : createStaticGitHubAppInstallationTokenProvider({
            token: env.GITHUB_APP_INSTALLATION_TOKEN,
            installationId: env.GITHUB_APP_INSTALLATION_ID,
          }),
      apiBaseUrl: env.GITHUB_API_BASE_URL || 'https://api.github.com',
      appId: env.GITHUB_APP_ID,
    });
  }
  throw new Error(`unsupported github publisher mode: ${publisherMode}`);
}

export function createStaticGitHubAppInstallationTokenProvider({
  token,
  installationId = '',
} = {}) {
  return {
    kind: 'static_installation_token',
    async getInstallationToken() {
      if (!token) {
        throw new Error('github app installation token is required');
      }
      return {
        token,
        installationId: installationId ? String(installationId) : '',
      };
    },
  };
}

export function createGitHubAppPublisher({
  installationTokenProvider,
  apiBaseUrl = 'https://api.github.com',
  fetchImpl = globalThis.fetch,
  userAgent = 'SignalForge/0.1.0',
  appId = '',
} = {}) {
  if (!installationTokenProvider || typeof installationTokenProvider.getInstallationToken !== 'function') {
    throw new Error('installationTokenProvider is required for github app publisher');
  }

  return {
    kind: 'app',
    appId: appId ? String(appId) : '',
    async publishCase({ caseRecord, repo, mode = PublicationTarget.github_issue, publicRepo = true }) {
      const installation = await installationTokenProvider.getInstallationToken({ repo, mode, caseRecord });
      return publishIssueViaGithubApi({
        token: installation?.token,
        apiBaseUrl,
        fetchImpl,
        userAgent,
        caseRecord,
        repo,
        mode,
        publicRepo,
        authMode: 'app',
      });
    },
  };
}
