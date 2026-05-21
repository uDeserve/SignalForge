export const SubmissionSources = Object.freeze({
  web_widget: 'web_widget',
  mobile_sdk: 'mobile_sdk',
  email: 'email',
  chat: 'chat',
  manual_import: 'manual_import',
});

export const CaseStatus = Object.freeze({
  new: 'new',
  triaging: 'triaging',
  needs_info: 'needs_info',
  ready_for_publish: 'ready_for_publish',
  published: 'published',
  accepted: 'accepted',
  delegated: 'delegated',
  in_progress: 'in_progress',
  resolved: 'resolved',
  rejected: 'rejected',
  closed: 'closed',
  merged: 'merged',
});

export const CaseType = Object.freeze({
  bug: 'bug',
  ux: 'ux',
  feature_request: 'feature_request',
  support: 'support',
  noise: 'noise',
});

export const DecisionType = Object.freeze({
  accept: 'accept',
  reject: 'reject',
  needs_info: 'needs_info',
  merge: 'merge',
  publish: 'publish',
  delegate_fix: 'delegate_fix',
  defer: 'defer',
});

export const PublicationTarget = Object.freeze({
  github_issue: 'github_issue',
  github_discussion: 'github_discussion',
  none: 'none',
});

export const DelegationKind = Object.freeze({
  mcp: 'mcp',
  skill: 'skill',
  workflow: 'workflow',
  webhook: 'webhook',
});

export const DelegationStatus = Object.freeze({
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
});

export const FeedbackCase = {
  create(input) {
    return {
      id: input.id,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      status: input.status ?? CaseStatus.new,
      canonicalTitle: input.canonicalTitle ?? '',
      canonicalSummary: input.canonicalSummary ?? '',
      classification: input.classification ?? {
        primaryType: CaseType.noise,
        confidence: 0,
      },
      scoring: input.scoring ?? {
        actionabilityScore: 0,
        severityScore: 0,
        duplicateConfidence: 0,
        publishRecommendation: PublicationTarget.none,
      },
      clustering: input.clustering ?? {
        mergedSubmissionIds: [],
        relatedCaseIds: [],
      },
      evidenceSummary: input.evidenceSummary ?? {
        submissionCount: 0,
      },
      decisionReadiness: input.decisionReadiness ?? {
        actionable: false,
        missingInfo: [],
      },
      publication: input.publication ?? {
        target: PublicationTarget.none,
        published: false,
      },
      links: input.links ?? {
        submissionIds: [],
      },
      metadata: input.metadata ?? {},
    };
  },
};

export const signalforgeCore = true;
