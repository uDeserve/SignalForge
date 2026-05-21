import {
  CaseStatus,
  DecisionType,
  PublicationTarget,
} from '../../core/src/index.js';

function normalizeLabel(label) {
  return String(label ?? '').trim().toLowerCase();
}

export function buildIssueTitle(caseRecord) {
  return caseRecord?.canonicalTitle?.trim() || 'SignalForge case';
}

export function buildIssueBody(caseRecord, { publicRepo = true } = {}) {
  const lines = [];
  lines.push('## Summary');
  lines.push(caseRecord?.canonicalSummary?.trim() || 'No summary provided.');
  lines.push('');
  lines.push('## Impact');
  lines.push(`Type: ${caseRecord?.classification?.primaryType ?? 'unknown'}`);
  lines.push(`Severity: ${caseRecord?.classification?.severity ?? 'unknown'}`);
  lines.push('');
  lines.push('## Evidence');
  lines.push(`Submissions: ${caseRecord?.evidenceSummary?.submissionCount ?? 0}`);
  if (caseRecord?.evidenceSummary?.topErrorFingerprints?.length) {
    lines.push(`Error fingerprints: ${caseRecord.evidenceSummary.topErrorFingerprints.join(', ')}`);
  }
  lines.push('');
  lines.push('## Platform Metadata');
  lines.push(`Case ID: ${caseRecord?.id ?? 'unknown'}`);
  lines.push(`Status: ${caseRecord?.status ?? 'unknown'}`);
  lines.push(`Publication target: ${caseRecord?.publication?.target ?? 'unknown'}`);
  if (!publicRepo && caseRecord?.decisionReadiness?.missingInfo?.length) {
    lines.push('');
    lines.push('## Internal Notes');
    lines.push(`Missing info: ${caseRecord.decisionReadiness.missingInfo.join(', ')}`);
  }
  return lines.join('\n');
}

export function selectGitHubLabels(caseRecord) {
  const labels = new Set([
    'source:user-feedback',
  ]);
  const primaryType = caseRecord?.classification?.primaryType;
  if (primaryType) labels.add(`type:${normalizeLabel(primaryType).replace(/_/g, '-')}`);
  const priority = caseRecord?.decisionReadiness?.suggestedPriority;
  if (priority) labels.add(`priority:${normalizeLabel(priority)}`);
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
    assignees: caseRecord?.decisionReadiness?.suggestedOwner ? [caseRecord.decisionReadiness.suggestedOwner] : [],
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
