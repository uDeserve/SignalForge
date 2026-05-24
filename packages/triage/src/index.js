import {
  CaseType,
  PublicationTarget,
} from '../../core/src/index.js';

export const TriageModes = Object.freeze({
  heuristic: 'heuristic',
  llm: 'llm',
});

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function toConfidenceLabel(confidence) {
  if (confidence >= 0.8) return 'confidence:high';
  if (confidence >= 0.5) return 'confidence:medium';
  return 'confidence:low';
}

function caseTypeToLabel(type) {
  return String(type ?? 'unknown').replace(/_/g, '-');
}

function caseTypeToProblemType(type) {
  if (type === CaseType.feature_request) return 'feature';
  return type ?? 'noise';
}

function problemTypeToCaseType(type) {
  if (type === 'feature') return CaseType.feature_request;
  if (type === 'bug') return CaseType.bug;
  if (type === 'ux') return CaseType.ux;
  if (type === 'support') return CaseType.support;
  return CaseType.noise;
}

function inferSuggestedNextAction(problemType) {
  if (problemType === 'support') return 'reply';
  if (problemType === 'noise') return 'ignore';
  return 'investigate';
}

function collectEvidenceUsedFromSubmission(submission) {
  const evidence = [];
  if (submission?.id) {
    evidence.push({ kind: 'submission', id: submission.id });
  }
  for (const runtimeError of submission?.evidence?.runtimeErrors ?? []) {
    if (runtimeError?.fingerprint || runtimeError?.message) {
      evidence.push({
        kind: 'runtime_error',
        id: runtimeError.fingerprint ?? runtimeError.message,
      });
    }
  }
  return evidence;
}

function collectEvidenceUsedFromRuntimeEvent(event) {
  const evidence = [];
  if (event?.id) {
    evidence.push({ kind: 'runtime_event', id: event.id });
  }
  return evidence;
}

function dedupeLabels(labels = []) {
  return [...new Set(labels.map((label) => String(label ?? '').trim()).filter(Boolean))];
}

function normalizeSuggestedLabels(problemType, confidence, clusterSizeEstimate, labels = [], { actionable, sourceLabel }) {
  return dedupeLabels([
    sourceLabel,
    `type:${caseTypeToLabel(problemTypeToCaseType(problemType))}`,
    toConfidenceLabel(confidence),
    clusterSizeEstimate > 1 ? 'cluster:multi-user' : 'cluster:single',
    actionable ? 'decision:pending' : '',
    ...labels,
  ]);
}

function fingerprintSubmission(submission) {
  const title = normalizeText(submission?.content?.title);
  const body = normalizeText(submission?.content?.body);
  const route = normalizeText(submission?.appContext?.route);
  const primaryError = normalizeText(submission?.evidence?.runtimeErrors?.[0]?.fingerprint);
  return [title, body.slice(0, 120), route, primaryError].filter(Boolean).join('|');
}

function fingerprintRuntimeEvent(event) {
  const fingerprint = normalizeText(event?.fingerprint);
  if (fingerprint) return fingerprint;
  const route = normalizeText(event?.route);
  const errorType = normalizeText(event?.error?.type);
  const errorMessage = normalizeText(event?.error?.message);
  const release = normalizeText(event?.release);
  return [route, errorType, errorMessage.slice(0, 120), release].filter(Boolean).join('|');
}

function classifySubmission(submission) {
  const body = normalizeText(submission?.content?.body);
  const title = normalizeText(submission?.content?.title);
  const evidence = normalizeText(submission?.evidence?.runtimeErrors?.[0]?.message);
  const text = `${title} ${body} ${evidence}`;

  if (!text.trim()) {
    return { primaryType: CaseType.noise, confidence: 0 };
  }

  if (/(error|exception|trace|fail|freeze|hang|crash|500|timeout)/.test(text)) {
    return { primaryType: CaseType.bug, confidence: 0.9 };
  }

  if (
    /(slow|confusing|hard to use|ux|ui|layout|button|popup|overlay|blocked|can't continue|cannot continue|can't read|cannot read|interrupt)/.test(text) ||
    /(不好用|不顺手|不方便|看不到|看不清|挡住|遮挡|卡住流程|继续不了|没法继续|无法继续|影响阅读|影响使用|体验不好|排版|布局|按钮|弹层|弹窗|遮住|不舒服)/.test(text)
  ) {
    return { primaryType: CaseType.ux, confidence: 0.78 };
  }

  if (/(feature|would like|wish|please add|request|建议|希望|增加|添加|支持一下|能不能加)/.test(text)) {
    return { primaryType: CaseType.feature_request, confidence: 0.72 };
  }

  if (/(how do i|help|support|question|can't find|cannot find|怎么用|不会用|在哪|找不到|求助|帮助)/.test(text)) {
    return { primaryType: CaseType.support, confidence: 0.65 };
  }

  if (text.length >= 8) {
    return { primaryType: CaseType.ux, confidence: 0.58 };
  }

  return { primaryType: CaseType.noise, confidence: 0.35 };
}

function scoreSubmission(submission, classification) {
  const body = normalizeText(submission?.content?.body);
  const hasEvidence = Boolean(
    submission?.evidence?.screenshotUrls?.length ||
      submission?.evidence?.recordingUrls?.length ||
      submission?.evidence?.consoleLogs?.length ||
      submission?.evidence?.runtimeErrors?.length
  );
  const hasUserPainSignal =
    /(blocked|confusing|slow|hard to use|can't continue|cannot continue|interrupt|freeze|hang|popup|overlay)/.test(body) ||
    /(不好用|不顺手|不方便|看不到|挡住|遮挡|继续不了|没法继续|无法继续|影响阅读|影响使用|体验不好|弹层|弹窗|排版|布局)/.test(body);

  const actionabilityScore =
    classification.primaryType === CaseType.bug || hasEvidence
      ? 0.85
      : classification.primaryType === CaseType.ux && hasUserPainSignal
        ? 0.74
        : classification.primaryType === CaseType.feature_request
          ? 0.58
          : 0.35;
  const severityScore = /(crash|freeze|hang|500|timeout|data loss|cannot save)/.test(body) ? 0.8 : 0.3;
  const duplicateConfidence = 0.2;
  const publishRecommendation =
    classification.primaryType === CaseType.noise
      ? PublicationTarget.none
      : classification.primaryType === CaseType.support
        ? PublicationTarget.none
        : PublicationTarget.github_issue;

  return {
    actionabilityScore,
    severityScore,
    duplicateConfidence,
    publishRecommendation,
  };
}

function heuristicSemanticFromSubmission(submission, classification, scoring, fingerprint) {
  const problemType = caseTypeToProblemType(classification.primaryType);
  const actionable =
    scoring.publishRecommendation !== PublicationTarget.none &&
    scoring.actionabilityScore >= 0.5 &&
    classification.primaryType !== CaseType.noise;
  const normalizedSummary = firstNonEmpty(
    submission?.content?.title,
    submission?.content?.body,
    classification.primaryType === CaseType.bug ? 'Bug report' : 'User feedback'
  );

  return {
    triageMode: TriageModes.heuristic,
    normalizedSummary,
    problemType,
    affectedSurface: firstNonEmpty(submission?.appContext?.route),
    userImpact: '',
    evidenceUsed: collectEvidenceUsedFromSubmission(submission),
    clusterKey: fingerprint,
    clusterAction: 'new_cluster',
    clusterSizeEstimate: 1,
    publishRecommendation: scoring.publishRecommendation === PublicationTarget.github_issue ? 'publish' : 'hold',
    confidence: classification.confidence,
    openQuestions: [],
    suggestedLabels: normalizeSuggestedLabels(problemType, classification.confidence, 1, [], {
      actionable,
      sourceLabel: 'source:user-feedback',
    }),
    suggestedNextAction: inferSuggestedNextAction(problemType),
  };
}

function heuristicSemanticFromRuntimeEvent(event, classification, scoring, fingerprint) {
  const problemType = caseTypeToProblemType(classification.primaryType);
  const actionable = classification.primaryType === CaseType.bug;
  const normalizedSummary = firstNonEmpty(event?.error?.type, event?.error?.message, 'Runtime error');

  return {
    triageMode: TriageModes.heuristic,
    normalizedSummary,
    problemType,
    affectedSurface: firstNonEmpty(event?.route),
    userImpact: '',
    evidenceUsed: collectEvidenceUsedFromRuntimeEvent(event),
    clusterKey: fingerprint,
    clusterAction: 'new_cluster',
    clusterSizeEstimate: 1,
    publishRecommendation: scoring.publishRecommendation === PublicationTarget.github_issue ? 'publish' : 'hold',
    confidence: classification.confidence,
    openQuestions: [],
    suggestedLabels: normalizeSuggestedLabels(problemType, classification.confidence, 1, [], {
      actionable,
      sourceLabel: 'source:runtime-signal',
    }),
    suggestedNextAction: inferSuggestedNextAction(problemType),
  };
}

function triageSubmissionHeuristic(submission) {
  const classification = classifySubmission(submission);
  const scoring = scoreSubmission(submission, classification);
  const fingerprint = fingerprintSubmission(submission);
  const actionable =
    scoring.publishRecommendation !== PublicationTarget.none &&
    scoring.actionabilityScore >= 0.5 &&
    classification.primaryType !== CaseType.noise;
  const semantic = heuristicSemanticFromSubmission(submission, classification, scoring, fingerprint);

  return {
    fingerprint,
    classification,
    scoring,
    actionable,
    canonicalTitle:
      submission?.content?.title?.trim() ||
      (classification.primaryType === CaseType.bug ? 'Bug report' : 'User feedback'),
    canonicalSummary: submission?.content?.body?.trim() || '',
    semantic,
  };
}

function triageRuntimeEventHeuristic(event) {
  const errorType = normalizeText(event?.error?.type);
  const errorMessage = normalizeText(event?.error?.message);
  const fingerprint = fingerprintRuntimeEvent(event);
  const text = `${errorType} ${errorMessage} ${normalizeText(event?.route)}`;
  const classification = /(error|exception|timeout|crash|fail|500|429|hang)/.test(text)
    ? { primaryType: CaseType.bug, confidence: 0.92 }
    : { primaryType: CaseType.noise, confidence: 0.25 };
  const severityScore = /(timeout|crash|500|cannot|unhandled|fatal)/.test(text) ? 0.82 : 0.45;
  const actionable = classification.primaryType === CaseType.bug;
  const scoring = {
    actionabilityScore: actionable ? 0.9 : 0.2,
    severityScore,
    duplicateConfidence: 0.4,
    publishRecommendation: actionable ? PublicationTarget.github_issue : PublicationTarget.none,
  };
  const semantic = heuristicSemanticFromRuntimeEvent(event, classification, scoring, fingerprint);

  return {
    fingerprint,
    classification,
    scoring,
    actionable,
    canonicalTitle: event?.error?.type?.trim() || 'Runtime error',
    canonicalSummary: event?.error?.message?.trim() || 'Runtime failure detected.',
    semantic,
  };
}

function readField(input, ...keys) {
  for (const key of keys) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) {
      return input[key];
    }
  }
  return undefined;
}

export function validateTriageResult(input = {}) {
  const normalizedSummary = String(readField(input, 'normalizedSummary', 'normalized_summary') ?? '').trim();
  const problemType = String(readField(input, 'problemType', 'problem_type') ?? '').trim().toLowerCase();
  const affectedSurface = String(readField(input, 'affectedSurface', 'affected_surface') ?? '').trim();
  const userImpact = String(readField(input, 'userImpact', 'user_impact') ?? '').trim();
  const clusterKey = String(readField(input, 'clusterKey', 'cluster_key') ?? '').trim();
  const clusterAction = String(readField(input, 'clusterAction', 'cluster_action') ?? 'new_cluster').trim();
  const publishRecommendation = String(readField(input, 'publishRecommendation', 'publish_recommendation') ?? '').trim().toLowerCase();
  const suggestedNextAction = String(readField(input, 'suggestedNextAction', 'suggested_next_action') ?? '').trim().toLowerCase();
  const confidenceValue = Number(readField(input, 'confidence'));
  const clusterSizeEstimateValue = Number(readField(input, 'clusterSizeEstimate', 'cluster_size_estimate'));
  const evidenceUsed = readField(input, 'evidenceUsed', 'evidence_used');
  const openQuestions = readField(input, 'openQuestions', 'open_questions');
  const suggestedLabels = readField(input, 'suggestedLabels', 'suggested_labels');
  const triageMode = String(readField(input, 'triageMode', 'triage_mode') ?? TriageModes.llm).trim();

  if (!normalizedSummary) return null;
  if (!['bug', 'ux', 'feature', 'support', 'noise'].includes(problemType)) return null;
  if (!['publish', 'hold'].includes(publishRecommendation)) return null;
  if (!['investigate', 'fix', 'reply', 'ignore'].includes(suggestedNextAction)) return null;
  if (!Number.isFinite(confidenceValue) || confidenceValue < 0 || confidenceValue > 1) return null;
  if (!Number.isFinite(clusterSizeEstimateValue) || clusterSizeEstimateValue < 1) return null;
  if (!Array.isArray(evidenceUsed) || !Array.isArray(openQuestions) || !Array.isArray(suggestedLabels)) return null;

  return {
    triageMode,
    normalizedSummary,
    problemType,
    affectedSurface,
    userImpact,
    evidenceUsed,
    clusterKey,
    clusterAction,
    clusterSizeEstimate: Math.max(1, Math.round(clusterSizeEstimateValue)),
    publishRecommendation,
    confidence: confidenceValue,
    openQuestions: openQuestions.map((item) => String(item ?? '').trim()).filter(Boolean),
    suggestedLabels: suggestedLabels.map((item) => String(item ?? '').trim()).filter(Boolean),
    suggestedNextAction,
  };
}

function mergeSemanticIntoLegacy(base, semantic, { sourceLabel }) {
  const classification = {
    ...base.classification,
    primaryType: problemTypeToCaseType(semantic.problemType),
    confidence: semantic.confidence,
  };
  const publishRecommendation =
    semantic.publishRecommendation === 'publish' ? PublicationTarget.github_issue : PublicationTarget.none;
  const actionable = publishRecommendation !== PublicationTarget.none && classification.primaryType !== CaseType.noise;
  const semanticLabels = normalizeSuggestedLabels(
    semantic.problemType,
    semantic.confidence,
    semantic.clusterSizeEstimate,
    semantic.suggestedLabels,
    { actionable, sourceLabel }
  );

  return {
    ...base,
    fingerprint: semantic.clusterKey || base.fingerprint,
    classification,
    scoring: {
      ...base.scoring,
      actionabilityScore: actionable ? Math.max(base.scoring.actionabilityScore, 0.7) : Math.min(base.scoring.actionabilityScore, 0.35),
      duplicateConfidence: semantic.clusterSizeEstimate > 1 ? Math.max(base.scoring.duplicateConfidence, 0.75) : base.scoring.duplicateConfidence,
      publishRecommendation,
    },
    actionable,
    canonicalTitle: semantic.normalizedSummary,
    canonicalSummary: [semantic.normalizedSummary, semantic.userImpact].filter(Boolean).join('\n\n'),
    semantic: {
      ...semantic,
      suggestedLabels: semanticLabels,
    },
  };
}

export function createTriageEngine({ submissionAnalyzer, runtimeEventAnalyzer, logger = console } = {}) {
  return {
    async triageSubmission(submission, context = {}) {
      const heuristic = triageSubmissionHeuristic(submission);
      if (!submissionAnalyzer) return heuristic;

      try {
        const analyzed = await submissionAnalyzer({
          requestId: context.requestId ?? '',
          policy: context.policy ?? {
            publishBias: 'lenient',
            privacyMode: 'strict',
          },
          submissions: [submission],
          runtimeEvents: context.runtimeEvents ?? [],
          existingClusters: context.existingClusters ?? [],
        });
        const semantic = validateTriageResult(analyzed);
        if (!semantic) {
          return heuristic;
        }
        return mergeSemanticIntoLegacy(heuristic, semantic, {
          sourceLabel: 'source:user-feedback',
        });
      } catch (error) {
        logger?.warn?.('SignalForge submission analyzer failed, falling back to heuristic triage.', error);
        return heuristic;
      }
    },

    async triageRuntimeEvent(event, context = {}) {
      const heuristic = triageRuntimeEventHeuristic(event);
      if (!runtimeEventAnalyzer) return heuristic;

      try {
        const analyzed = await runtimeEventAnalyzer({
          requestId: context.requestId ?? '',
          policy: context.policy ?? {
            publishBias: 'lenient',
            privacyMode: 'strict',
          },
          submissions: context.submissions ?? [],
          runtimeEvents: [event],
          existingClusters: context.existingClusters ?? [],
        });
        const semantic = validateTriageResult(analyzed);
        if (!semantic) {
          return heuristic;
        }
        return mergeSemanticIntoLegacy(heuristic, semantic, {
          sourceLabel: 'source:runtime-signal',
        });
      } catch (error) {
        logger?.warn?.('SignalForge runtime analyzer failed, falling back to heuristic triage.', error);
        return heuristic;
      }
    },
  };
}

export function triageSubmission(submission) {
  return triageSubmissionHeuristic(submission);
}

export function triageRuntimeEvent(event) {
  return triageRuntimeEventHeuristic(event);
}
