import { createHash } from 'node:crypto';
import {
  CaseType,
  PublicationTarget,
} from '../../core/src/index.js';

export const TriageModes = Object.freeze({
  heuristic: 'heuristic',
  llm: 'llm',
});

const ENGLISH_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'cannot', 'continue',
  'do', 'does', 'for', 'from', 'had', 'has', 'have', 'help', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'please', 'so', 'that', 'the', 'this', 'to',
  'up', 'was', 'we', 'when', 'with', 'would', 'you', 'your',
]);

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = normalizeWhitespace(value);
    if (text) return text;
  }
  return '';
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))];
}

function stableHash(parts) {
  return createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 20);
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
  if (problemType === 'feature') return 'investigate';
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

function normalizeRoute(route) {
  return normalizeText(route)
    .replace(/[?#].*$/, '')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/([a-z_-]+)-\d+(?=\/|$)/g, '$1-:id')
    .replace(/[a-f0-9]{8,}/g, ':token');
}

function normalizeRelease(release) {
  const value = normalizeText(release);
  const match = value.match(/^(\d+)\.(\d+)/);
  if (match) return `${match[1]}.${match[2]}`;
  return value.replace(/\.\d+$/, '');
}

function normalizeSourceKind(value, fallback) {
  return firstNonEmpty(value, fallback).replace(/\s+/g, '_').toLowerCase();
}

function englishKeywords(text) {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .map((token) => token.replace(/(ing|ed|es|s)$/g, ''))
    .filter((token) => token.length >= 3 && !ENGLISH_STOPWORDS.has(token))
    .slice(0, 8);
}

function extractSignalMarkers(text) {
  const markers = [];
  if (/(freeze|hang|stuck|timeout|500|crash|fail|error|exception|trace|卡住|卡死|崩溃|报错|超时|失败)/.test(text)) markers.push('failure');
  if (/(save|submit|publish|sync|保存|提交|发布|同步)/.test(text)) markers.push('save-flow');
  if (/(popup|overlay|modal|sheet|tooltip|弹层|弹窗|遮挡|挡住)/.test(text)) markers.push('overlay');
  if (/(read|reader|content|chapter|正文|阅读)/.test(text)) markers.push('reader-content');
  if (/(mobile|phone|ios|android|手机|移动端)/.test(text)) markers.push('mobile');
  if (/(lookup|tap word|dictionary|点词|查词)/.test(text)) markers.push('lookup');
  if (/(slow|lag|jank|卡顿|缓慢)/.test(text)) markers.push('performance');
  if (/(export|download|share|导出|下载|分享)/.test(text)) markers.push('export');
  return markers;
}

function computeSummarySignature(text) {
  const markers = extractSignalMarkers(text);
  if (markers.length) {
    return uniqueStrings(markers).slice(0, 6);
  }
  return uniqueStrings(englishKeywords(text)).slice(0, 6);
}

function normalizeFingerprintInput(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9:/_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function findExistingCluster(fingerprint, existingClusters = []) {
  if (!fingerprint) return null;
  return existingClusters.find((cluster) => {
    const clusterKey = String(cluster?.fingerprint ?? cluster?.clusterKey ?? '').trim();
    return clusterKey && clusterKey === fingerprint;
  }) ?? null;
}

function buildSubmissionClusterSignals(submission, classification, semantic = {}) {
  const text = [
    submission?.content?.title,
    submission?.content?.body,
    submission?.evidence?.runtimeErrors?.[0]?.message,
    submission?.evidence?.runtimeErrors?.[0]?.fingerprint,
    submission?.appContext?.feature,
    submission?.appContext?.route,
  ].map(normalizeText).filter(Boolean).join(' ');
  const normalizedSummary = firstNonEmpty(
    semantic.normalizedSummary,
    submission?.content?.title,
    submission?.content?.body,
    classification.primaryType === CaseType.bug ? 'Bug report' : 'User feedback'
  );
  const affectedSurface = firstNonEmpty(
    semantic.affectedSurface,
    submission?.appContext?.feature,
    normalizeRoute(submission?.appContext?.route),
    submission?.appContext?.action
  );
  const problemType = semantic.problemType ?? caseTypeToProblemType(classification.primaryType);
  const clusterSignals = {
    sourceKind: normalizeSourceKind(semantic.clusterSignals?.sourceKind, 'user_feedback'),
    route: normalizeRoute(submission?.appContext?.route),
    feature: normalizeFingerprintInput(submission?.appContext?.feature),
    release: normalizeRelease(submission?.appContext?.release),
    runtimeFingerprint: normalizeFingerprintInput(submission?.evidence?.runtimeErrors?.[0]?.fingerprint),
    problemType,
    affectedSurface: normalizeFingerprintInput(affectedSurface),
    summarySignature: computeSummarySignature(`${normalizedSummary} ${text}`),
  };

  return {
    normalizedSummary,
    affectedSurface,
    clusterSignals,
  };
}

function buildSubmissionClusterFingerprintFromSignals(clusterSignals) {
  const hardSignals = [
    clusterSignals.sourceKind,
    clusterSignals.feature,
    clusterSignals.runtimeFingerprint,
    clusterSignals.problemType,
    clusterSignals.affectedSurface,
  ];
  const softSignals = [
    clusterSignals.route,
    ...(clusterSignals.summarySignature ?? []),
  ];
  return `feedback:${stableHash([...hardSignals, ...softSignals])}`;
}

function buildRuntimeEventClusterSignals(event, classification, semantic = {}) {
  const normalizedSummary = firstNonEmpty(
    semantic.normalizedSummary,
    event?.error?.type,
    event?.error?.message,
    'Runtime error'
  );
  const affectedSurface = firstNonEmpty(semantic.affectedSurface, normalizeRoute(event?.route));
  const problemType = semantic.problemType ?? caseTypeToProblemType(classification.primaryType);
  return {
    normalizedSummary,
    affectedSurface,
    clusterSignals: {
      sourceKind: normalizeSourceKind(semantic.clusterSignals?.sourceKind, 'runtime_signal'),
      route: normalizeRoute(event?.route),
      feature: '',
      release: normalizeRelease(event?.release),
      runtimeFingerprint: normalizeFingerprintInput(event?.fingerprint),
      problemType,
      affectedSurface: normalizeFingerprintInput(affectedSurface),
      summarySignature: computeSummarySignature(`${normalizedSummary} ${event?.error?.message ?? ''}`),
    },
  };
}

function buildRuntimeEventClusterFingerprintFromSignals(clusterSignals) {
  return `runtime:${stableHash([
    clusterSignals.sourceKind,
    clusterSignals.route,
    clusterSignals.release,
    clusterSignals.runtimeFingerprint,
    clusterSignals.problemType,
    clusterSignals.affectedSurface,
    ...(clusterSignals.summarySignature ?? []),
  ])}`;
}

function classifySubmission(submission) {
  const body = normalizeText(submission?.content?.body);
  const title = normalizeText(submission?.content?.title);
  const evidence = normalizeText(submission?.evidence?.runtimeErrors?.[0]?.message);
  const text = `${title} ${body} ${evidence}`;

  if (!text.trim()) {
    return { primaryType: CaseType.noise, confidence: 0 };
  }

  if (/(error|exception|trace|fail|freeze|hang|crash|500|timeout|报错|失败|卡死|超时|崩溃)/.test(text)) {
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
  const severityScore = /(crash|freeze|hang|500|timeout|data loss|cannot save|崩溃|卡死|超时)/.test(body) ? 0.8 : 0.3;
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

function heuristicSemanticFromSubmission(submission, classification, scoring, context = {}) {
  const problemType = caseTypeToProblemType(classification.primaryType);
  const actionable =
    scoring.publishRecommendation !== PublicationTarget.none &&
    scoring.actionabilityScore >= 0.5 &&
    classification.primaryType !== CaseType.noise;
  const { normalizedSummary, affectedSurface, clusterSignals } = buildSubmissionClusterSignals(submission, classification);
  const fingerprint = buildSubmissionClusterFingerprintFromSignals(clusterSignals);
  const existingCluster = findExistingCluster(fingerprint, context.existingClusters ?? []);

  return {
    triageMode: TriageModes.heuristic,
    normalizedSummary,
    problemType,
    affectedSurface,
    userImpact: '',
    evidenceUsed: collectEvidenceUsedFromSubmission(submission),
    clusterKey: fingerprint,
    clusterAction: existingCluster ? 'merge_existing' : 'new_cluster',
    clusterSizeEstimate: Math.max(1, Number(existingCluster?.submissionCount ?? existingCluster?.clusterSizeEstimate ?? 0) + 1),
    clusterSignals,
    publishRecommendation: scoring.publishRecommendation === PublicationTarget.github_issue ? 'publish' : 'hold',
    confidence: classification.confidence,
    openQuestions: [],
    suggestedLabels: normalizeSuggestedLabels(problemType, classification.confidence, existingCluster ? 2 : 1, [], {
      actionable,
      sourceLabel: 'source:user-feedback',
    }),
    suggestedNextAction: inferSuggestedNextAction(problemType),
  };
}

function heuristicSemanticFromRuntimeEvent(event, classification, scoring, context = {}) {
  const problemType = caseTypeToProblemType(classification.primaryType);
  const actionable = classification.primaryType === CaseType.bug;
  const { normalizedSummary, affectedSurface, clusterSignals } = buildRuntimeEventClusterSignals(event, classification);
  const fingerprint = buildRuntimeEventClusterFingerprintFromSignals(clusterSignals);
  const existingCluster = findExistingCluster(fingerprint, context.existingClusters ?? []);

  return {
    triageMode: TriageModes.heuristic,
    normalizedSummary,
    problemType,
    affectedSurface,
    userImpact: '',
    evidenceUsed: collectEvidenceUsedFromRuntimeEvent(event),
    clusterKey: fingerprint,
    clusterAction: existingCluster ? 'merge_existing' : 'new_cluster',
    clusterSizeEstimate: Math.max(1, Number(existingCluster?.runtimeEventCount ?? existingCluster?.clusterSizeEstimate ?? 0) + 1),
    clusterSignals,
    publishRecommendation: scoring.publishRecommendation === PublicationTarget.github_issue ? 'publish' : 'hold',
    confidence: classification.confidence,
    openQuestions: [],
    suggestedLabels: normalizeSuggestedLabels(problemType, classification.confidence, existingCluster ? 2 : 1, [], {
      actionable,
      sourceLabel: 'source:runtime-signal',
    }),
    suggestedNextAction: inferSuggestedNextAction(problemType),
  };
}

function triageSubmissionHeuristic(submission, context = {}) {
  const classification = classifySubmission(submission);
  const scoring = scoreSubmission(submission, classification);
  const actionable =
    scoring.publishRecommendation !== PublicationTarget.none &&
    scoring.actionabilityScore >= 0.5 &&
    classification.primaryType !== CaseType.noise;
  const semantic = heuristicSemanticFromSubmission(submission, classification, scoring, context);

  return {
    fingerprint: semantic.clusterKey,
    classification,
    scoring: {
      ...scoring,
      duplicateConfidence: semantic.clusterSizeEstimate > 1 ? 0.7 : scoring.duplicateConfidence,
    },
    actionable,
    canonicalTitle: semantic.normalizedSummary,
    canonicalSummary: firstNonEmpty(submission?.content?.body, semantic.normalizedSummary),
    semantic,
  };
}

function triageRuntimeEventHeuristic(event, context = {}) {
  const errorType = normalizeText(event?.error?.type);
  const errorMessage = normalizeText(event?.error?.message);
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
  const semantic = heuristicSemanticFromRuntimeEvent(event, classification, scoring, context);

  return {
    fingerprint: semantic.clusterKey,
    classification,
    scoring: {
      ...scoring,
      duplicateConfidence: semantic.clusterSizeEstimate > 1 ? 0.78 : scoring.duplicateConfidence,
    },
    actionable,
    canonicalTitle: semantic.normalizedSummary,
    canonicalSummary: firstNonEmpty(event?.error?.message, semantic.normalizedSummary),
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
  const triageMode = String(readField(input, 'triageMode', 'triage_mode') ?? TriageModes.llm).trim();
  const confidenceValue = Number(readField(input, 'confidence'));
  const clusterSizeEstimateValue = Number(readField(input, 'clusterSizeEstimate', 'cluster_size_estimate'));
  const evidenceUsed = readField(input, 'evidenceUsed', 'evidence_used');
  const openQuestions = readField(input, 'openQuestions', 'open_questions');
  const suggestedLabels = readField(input, 'suggestedLabels', 'suggested_labels');
  const clusterSignals = readField(input, 'clusterSignals', 'cluster_signals');

  if (!normalizedSummary) return null;
  if (!['bug', 'ux', 'feature', 'support', 'noise'].includes(problemType)) return null;
  if (!['new_cluster', 'merge_existing'].includes(clusterAction)) return null;
  if (!['publish', 'hold'].includes(publishRecommendation)) return null;
  if (!['investigate', 'fix', 'reply', 'ignore'].includes(suggestedNextAction)) return null;
  if (!Number.isFinite(confidenceValue) || confidenceValue < 0 || confidenceValue > 1) return null;
  if (!Number.isFinite(clusterSizeEstimateValue) || clusterSizeEstimateValue < 1) return null;
  if (!Array.isArray(evidenceUsed) || !Array.isArray(openQuestions) || !Array.isArray(suggestedLabels)) return null;
  if (clusterSignals !== undefined && (typeof clusterSignals !== 'object' || Array.isArray(clusterSignals) || !clusterSignals)) return null;

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
    clusterSignals: clusterSignals ?? {},
    publishRecommendation,
    confidence: confidenceValue,
    openQuestions: openQuestions.map((item) => String(item ?? '').trim()).filter(Boolean),
    suggestedLabels: suggestedLabels.map((item) => String(item ?? '').trim()).filter(Boolean),
    suggestedNextAction,
  };
}

function mergeSemanticIntoLegacy(base, semantic, { sourceLabel, context, signalBuilder, fingerprintBuilder }) {
  const classification = {
    ...base.classification,
    primaryType: problemTypeToCaseType(semantic.problemType),
    confidence: semantic.confidence,
  };
  const publishRecommendation =
    semantic.publishRecommendation === 'publish' ? PublicationTarget.github_issue : PublicationTarget.none;
  const actionable = publishRecommendation !== PublicationTarget.none && classification.primaryType !== CaseType.noise;
  const builtSignals = signalBuilder(classification, semantic);
  const clusterSignals = {
    ...builtSignals.clusterSignals,
    ...(semantic.clusterSignals ?? {}),
    problemType: semantic.problemType,
    affectedSurface: normalizeFingerprintInput(semantic.affectedSurface || builtSignals.affectedSurface),
  };
  const fingerprint = semantic.clusterKey || fingerprintBuilder(clusterSignals);
  const existingCluster = findExistingCluster(fingerprint, context.existingClusters ?? []);
  const clusterSizeEstimate = Math.max(
    semantic.clusterSizeEstimate,
    Number(existingCluster?.submissionCount ?? existingCluster?.runtimeEventCount ?? existingCluster?.clusterSizeEstimate ?? 0) + 1,
  );
  const semanticLabels = normalizeSuggestedLabels(
    semantic.problemType,
    semantic.confidence,
    clusterSizeEstimate,
    semantic.suggestedLabels,
    { actionable, sourceLabel }
  );

  return {
    ...base,
    fingerprint,
    classification,
    scoring: {
      ...base.scoring,
      actionabilityScore: actionable ? Math.max(base.scoring.actionabilityScore, 0.7) : Math.min(base.scoring.actionabilityScore, 0.35),
      duplicateConfidence: clusterSizeEstimate > 1 ? Math.max(base.scoring.duplicateConfidence, 0.75) : base.scoring.duplicateConfidence,
      publishRecommendation,
    },
    actionable,
    canonicalTitle: semantic.normalizedSummary,
    canonicalSummary: [semantic.normalizedSummary, semantic.userImpact].filter(Boolean).join('\n\n'),
    semantic: {
      ...semantic,
      clusterKey: fingerprint,
      clusterAction: existingCluster ? 'merge_existing' : semantic.clusterAction,
      clusterSizeEstimate,
      clusterSignals,
      suggestedLabels: semanticLabels,
    },
  };
}

function titleCaseSummary(summary, classification) {
  const text = normalizeWhitespace(summary);
  if (!text) {
    return classification?.primaryType === CaseType.bug ? 'Bug report' : 'User feedback';
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function summarizeSubmissionCluster({ submissions = [], classification, semantic }) {
  const combinedText = submissions
    .map((submission) => firstNonEmpty(submission?.content?.title, submission?.content?.body))
    .filter(Boolean)
    .join(' ');
  const normalizedText = normalizeText(combinedText);
  const userImpact = firstNonEmpty(semantic?.userImpact);

  if (/(save|保存)/.test(normalizedText) && /(freeze|hang|timeout|500|卡住|超时)/.test(normalizedText)) {
    return {
      title: 'Save flow freezes and returns a server error',
      summary: [
        'Saving content freezes the flow and returns a server error.',
        submissions.length > 1 ? `Observed across ${submissions.length} linked feedback submissions.` : '',
        userImpact,
      ].filter(Boolean).join('\n\n'),
    };
  }

  if (/(popup|overlay|弹层|弹窗|挡住|遮挡)/.test(normalizedText) && /(read|reader|content|正文|阅读)/.test(normalizedText)) {
    return {
      title: 'Reader popup blocks reading content',
      summary: [
        'A reader popup blocks reading content and interrupts continuation.',
        submissions.length > 1 ? `Observed across ${submissions.length} linked feedback submissions.` : '',
        userImpact,
      ].filter(Boolean).join('\n\n'),
    };
  }

  if (classification?.primaryType === CaseType.feature_request && /(export|导出|download|下载)/.test(normalizedText)) {
    return {
      title: 'Users request export support',
      summary: [
        'Users request export support for this workflow.',
        submissions.length > 1 ? `Observed across ${submissions.length} linked feedback submissions.` : '',
        userImpact,
      ].filter(Boolean).join('\n\n'),
    };
  }

  const baseSummary = firstNonEmpty(
    semantic?.normalizedSummary,
    submissions[0]?.content?.title,
    submissions[0]?.content?.body,
    classification?.primaryType === CaseType.bug ? 'Bug report' : 'User feedback'
  );

  return {
    title: titleCaseSummary(baseSummary, classification),
    summary: [
      baseSummary,
      submissions.length > 1 ? `Observed across ${submissions.length} linked feedback submissions.` : '',
      userImpact,
    ].filter(Boolean).join('\n\n'),
  };
}

export function synthesizeSubmissionCase({ submissions = [], classification, semantic }) {
  return summarizeSubmissionCluster({ submissions, classification, semantic });
}

export function createTriageEngine({ submissionAnalyzer, runtimeEventAnalyzer, logger = console } = {}) {
  return {
    async triageSubmission(submission, context = {}) {
      const heuristic = triageSubmissionHeuristic(submission, context);
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
          context,
          signalBuilder(classification, llmSemantic) {
            return buildSubmissionClusterSignals(submission, classification, llmSemantic);
          },
          fingerprintBuilder: buildSubmissionClusterFingerprintFromSignals,
        });
      } catch (error) {
        logger?.warn?.('SignalForge submission analyzer failed, falling back to heuristic triage.', error);
        return heuristic;
      }
    },

    async triageRuntimeEvent(event, context = {}) {
      const heuristic = triageRuntimeEventHeuristic(event, context);
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
          context,
          signalBuilder(classification, llmSemantic) {
            return buildRuntimeEventClusterSignals(event, classification, llmSemantic);
          },
          fingerprintBuilder: buildRuntimeEventClusterFingerprintFromSignals,
        });
      } catch (error) {
        logger?.warn?.('SignalForge runtime analyzer failed, falling back to heuristic triage.', error);
        return heuristic;
      }
    },
  };
}

export function triageSubmission(submission, context = {}) {
  return triageSubmissionHeuristic(submission, context);
}

export function triageRuntimeEvent(event, context = {}) {
  return triageRuntimeEventHeuristic(event, context);
}
