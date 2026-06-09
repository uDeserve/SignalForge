import fs from 'node:fs';
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
  getGitHubAppInstallationForRepo,
  parseOwnerCommand,
} from '../../../packages/github-bridge/src/index.js';
import { DelegationKind, DelegationStatus } from '../../../packages/core/src/index.js';
import { evaluateSetupStatus } from '../../../packages/shared-config/src/index.js';

const DEFAULT_POLICY = Object.freeze({
  publishBias: 'lenient',
  privacyMode: 'strict',
});

function readHeader(headers = {}, key) {
  const target = key.toLowerCase();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (String(name).toLowerCase() === target) return String(value ?? '').trim();
  }
  return '';
}

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
    projectKey: target.searchParams.get('projectKey') ?? '',
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

function slugifyProjectName(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project';
}

function buildProjectKey(slug) {
  return `proj_${slug.replace(/-/g, '_')}_${randomUUID().slice(0, 8)}`;
}

function buildBindingCode() {
  return `sfbind_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

function normalizeProjectRepo(repo = {}) {
  if (typeof repo === 'string') {
    const fullName = repo.trim().replace(/^https:\/\/github\.com\//i, '').replace(/^github\.com\//i, '');
    const [owner = '', name = ''] = fullName.split('/').map((part) => String(part ?? '').trim()).filter(Boolean);
    return {
      owner,
      name,
      fullName: owner && name ? `${owner}/${name}` : fullName,
    };
  }
  const owner = String(repo.owner ?? '').trim();
  const name = String(repo.name ?? '').trim();
  const fullName = firstNonEmpty(repo.fullName, owner && name ? `${owner}/${name}` : '');
  return {
    owner,
    name,
    fullName,
  };
}

function namespaceFingerprint(projectKey, fingerprint) {
  const resolvedProjectKey = String(projectKey ?? '').trim();
  if (!resolvedProjectKey) return fingerprint;
  return `${resolvedProjectKey}::${fingerprint}`;
}

function projectRepoToSuggestedRepo(project) {
  return firstNonEmpty(project?.repo?.fullName, project?.metadata?.github?.repo);
}

function buildProjectResponse(project, publicBaseUrl) {
  return {
    ...project,
    github: {
      repo: projectRepoToSuggestedRepo(project),
      ...(project.metadata?.github ?? {}),
    },
    hosted: {
      endpoint: publicBaseUrl,
      projectKeyHeader: 'X-SignalForge-Project-Key',
      clientConfig: {
        endpoint: publicBaseUrl,
        projectKey: project.projectKey,
        appName: project.appName,
      },
      env: {
        VITE_SIGNALFORGE_ENDPOINT: publicBaseUrl,
        VITE_SIGNALFORGE_PROJECT_KEY: project.projectKey,
        VITE_SIGNALFORGE_APP_NAME: project.appName,
      },
    },
  };
}

function withProjectGitHubConnection(project, connection) {
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    metadata: {
      ...(project.metadata ?? {}),
      github: {
        ...(project.metadata?.github ?? {}),
        repo: connection.repo || projectRepoToSuggestedRepo(project),
        connected: Boolean(connection.connected),
        canPublish: Boolean(connection.canPublish),
        status: connection.status,
        installationConnected: Boolean(connection.connected),
        installationId: connection.installation?.installationId ?? '',
        appSlug: connection.installation?.appSlug ?? '',
        permissionsOk: Boolean(connection.installation?.hasRequiredPermissions),
        eventsOk: Boolean(connection.installation?.hasRequiredEvents),
        lastCheckedAt: new Date().toISOString(),
        error: connection.error ?? '',
      },
    },
  };
}

function buildGitHubAppInstallUrl(env, sessionId = '') {
  const explicit = firstNonEmpty(env.SIGNALFORGE_GITHUB_APP_INSTALL_URL);
  const slug = firstNonEmpty(env.GITHUB_APP_SLUG, env.SIGNALFORGE_GITHUB_APP_SLUG);
  const raw = explicit || (slug ? `https://github.com/apps/${slug}/installations/new` : '');
  if (!raw) return '';
  if (!sessionId) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.set('signalforge_session', sessionId);
    return url.toString();
  } catch {
    return raw;
  }
}

function createHostedProjectRecord(store, body = {}) {
  const now = new Date().toISOString();
  const name = firstNonEmpty(body?.name, body?.appName, 'SignalForge Project');
  const baseSlug = slugifyProjectName(name);
  let slug = baseSlug;
  let suffix = 2;
  while (store.getProjectBySlug(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  return store.saveProject({
    id: `proj_${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    name,
    slug,
    projectKey: buildProjectKey(slug),
    appName: firstNonEmpty(body?.appName, slug.replace(/-/g, '_'), 'webapp'),
    repo: normalizeProjectRepo(body?.repo ?? {}),
    status: 'active',
    metadata: {
      source: 'hosted_onboarding',
      github: {
        repo: normalizeProjectRepo(body?.repo ?? {}).fullName,
        installationConnected: false,
      },
    },
  });
}

function buildSetupSessionState({
  session,
  project,
  connection,
  store,
  publicBaseUrl,
  env,
}) {
  const projectKey = project.projectKey;
  const repo = projectRepoToSuggestedRepo(project);
  const submissions = store.listSubmissions({ projectKey });
  const cases = store.listCases({ projectKey });
  const publishedCases = store.listCases({ projectKey, published: true });
  const installUrl = buildGitHubAppInstallUrl(env, session.id);
  const githubBinding = session.metadata?.githubBinding ?? {};
  const bindingCode = firstNonEmpty(githubBinding.bindingCode);
  const bindingConfirmed = Boolean(githubBinding.confirmedAt);
  const bindingRepo = firstNonEmpty(githubBinding.repo, repo);
  const bindingInstallationId = firstNonEmpty(
    githubBinding.installationId,
    connection.installation?.installationId,
  );
  const githubInstalled = Boolean(connection.connected);
  const permissionsOk = Boolean(connection.installation?.hasRequiredPermissions);
  const eventsOk = Boolean(connection.installation?.hasRequiredEvents);
  const firstSubmissionSeen = submissions.length > 0;
  const firstCaseCreated = cases.length > 0;
  const firstIssuePublished = publishedCases.length > 0;
  const latestPublishedCase = publishedCases[0] ?? null;
  const latestPublication = latestPublishedCase?.publication?.primaryPublicationId
    ? store.getPublication(latestPublishedCase.publication.primaryPublicationId)
    : latestPublishedCase
      ? store.listPublications(latestPublishedCase.id)[0] ?? null
      : null;

  let currentStage = 'project_created';
  if (!githubInstalled && !bindingConfirmed) currentStage = 'awaiting_github_app_install';
  else if (!bindingConfirmed) currentStage = 'awaiting_install_binding_confirmation';
  else if (!githubInstalled) currentStage = 'awaiting_github_app_install';
  else if (!permissionsOk || !eventsOk) currentStage = 'awaiting_github_app_configuration';
  else if (!firstSubmissionSeen) currentStage = 'awaiting_first_submission';
  else if (!firstCaseCreated) currentStage = 'awaiting_first_case';
  else if (!firstIssuePublished) currentStage = 'ready_for_first_publish';
  else currentStage = 'live';

  const blockingHumanAction = !githubInstalled && !bindingConfirmed
    ? {
        type: 'github_app_install',
        required: true,
        title: 'Install the GitHub App',
        description: bindingRepo
        ? `Install the FeedbackMesh GitHub App into ${bindingRepo}, then refresh the setup session. If auto-detection does not complete, confirm with binding code ${bindingCode}.`
        : `Install the FeedbackMesh GitHub App into the target repository, then refresh the setup session. If auto-detection does not complete, confirm with binding code ${bindingCode}.`,
        url: installUrl,
      }
    : !bindingConfirmed
      ? {
          type: 'github_install_binding_confirmation',
          required: true,
          title: 'Confirm the installed repository binding',
          description: bindingRepo
            ? `Confirm that ${bindingRepo} is the repository installed with binding code ${bindingCode}.`
            : `Confirm the installed repository with binding code ${bindingCode}.`,
          url: `${publicBaseUrl}/setup/sessions/${session.id}/github-binding`,
        }
    : !permissionsOk || !eventsOk
      ? {
          type: 'github_app_permissions',
          required: true,
          title: 'Fix GitHub App permissions or events',
          description: 'The GitHub App is installed, but required issue permissions or webhook events are still missing.',
          url: installUrl,
        }
      : null;

  return {
    currentStage,
    stages: {
      project_created: true,
      project_key_issued: true,
      binding_code_issued: Boolean(bindingCode),
      install_binding_confirmed: bindingConfirmed,
      github_app_installed: githubInstalled,
      permissions_ok: permissionsOk,
      events_ok: eventsOk,
      ingestion_ready: bindingConfirmed && githubInstalled && permissionsOk && eventsOk,
      first_submission_seen: firstSubmissionSeen,
      first_case_created: firstCaseCreated,
      first_issue_published: firstIssuePublished,
    },
    counters: {
      submissions: submissions.length,
      cases: cases.length,
      publishedCases: publishedCases.length,
    },
    installUrl,
    blockingHumanAction,
    binding: {
      code: bindingCode,
      confirmed: bindingConfirmed,
      repo: bindingRepo,
      installationId: bindingInstallationId,
      confirmUrl: `${publicBaseUrl}/setup/sessions/${session.id}/github-binding`,
      refreshCodeUrl: `${publicBaseUrl}/setup/sessions/${session.id}/binding-code/refresh`,
    },
    envPatch: {
      VITE_SIGNALFORGE_ENDPOINT: publicBaseUrl,
      VITE_SIGNALFORGE_PROJECT_KEY: project.projectKey,
      VITE_SIGNALFORGE_APP_NAME: project.appName,
    },
    headers: {
      'X-SignalForge-Project-Key': project.projectKey,
    },
    api: {
      endpoint: publicBaseUrl,
      submissionUrl: `${publicBaseUrl}/submissions`,
      runtimeEventsUrl: `${publicBaseUrl}/runtime-events`,
      casesUrl: `${publicBaseUrl}/cases?projectKey=${project.projectKey}`,
      statusUrl: `${publicBaseUrl}/setup/sessions/${session.id}`,
      agentContractUrl: `${publicBaseUrl}/setup/sessions/${session.id}/agent-contract`,
      githubBindingConfirmUrl: `${publicBaseUrl}/setup/sessions/${session.id}/github-binding`,
      githubBindingCodeRefreshUrl: `${publicBaseUrl}/setup/sessions/${session.id}/binding-code/refresh`,
    },
    verify: {
      nextAgentAction:
        !githubInstalled && !bindingConfirmed
          ? 'wait_for_human_github_install_then_poll_setup_session'
          : !bindingConfirmed
            ? 'confirm_github_install_binding'
            : !githubInstalled
              ? 'wait_for_human_github_install'
          : !firstSubmissionSeen
            ? 'patch_target_app_and_send_first_submission'
            : !firstCaseCreated
              ? 'run_triage_for_first_submission'
              : !firstIssuePublished
                ? 'verify_publish_flow'
                : 'monitor_live_project',
      publish:
        firstIssuePublished && latestPublication
          ? {
              status: 'published',
              alreadyPublished: true,
              caseId: latestPublishedCase?.id ?? '',
              publicationId: latestPublication.id,
              repo: latestPublication.target?.repo ?? '',
              issueUrl: latestPublication.result?.url ?? '',
              issueNumber: latestPublication.result?.number ?? null,
            }
          : {
              status: firstCaseCreated ? 'pending' : 'not_ready',
              alreadyPublished: false,
              caseId: firstCaseCreated ? cases[0]?.id ?? '' : '',
              publicationId: '',
              repo: bindingRepo,
              issueUrl: '',
              issueNumber: null,
            },
      recommendedSubmission: {
        source: 'adapter',
        content: {
          title: '[SignalForge Setup] First feedback signal',
          body: 'This first signal verifies that the app can reach the hosted SignalForge project.',
          categoryHint: 'feedback',
        },
      },
    },
  };
}

async function refreshSetupSessionRecord({
  session,
  store,
  publicBaseUrl,
  env,
  inspectProjectGitHubConnection,
}) {
  const project = store.getProjectById(session.projectId);
  if (!project) return null;
  const connection = await inspectProjectGitHubConnection(project);
  let updatedProject = store.saveProject(withProjectGitHubConnection(project, connection));
  let updatedSession = session;

  const existingBinding = session.metadata?.githubBinding ?? {};
  const bindingConfirmed = Boolean(existingBinding.confirmedAt);
  const autoBindingRepo = normalizeProjectRepo(
    existingBinding.repo ?? session.target?.repo ?? updatedProject.repo ?? {},
  );

  if (!bindingConfirmed && connection.connected && autoBindingRepo.fullName) {
    const now = new Date().toISOString();
    const installationId = firstNonEmpty(
      connection.installation?.installationId,
      existingBinding.installationId,
    );
    updatedProject = store.saveProject({
      ...updatedProject,
      updatedAt: now,
      repo: autoBindingRepo,
      metadata: {
        ...(updatedProject.metadata ?? {}),
        github: {
          ...(updatedProject.metadata?.github ?? {}),
          repo: autoBindingRepo.fullName,
          bindingStatus: 'confirmed',
          bindingConfirmedAt: now,
          bindingCodeLastConfirmed: firstNonEmpty(existingBinding.bindingCode),
          boundBySetupSessionId: session.id,
          autoConfirmed: true,
          autoConfirmedAt: now,
          ...(installationId ? { installationId } : {}),
        },
      },
    });
    updatedSession = store.saveSetupSession({
      ...session,
      updatedAt: now,
      target: {
        ...(session.target ?? {}),
        repo: autoBindingRepo,
      },
      metadata: {
        ...(session.metadata ?? {}),
        githubBinding: {
          ...existingBinding,
          bindingCode: firstNonEmpty(existingBinding.bindingCode),
          repo: autoBindingRepo.fullName,
          confirmedAt: now,
          status: 'confirmed',
          autoConfirmed: true,
          autoConfirmedAt: now,
          ...(installationId ? { installationId } : {}),
          confirmedBy: { type: 'system', id: 'signalforge' },
        },
      },
    });
  }

  const nextState = buildSetupSessionState({
    session: updatedSession,
    project: updatedProject,
    connection,
    store,
    publicBaseUrl,
    env,
  });
  const nextStatus = nextState.currentStage === 'live' ? 'ready' : 'active';
  return store.saveSetupSession({
    ...updatedSession,
    updatedAt: new Date().toISOString(),
    state: nextState,
    status: nextStatus,
      metadata: {
        ...(updatedSession.metadata ?? {}),
        projectKey: updatedProject.projectKey,
      },
    });
}

async function confirmSetupSessionGitHubBinding({
  session,
  body,
  store,
  publicBaseUrl,
  env,
  inspectProjectGitHubConnection,
}) {
  const expectedBindingCode = firstNonEmpty(session.metadata?.githubBinding?.bindingCode);
  const providedBindingCode = firstNonEmpty(body?.bindingCode);
  if (!expectedBindingCode || providedBindingCode !== expectedBindingCode) {
    return {
      statusCode: 422,
      error: {
        code: 'invalid_binding_code',
        message: 'bindingCode does not match this setup session',
      },
    };
  }

  const project = store.getProjectById(session.projectId);
  if (!project) {
    return {
      statusCode: 404,
      error: { code: 'not_found', message: 'setup session project not found' },
    };
  }

  const resolvedRepo = normalizeProjectRepo(
    body?.repo ?? body?.repository ?? session.target?.repo ?? project.repo ?? {},
  );
  if (!resolvedRepo.fullName) {
    return {
      statusCode: 422,
      error: {
        code: 'missing_repo',
        message: 'repo is required to confirm the GitHub App binding',
      },
    };
  }

  const now = new Date().toISOString();
  const installationId = firstNonEmpty(body?.installationId);
  store.saveProject({
    ...project,
    updatedAt: now,
    repo: resolvedRepo,
    metadata: {
      ...(project.metadata ?? {}),
      github: {
        ...(project.metadata?.github ?? {}),
        repo: resolvedRepo.fullName,
        bindingStatus: 'confirmed',
        bindingConfirmedAt: now,
        bindingCodeLastConfirmed: expectedBindingCode,
        boundBySetupSessionId: session.id,
        ...(installationId ? { installationId } : {}),
      },
    },
  });

  const updatedSession = store.saveSetupSession({
    ...session,
    updatedAt: now,
    target: {
      ...(session.target ?? {}),
      repo: resolvedRepo,
    },
    metadata: {
      ...(session.metadata ?? {}),
      githubBinding: {
        ...(session.metadata?.githubBinding ?? {}),
        bindingCode: expectedBindingCode,
        repo: resolvedRepo.fullName,
        confirmedAt: now,
        status: 'confirmed',
        ...(installationId ? { installationId } : {}),
        confirmedBy: body?.actor ?? session.actor ?? { type: 'agent', id: 'agent' },
      },
    },
  });

  const refreshed = await refreshSetupSessionRecord({
    session: updatedSession,
    store,
    publicBaseUrl,
    env,
    inspectProjectGitHubConnection,
  });
  return refreshed;
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

function buildSubmissionCaseRecord({ triaged, submission, existingCase, store, defaultSuggestedRepo }) {
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
  const project = submission.raw?.signalforgeProject ?? existingCase?.metadata?.project ?? null;
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
      suggestedRepo: existingCase?.decisionReadiness?.suggestedRepo ?? defaultSuggestedRepo,
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
      project,
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

function createCaseRecordFromRuntimeEvent(event, triaged, defaultSuggestedRepo) {
  const now = new Date().toISOString();
  const project = event.raw?.signalforgeProject ?? null;
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
      suggestedRepo: defaultSuggestedRepo,
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
      project,
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
    project: caseRecord.metadata?.project ?? null,
    clustering: caseRecord.clustering,
    decisionReadiness: caseRecord.decisionReadiness,
    evidenceSummary: caseRecord.evidenceSummary,
    metadata: caseRecord.metadata,
    updatedAt: caseRecord.updatedAt,
  };
}

function buildVerifySubmissionPayload() {
  return {
    source: 'signalforge_verify',
    reporter: {
      id: 'signalforge_verify_user',
    },
    appContext: {
      appName: 'readerapp',
      environment: 'staging',
      release: 'signalforge-verify',
      route: '/reader/verify',
      feature: 'signalforge_verify',
      action: 'submit_feedback',
      sourceType: 'verify_flow',
      feedbackType: 'reader',
    },
    content: {
      title: '[SignalForge Verify] Reader feedback should become a case',
      body: 'This is a SignalForge verify submission. The reader popup blocks content and should become a case, then publish if GitHub is connected.',
      categoryHint: 'feedback',
      rating: 'bad',
      sentimentHint: 'negative',
      language: 'en',
    },
    evidence: {
      reproduction: 'Open reader, tap a word, popup blocks content.',
    },
    privacy: {
      containsPii: false,
      redactionStatus: 'pending',
    },
    raw: {
      source: 'signalforge_verify_flow',
    },
  };
}

export function createSignalForgeApi({
  store = createStore(),
  logger = console,
  triageEngine = createTriageEngine({ logger }),
  githubPublisher = createPreviewGitHubPublisher(),
  env = process.env,
  repoRoot = fileURLToPath(new URL('../../..', import.meta.url)),
  fetchImpl = globalThis.fetch,
} = {}) {
  const defaultSuggestedRepo = String(env.SIGNALFORGE_E2E_REPO ?? 'org/repo').trim() || 'org/repo';
  const publicBaseUrl = firstNonEmpty(env.SIGNALFORGE_PUBLIC_BASE_URL, 'http://localhost:8787');

  function resolveProjectFromHeaders(headers = {}) {
    const projectKey = readHeader(headers, 'x-signalforge-project-key');
    if (!projectKey) return null;
    return store.getProjectByKey(projectKey) ?? null;
  }

  function requireProjectKey() {
    return String(env.SIGNALFORGE_HOSTED_MODE ?? '').trim().toLowerCase() === 'true' || store.listProjects().length > 0;
  }

  async function inspectProjectGitHubConnection(project) {
    const repo = projectRepoToSuggestedRepo(project);
    if (!repo) {
      return {
        connected: false,
        canPublish: false,
        status: 'repo_missing',
        repo: '',
        installation: null,
      };
    }

    const appId = String(env.GITHUB_APP_ID ?? '').trim();
    const privateKeyPem = String(env.GITHUB_APP_PRIVATE_KEY ?? '').trim();
    const apiBaseUrl = String(env.GITHUB_API_BASE_URL ?? 'https://api.github.com').trim();

    if (!appId || !privateKeyPem) {
      return {
        connected: false,
        canPublish: false,
        status: 'app_auth_missing',
        repo,
        installation: null,
      };
    }

    try {
      const installation = await getGitHubAppInstallationForRepo({
        appId,
        privateKeyPem,
        repo,
        apiBaseUrl,
        fetchImpl,
      });
      if (!installation) {
        return {
          connected: false,
          canPublish: false,
          status: 'not_installed',
          repo,
          installation: null,
        };
      }
      return {
        connected: true,
        canPublish: Boolean(installation.hasRequiredPermissions),
        status: installation.hasRequiredPermissions && installation.hasRequiredEvents ? 'ready' : 'installed_with_gaps',
        repo,
        installation,
      };
    } catch (error) {
      return {
        connected: false,
        canPublish: false,
        status: 'check_failed',
        repo,
        installation: null,
        error: String(error?.message ?? error),
      };
    }
  }

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

  async function triageAndUpsertSubmission(
    submission,
    {
      autoPublish = true,
      defaultSuggestedRepoOverride = '',
      project = null,
    } = {},
  ) {
    const scopedProjectKey = project?.projectKey ?? submission.raw?.signalforgeProject?.projectKey ?? '';
    const existingClusters = buildExistingClusterHints(
      store.listCases({
        projectKey: scopedProjectKey || undefined,
      })
    );
    const triaged = await triageEngine.triageSubmission(submission, {
      requestId: `triage_${submission.id}`,
      policy: DEFAULT_POLICY,
      existingClusters,
    });
    const namespacedFingerprint = namespaceFingerprint(scopedProjectKey, triaged.fingerprint);
    const existingCase = store.findCaseByFingerprint(namespacedFingerprint);
    const caseRecord = buildSubmissionCaseRecord({
      triaged: {
        ...triaged,
        fingerprint: namespacedFingerprint,
      },
      submission,
      existingCase,
      store,
      defaultSuggestedRepo:
        defaultSuggestedRepoOverride ||
        projectRepoToSuggestedRepo(project) ||
        defaultSuggestedRepo,
    });
    const storedCase = store.upsertCase(caseRecord, caseRecord.clustering.fingerprint);
    return autoPublish ? maybeAutoPublish(storedCase) : storedCase;
  }

  async function handleRuntimeEvent(event, { project = null } = {}) {
    const scopedProjectKey = project?.projectKey ?? event.raw?.signalforgeProject?.projectKey ?? '';
    const triaged = await triageEngine.triageRuntimeEvent(event, {
      requestId: `triage_${event.id}`,
      policy: DEFAULT_POLICY,
      existingClusters: buildExistingClusterHints(
        store.listCases({
          projectKey: scopedProjectKey || undefined,
        })
      ),
    });
    const namespacedFingerprint = namespaceFingerprint(scopedProjectKey, triaged.fingerprint);
    const existingCase = namespacedFingerprint ? store.findCaseByFingerprint(namespacedFingerprint) : null;
    const storedCase = existingCase
      ? store.upsertCase(enrichCaseWithRuntimeEvent(existingCase, event), existingCase.clustering.fingerprint)
      : store.upsertCase(
          createCaseRecordFromRuntimeEvent(
            event,
            {
              ...triaged,
              fingerprint: namespacedFingerprint,
            },
            projectRepoToSuggestedRepo(project) || defaultSuggestedRepo
          ),
          namespacedFingerprint
        );
    return maybeAutoPublish(storedCase);
  }

  async function runVerification(target = {}) {
    const setup = await evaluateSetupStatus({
      env,
      repoRoot,
      fileSystem: fs,
    });
    const verifySubmission = buildVerifySubmissionPayload();
    const submission = createSubmission({
      id: `sub_${randomUUID()}`,
      submittedAt: new Date().toISOString(),
      source: verifySubmission.source,
      reporter: verifySubmission.reporter,
      appContext: verifySubmission.appContext,
      content: verifySubmission.content,
      evidence: verifySubmission.evidence,
      privacy: verifySubmission.privacy,
      raw: verifySubmission.raw,
    });
    store.saveSubmission(submission);
    const storedCase = await triageAndUpsertSubmission(submission, {
      autoPublish: false,
      defaultSuggestedRepoOverride: target.repo ?? '',
    });
    const resolvedRepo =
      target.repo ??
      storedCase.decisionReadiness?.suggestedRepo ??
      setup.githubAppConnection?.installation?.repo ??
      setup.e2eRepo ??
      'org/repo';

    let publish = {
      attempted: false,
      ok: false,
      repo: resolvedRepo,
      skippedReason: '',
      result: null,
    };

    if (storedCase.publication?.published) {
      const publication = storedCase.publication?.primaryPublicationId
        ? store.getPublication(storedCase.publication.primaryPublicationId)
        : store.listPublications(storedCase.id)[0] ?? null;
      publish = {
        attempted: true,
        ok: true,
        repo: resolvedRepo,
        skippedReason: '',
        result: publication?.result ?? null,
      };
    } else if (
      setup.publisherMode !== 'preview' &&
      !setup.setupStages.publishTestReady
    ) {
      publish = {
        attempted: false,
        ok: false,
        repo: resolvedRepo,
        skippedReason: 'publish_not_ready',
        result: null,
      };
    } else if (!storedCase.decisionReadiness?.actionable) {
      publish = {
        attempted: false,
        ok: false,
        repo: resolvedRepo,
        skippedReason: 'case_not_actionable',
        result: null,
      };
    } else {
      try {
        const published = await githubPublisher.publishCase({
          caseRecord: storedCase,
          repo: resolvedRepo,
          mode: PublicationTarget.github_issue,
          publicRepo: true,
        });
        const publication = createIssuePublication(storedCase, {
          repo: published.repo,
          mode: published.mode,
          externalId: published.result.externalId,
          url: published.result.url,
          number: published.result.number,
        });
        const savedPublication = store.savePublication({
          ...publication,
          snapshot: published.snapshot,
        });
        store.upsertCase({
          ...storedCase,
          status: CaseStatus.published,
          publication: {
            ...storedCase.publication,
            published: true,
            target: publication.target.mode,
            primaryPublicationId: savedPublication.id,
          },
          updatedAt: new Date().toISOString(),
        }, storedCase.clustering.fingerprint);
        publish = {
          attempted: true,
          ok: true,
          repo: published.repo,
          skippedReason: '',
          result: savedPublication.result,
        };
      } catch (error) {
        publish = {
          attempted: true,
          ok: false,
          repo: resolvedRepo,
          skippedReason: '',
          result: {
            error: String(error?.message ?? error),
          },
        };
      }
    }

    return {
      schemaVersion: 1,
      setup,
      submission: {
        accepted: true,
        submissionId: submission.id,
      },
      triage: {
        caseId: storedCase.id,
        caseStatus: store.getCase(storedCase.id)?.status ?? storedCase.status,
        actionable: Boolean(storedCase.decisionReadiness?.actionable),
        publishPolicyOutcome: storedCase.decisionReadiness?.publishPolicyOutcome ?? 'hold_and_watch',
      },
      publish,
      decisionSync: {
        ready: Boolean(setup.setupStages.decisionSyncReady),
        mode: setup.publisherMode === 'app' ? 'github_issue_comment_webhook' : 'not_app_mode',
        nextStep:
          setup.publisherMode === 'app'
            ? publish.ok
              ? 'Leave a maintainer comment such as /defer on the published GitHub issue to verify decision sync.'
              : 'Finish publish verification first, then verify decision sync with a GitHub issue comment.'
            : 'Decision sync verification requires GitHub App mode.',
      },
    };
  }

  async function createSetupSession(body = {}) {
    const project = createHostedProjectRecord(store, body);
    const now = new Date().toISOString();
    const session = store.saveSetupSession({
      id: `setup_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      projectId: project.id,
      actor: body.actor ?? {
        type: 'agent',
        id: firstNonEmpty(body.actor?.id, 'agent'),
      },
      target: {
        repo: normalizeProjectRepo(body.repo ?? {}),
        appName: project.appName,
      },
      state: {},
      status: 'active',
      metadata: {
        source: 'agent_first_onboarding',
        projectKey: project.projectKey,
        githubBinding: {
          bindingCode: buildBindingCode(),
          issuedAt: now,
          status: 'issued',
          repo: normalizeProjectRepo(body.repo ?? {}).fullName,
        },
      },
    });
    return refreshSetupSessionRecord({
      session,
      store,
      publicBaseUrl,
      env,
      inspectProjectGitHubConnection,
    });
  }

  function buildSetupSessionResponse(session) {
    const project = store.getProjectById(session.projectId);
    return {
      id: session.id,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      actor: session.actor,
      target: session.target,
      project: project ? buildProjectResponse(project, publicBaseUrl) : null,
      state: session.state,
    };
  }

  function buildSetupSessionAgentContract(session) {
    const response = buildSetupSessionResponse(session);
    return {
      schemaVersion: 1,
      product: 'FeedbackMesh',
      objective: 'Connect a web app to hosted FeedbackMesh with the minimum possible human action.',
      mode: 'agent_first_hosted_onboarding',
      setupSession: response,
      instructions: {
        blockingHumanAction: response.state.blockingHumanAction,
        nextAgentAction: response.state.verify?.nextAgentAction ?? 'poll_setup_session',
        installUrl: response.state.installUrl,
        binding: response.state.binding ?? {},
        publish: response.state.verify?.publish ?? {},
      },
      machineConfig: {
        endpoint: response.project?.hosted?.endpoint ?? publicBaseUrl,
        projectKey: response.project?.projectKey ?? '',
        appName: response.project?.appName ?? '',
        headerName: 'X-SignalForge-Project-Key',
        envPatch: response.state.envPatch ?? {},
      },
      api: response.state.api ?? {},
      binding: response.state.binding ?? {},
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

  async function handleRequest({ method, url, body, headers = {} }) {
    try {
      const project = resolveProjectFromHeaders(headers);

      if (method === 'GET' && url === '/health') {
        return { statusCode: 200, body: { ok: true } };
      }

      if (method === 'POST' && url === '/setup/sessions') {
        const session = await createSetupSession(body ?? {});
        return { statusCode: 201, body: buildSetupSessionResponse(session) };
      }

      if (method === 'GET' && url?.startsWith('/setup/sessions/')) {
        const route = new URL(url, 'http://signalforge.local');
        const sessionId = route.pathname.split('/')[3];
        const subroute = route.pathname.split('/').slice(4).join('/');
        const existing = store.getSetupSession(sessionId);
        if (!existing) {
          return { statusCode: 404, error: { code: 'not_found', message: 'setup session not found' } };
        }
        const refreshed = await refreshSetupSessionRecord({
          session: existing,
          store,
          publicBaseUrl,
          env,
          inspectProjectGitHubConnection,
        });
        if (!refreshed) {
          return { statusCode: 404, error: { code: 'not_found', message: 'setup session project not found' } };
        }
        if (!subroute) {
          return { statusCode: 200, body: buildSetupSessionResponse(refreshed) };
        }
        if (subroute === 'agent-contract') {
          return { statusCode: 200, body: buildSetupSessionAgentContract(refreshed) };
        }
      }

      if (method === 'POST' && url?.startsWith('/setup/sessions/')) {
        const route = new URL(url, 'http://signalforge.local');
        const sessionId = route.pathname.split('/')[3];
        const subroute = route.pathname.split('/').slice(4).join('/');
        const existing = store.getSetupSession(sessionId);
        if (!existing) {
          return { statusCode: 404, error: { code: 'not_found', message: 'setup session not found' } };
        }
        if (subroute === 'binding-code/refresh') {
          const now = new Date().toISOString();
          const refreshedSession = store.saveSetupSession({
            ...existing,
            updatedAt: now,
            metadata: {
              ...(existing.metadata ?? {}),
              githubBinding: {
                ...(existing.metadata?.githubBinding ?? {}),
                bindingCode: buildBindingCode(),
                issuedAt: now,
                confirmedAt: '',
                status: 'issued',
              },
            },
          });
          const refreshed = await refreshSetupSessionRecord({
            session: refreshedSession,
            store,
            publicBaseUrl,
            env,
            inspectProjectGitHubConnection,
          });
          return { statusCode: 200, body: buildSetupSessionResponse(refreshed) };
        }
        if (subroute === 'github-binding') {
          const refreshed = await confirmSetupSessionGitHubBinding({
            session: existing,
            body: body ?? {},
            store,
            publicBaseUrl,
            env,
            inspectProjectGitHubConnection,
          });
          if (refreshed?.statusCode) return refreshed;
          return { statusCode: 200, body: buildSetupSessionResponse(refreshed) };
        }
      }

      if (method === 'POST' && url === '/projects') {
        const createdProject = createHostedProjectRecord(store, body ?? {});
        return { statusCode: 201, body: buildProjectResponse(createdProject, publicBaseUrl) };
      }

      if (method === 'GET' && url?.startsWith('/projects')) {
        const route = new URL(url, 'http://signalforge.local');
        if (route.pathname === '/projects') {
          const items = store.listProjects().map((item) => buildProjectResponse(item, publicBaseUrl));
          return { statusCode: 200, body: { items } };
        }
        const projectId = route.pathname.split('/')[2];
        const subroute = route.pathname.split('/').slice(3).join('/');
        const projectRecord = store.getProjectById(projectId);
        if (!projectRecord) {
          return { statusCode: 404, error: { code: 'not_found', message: 'project not found' } };
        }
        if (!subroute) {
          return { statusCode: 200, body: buildProjectResponse(projectRecord, publicBaseUrl) };
        }
        if (method === 'GET' && subroute === 'github-connection') {
          const connection = await inspectProjectGitHubConnection(projectRecord);
          const updated = store.saveProject(withProjectGitHubConnection(projectRecord, connection));
          return { statusCode: 200, body: buildProjectResponse(updated, publicBaseUrl) };
        }
      }

      if (method === 'POST' && url?.startsWith('/projects/')) {
        const route = new URL(url, 'http://signalforge.local');
        const projectId = route.pathname.split('/')[2];
        const subroute = route.pathname.split('/').slice(3).join('/');
        const projectRecord = store.getProjectById(projectId);
        if (!projectRecord) {
          return { statusCode: 404, error: { code: 'not_found', message: 'project not found' } };
        }
        if (subroute === 'github-connection/refresh') {
          const connection = await inspectProjectGitHubConnection(projectRecord);
          const updated = store.saveProject(withProjectGitHubConnection(projectRecord, connection));
          return { statusCode: 200, body: buildProjectResponse(updated, publicBaseUrl) };
        }
      }

      if (method === 'GET' && url === '/setup/status') {
        const status = await evaluateSetupStatus({
          env,
          repoRoot,
          fileSystem: fs,
        });
        return { statusCode: 200, body: status };
      }

      if (method === 'POST' && url === '/verify/run') {
        const result = await runVerification(body?.target ?? {});
        return { statusCode: 200, body: result };
      }

      if (method === 'POST' && url === '/submissions') {
        if (!project && requireProjectKey()) {
          return { statusCode: 401, error: { code: 'unauthorized', message: 'valid X-SignalForge-Project-Key is required' } };
        }
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
          raw: {
            ...(body.raw ?? {}),
            ...(project
              ? {
                  signalforgeProject: {
                    projectId: project.id,
                    projectKey: project.projectKey,
                    slug: project.slug,
                    appName: project.appName,
                  },
                }
              : {}),
          },
        });
        store.saveSubmission(submission);
        return project
          ? {
              statusCode: 201,
              body: {
                submissionId: submission.id,
                status: 'accepted',
                project: {
                  id: project.id,
                  slug: project.slug,
                  projectKey: project.projectKey,
                },
              },
            }
          : { statusCode: 201, body: { submissionId: submission.id, status: 'accepted' } };
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
          if (project && submission.raw?.signalforgeProject?.projectKey !== project.projectKey) {
            ignored += 1;
            continue;
          }
          const scopedProjectKey = project?.projectKey || submission.raw?.signalforgeProject?.projectKey || '';
          const before = store.listCases({
            projectKey: scopedProjectKey || undefined,
          }).length;
          const storedCase = await triageAndUpsertSubmission(submission, { project });
          const after = store.listCases({
            projectKey: scopedProjectKey || undefined,
          }).length;
          caseIds.push(storedCase.id);
          if (after > before) created += 1;
          else merged += 1;
        }
        return { statusCode: 200, body: { caseIds, created, merged, ignored } };
      }

      if (method === 'POST' && url === '/runtime-events') {
        if (!project && requireProjectKey()) {
          return { statusCode: 401, error: { code: 'unauthorized', message: 'valid X-SignalForge-Project-Key is required' } };
        }
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
          raw: {
            ...(body.raw ?? {}),
            ...(project
              ? {
                  signalforgeProject: {
                    projectId: project.id,
                    projectKey: project.projectKey,
                    slug: project.slug,
                    appName: project.appName,
                  },
                }
              : {}),
          },
        });
        store.saveRuntimeEvent(event);
        const storedCase = await handleRuntimeEvent(event, { project });
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
          const scopedProjectKey = firstNonEmpty(filters.projectKey, project?.projectKey);
          const items = store.listCases({
            status: firstNonEmpty(filters.status),
            sourceKind: firstNonEmpty(filters.sourceKind),
            projectKey: firstNonEmpty(scopedProjectKey),
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
        if (caseRecord.publication?.published) {
          const existingPublication = caseRecord.publication?.primaryPublicationId
            ? store.getPublication(caseRecord.publication.primaryPublicationId)
            : store.listPublications(caseRecord.id)[0] ?? null;
          if (existingPublication) {
            return {
              statusCode: 200,
              body: {
                publicationId: existingPublication.id,
                caseId: caseRecord.id,
                result: existingPublication.result,
                alreadyPublished: true,
              },
            };
          }
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

    const result = await handleRequest({ method: req.method, url: req.url, body, headers: req.headers });
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
