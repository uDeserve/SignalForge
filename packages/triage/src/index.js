import {
  CaseType,
  PublicationTarget,
} from '../../core/src/index.js';

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
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

  if (/(slow|confusing|hard to use|ux|ui|layout|button)/.test(text)) {
    return { primaryType: CaseType.ux, confidence: 0.72 };
  }

  if (/(feature|would like|wish|please add|request)/.test(text)) {
    return { primaryType: CaseType.feature_request, confidence: 0.72 };
  }

  if (/(how do i|help|support|question|can't find|cannot find)/.test(text)) {
    return { primaryType: CaseType.support, confidence: 0.65 };
  }

  return { primaryType: CaseType.noise, confidence: 0.35 };
}

function scoreSubmission(submission, classification) {
  const body = normalizeText(submission?.content?.body);
  const hasEvidence = Boolean(
    submission?.evidence?.screenshotUrls?.length ||
      submission?.evidence?.recordingUrls?.length ||
      submission?.evidence?.consoleLogs?.length ||
      submission?.evidence?.runtimeErrors?.length,
  );

  const actionabilityScore = classification.primaryType === CaseType.bug || hasEvidence ? 0.85 : 0.35;
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

export function triageSubmission(submission) {
  const classification = classifySubmission(submission);
  const scoring = scoreSubmission(submission, classification);
  const fingerprint = fingerprintSubmission(submission);
  const actionable =
    scoring.publishRecommendation !== PublicationTarget.none &&
    scoring.actionabilityScore >= 0.5 &&
    classification.primaryType !== CaseType.noise;

  return {
    fingerprint,
    classification,
    scoring,
    actionable,
    canonicalTitle:
      submission?.content?.title?.trim() ||
      (classification.primaryType === CaseType.bug ? 'Bug report' : 'User feedback'),
    canonicalSummary: submission?.content?.body?.trim() || '',
  };
}

export function triageRuntimeEvent(event) {
  const errorType = normalizeText(event?.error?.type);
  const errorMessage = normalizeText(event?.error?.message);
  const fingerprint = fingerprintRuntimeEvent(event);
  const text = `${errorType} ${errorMessage} ${normalizeText(event?.route)}`;
  const classification = /(error|exception|timeout|crash|fail|500|429|hang)/.test(text)
    ? { primaryType: CaseType.bug, confidence: 0.92 }
    : { primaryType: CaseType.noise, confidence: 0.25 };
  const severityScore = /(timeout|crash|500|cannot|unhandled|fatal)/.test(text) ? 0.82 : 0.45;
  const actionable = classification.primaryType === CaseType.bug;

  return {
    fingerprint,
    classification,
    scoring: {
      actionabilityScore: actionable ? 0.9 : 0.2,
      severityScore,
      duplicateConfidence: 0.4,
      publishRecommendation: actionable ? PublicationTarget.github_issue : PublicationTarget.none,
    },
    actionable,
    canonicalTitle: event?.error?.type?.trim() || 'Runtime error',
    canonicalSummary: event?.error?.message?.trim() || 'Runtime failure detected.',
  };
}
