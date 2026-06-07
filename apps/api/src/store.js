import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const defaultDbPath = resolve(process.cwd(), 'data', 'signalforge.db');

function ensureParentDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function reporterIdentity(reporter = {}) {
  const candidates = [
    reporter.id,
    reporter.email,
    reporter.userId,
    reporter.externalId,
    reporter.username,
    reporter.name,
  ];
  const first = candidates.map((value) => String(value ?? '').trim()).find(Boolean);
  if (first) return first.toLowerCase();
  const entries = Object.entries(reporter ?? {}).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : null;
}

function filterCases(items, filters = {}) {
  return items.filter((item) => {
    if (filters.status && item.status !== filters.status) return false;
    if (filters.sourceKind && item.metadata?.sourceKind !== filters.sourceKind) return false;
    if (typeof filters.published === 'boolean' && Boolean(item.publication?.published) !== filters.published) return false;
    if (filters.projectKey && item.metadata?.project?.projectKey !== filters.projectKey) return false;
    return true;
  });
}

function filterSubmissions(items, filters = {}) {
  return items.filter((item) => {
    if (filters.projectKey && item.raw?.signalforgeProject?.projectKey !== filters.projectKey) return false;
    return true;
  });
}

export function createStore(dbPath = process.env.SIGNALFORGE_DB_PATH || defaultDbPath) {
  ensureParentDir(dbPath);
  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      reporter_json TEXT NOT NULL,
      app_context_json TEXT NOT NULL,
      content_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      privacy_json TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runtime_events (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      environment TEXT NOT NULL,
      release TEXT NOT NULL,
      route TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      error_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      context_json TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      project_key TEXT NOT NULL UNIQUE,
      app_name TEXT NOT NULL,
      repo_json TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS setup_sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      project_id TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      target_json TEXT NOT NULL,
      state_json TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      canonical_title TEXT NOT NULL,
      canonical_summary TEXT NOT NULL,
      classification_json TEXT NOT NULL,
      scoring_json TEXT NOT NULL,
      clustering_json TEXT NOT NULL,
      evidence_summary_json TEXT NOT NULL,
      decision_readiness_json TEXT NOT NULL,
      publication_json TEXT NOT NULL,
      links_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS publications (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      target_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      sync_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      made_at TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS delegations (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      target_json TEXT NOT NULL,
      request_json TEXT NOT NULL,
      result_json TEXT NOT NULL
    );
  `);

  return {
    close() {
      db.close();
    },
    saveSubmission(submission) {
      db.prepare(`
        INSERT INTO submissions (
          id, source, submitted_at, reporter_json, app_context_json,
          content_json, evidence_json, privacy_json, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        submission.id,
        submission.source,
        submission.submittedAt,
        JSON.stringify(submission.reporter ?? {}),
        JSON.stringify(submission.appContext ?? {}),
        JSON.stringify(submission.content ?? {}),
        JSON.stringify(submission.evidence ?? {}),
        JSON.stringify(submission.privacy ?? {}),
        JSON.stringify(submission.raw ?? {}),
      );
      return submission;
    },
    getSubmission(id) {
      const row = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
      return row ? hydrateSubmission(row) : null;
    },
    listSubmissions(filters = {}) {
      const items = db.prepare(`SELECT * FROM submissions ORDER BY submitted_at DESC`).all().map(hydrateSubmission);
      return filterSubmissions(items, filters);
    },
    listSubmissionsByIds(ids = []) {
      if (!ids.length) return [];
      const statement = db.prepare(`SELECT * FROM submissions WHERE id = ?`);
      return ids.map((id) => statement.get(id)).filter(Boolean).map(hydrateSubmission);
    },
    listSubmissionsForCase(caseId) {
      const caseRecord = this.getCase(caseId);
      if (!caseRecord) return [];
      return this.listSubmissionsByIds(caseRecord.links?.submissionIds ?? []);
    },
    countUniqueReportersForSubmissionIds(ids = []) {
      const reporters = new Set();
      for (const submission of this.listSubmissionsByIds(ids)) {
        const identity = reporterIdentity(submission.reporter);
        if (identity) reporters.add(identity);
      }
      return reporters.size;
    },
    saveRuntimeEvent(event) {
      db.prepare(`
        INSERT INTO runtime_events (
          id, source, occurred_at, environment, release, route, fingerprint,
          error_json, tags_json, context_json, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.source,
        event.occurredAt,
        event.environment,
        event.release ?? '',
        event.route ?? '',
        event.fingerprint ?? '',
        JSON.stringify(event.error ?? {}),
        JSON.stringify(event.tags ?? {}),
        JSON.stringify(event.context ?? {}),
        JSON.stringify(event.raw ?? {}),
      );
      return event;
    },
    getRuntimeEvent(id) {
      const row = db.prepare(`SELECT * FROM runtime_events WHERE id = ?`).get(id);
      return row ? hydrateRuntimeEvent(row) : null;
    },
    listRuntimeEventsByFingerprint(fingerprint) {
      return db.prepare(`SELECT * FROM runtime_events WHERE fingerprint = ? ORDER BY occurred_at DESC`).all(fingerprint).map(hydrateRuntimeEvent);
    },
    listRuntimeEventsByIds(ids = []) {
      if (!ids.length) return [];
      const statement = db.prepare(`SELECT * FROM runtime_events WHERE id = ?`);
      return ids.map((id) => statement.get(id)).filter(Boolean).map(hydrateRuntimeEvent);
    },
    saveProject(project) {
      const existing = this.getProjectByKey(project.projectKey) ?? this.getProjectById(project.id);
      if (existing) {
        db.prepare(`
          UPDATE projects
          SET created_at = ?,
              updated_at = ?,
              name = ?,
              slug = ?,
              project_key = ?,
              app_name = ?,
              repo_json = ?,
              status = ?,
              metadata_json = ?
          WHERE id = ?
        `).run(
          project.createdAt,
          project.updatedAt,
          project.name,
          project.slug,
          project.projectKey,
          project.appName,
          JSON.stringify(project.repo ?? {}),
          project.status,
          JSON.stringify(project.metadata ?? {}),
          existing.id,
        );
        return this.getProjectById(existing.id);
      }
      db.prepare(`
        INSERT INTO projects (
          id, created_at, updated_at, name, slug, project_key, app_name, repo_json, status, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        project.id,
        project.createdAt,
        project.updatedAt,
        project.name,
        project.slug,
        project.projectKey,
        project.appName,
        JSON.stringify(project.repo ?? {}),
        project.status,
        JSON.stringify(project.metadata ?? {}),
      );
      return this.getProjectByKey(project.projectKey);
    },
    listProjects() {
      return db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`).all().map(hydrateProject);
    },
    getProjectById(id) {
      const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
      return row ? hydrateProject(row) : null;
    },
    getProjectByKey(projectKey) {
      const row = db.prepare(`SELECT * FROM projects WHERE project_key = ?`).get(projectKey);
      return row ? hydrateProject(row) : null;
    },
    getProjectBySlug(slug) {
      const row = db.prepare(`SELECT * FROM projects WHERE slug = ?`).get(slug);
      return row ? hydrateProject(row) : null;
    },
    saveSetupSession(session) {
      const existing = this.getSetupSession(session.id);
      if (existing) {
        db.prepare(`
          UPDATE setup_sessions
          SET created_at = ?,
              updated_at = ?,
              project_id = ?,
              actor_json = ?,
              target_json = ?,
              state_json = ?,
              status = ?,
              metadata_json = ?
          WHERE id = ?
        `).run(
          session.createdAt,
          session.updatedAt,
          session.projectId,
          JSON.stringify(session.actor ?? {}),
          JSON.stringify(session.target ?? {}),
          JSON.stringify(session.state ?? {}),
          session.status,
          JSON.stringify(session.metadata ?? {}),
          session.id,
        );
        return this.getSetupSession(session.id);
      }
      db.prepare(`
        INSERT INTO setup_sessions (
          id, created_at, updated_at, project_id, actor_json, target_json, state_json, status, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.id,
        session.createdAt,
        session.updatedAt,
        session.projectId,
        JSON.stringify(session.actor ?? {}),
        JSON.stringify(session.target ?? {}),
        JSON.stringify(session.state ?? {}),
        session.status,
        JSON.stringify(session.metadata ?? {}),
      );
      return this.getSetupSession(session.id);
    },
    getSetupSession(id) {
      const row = db.prepare(`SELECT * FROM setup_sessions WHERE id = ?`).get(id);
      return row ? hydrateSetupSession(row) : null;
    },
    listSetupSessions(projectId = '') {
      const rows = projectId
        ? db.prepare(`SELECT * FROM setup_sessions WHERE project_id = ? ORDER BY created_at DESC`).all(projectId)
        : db.prepare(`SELECT * FROM setup_sessions ORDER BY created_at DESC`).all();
      return rows.map(hydrateSetupSession);
    },
    upsertCase(caseRecord, fingerprint) {
      const resolvedFingerprint = fingerprint ?? caseRecord?.clustering?.fingerprint ?? caseRecord?.id;
      const existing = getCaseById(db, caseRecord?.id) ?? getCaseByFingerprint(db, resolvedFingerprint);
      const targetId = existing?.id ?? caseRecord.id;
      const targetFingerprint = existing ? existing.clustering?.fingerprint ?? resolvedFingerprint : resolvedFingerprint;
      if (existing) {
        db.prepare(`
          UPDATE cases
          SET created_at = ?,
              updated_at = ?,
              status = ?,
              canonical_title = ?,
              canonical_summary = ?,
              classification_json = ?,
              scoring_json = ?,
              clustering_json = ?,
              evidence_summary_json = ?,
              decision_readiness_json = ?,
              publication_json = ?,
              links_json = ?,
              metadata_json = ?,
              fingerprint = ?
          WHERE id = ?
        `).run(
          caseRecord.createdAt,
          caseRecord.updatedAt,
          caseRecord.status,
          caseRecord.canonicalTitle,
          caseRecord.canonicalSummary,
          JSON.stringify(caseRecord.classification ?? {}),
          JSON.stringify(caseRecord.scoring ?? {}),
          JSON.stringify(caseRecord.clustering ?? {}),
          JSON.stringify(caseRecord.evidenceSummary ?? {}),
          JSON.stringify(caseRecord.decisionReadiness ?? {}),
          JSON.stringify(caseRecord.publication ?? {}),
          JSON.stringify(caseRecord.links ?? {}),
          JSON.stringify(caseRecord.metadata ?? {}),
          targetFingerprint,
          targetId,
        );
        return getCaseById(db, targetId);
      }
      db.prepare(`
        INSERT INTO cases (
          id, created_at, updated_at, status, canonical_title, canonical_summary,
          classification_json, scoring_json, clustering_json, evidence_summary_json,
          decision_readiness_json, publication_json, links_json, metadata_json, fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        caseRecord.id,
        caseRecord.createdAt,
        caseRecord.updatedAt,
        caseRecord.status,
        caseRecord.canonicalTitle,
        caseRecord.canonicalSummary,
        JSON.stringify(caseRecord.classification ?? {}),
        JSON.stringify(caseRecord.scoring ?? {}),
        JSON.stringify(caseRecord.clustering ?? {}),
        JSON.stringify(caseRecord.evidenceSummary ?? {}),
        JSON.stringify(caseRecord.decisionReadiness ?? {}),
        JSON.stringify(caseRecord.publication ?? {}),
        JSON.stringify(caseRecord.links ?? {}),
        JSON.stringify(caseRecord.metadata ?? {}),
        resolvedFingerprint,
      );
      return getCaseByFingerprint(db, resolvedFingerprint);
    },
    findCaseByFingerprint(fingerprint) {
      return getCaseByFingerprint(db, fingerprint);
    },
    listCases(filters = {}) {
      const items = db.prepare(`SELECT * FROM cases ORDER BY updated_at DESC`).all().map(hydrateCase);
      return filterCases(items, filters);
    },
    getCase(id) {
      const row = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(id);
      return row ? hydrateCase(row) : null;
    },
    savePublication(publication) {
      db.prepare(`
        INSERT INTO publications (
          id, case_id, created_at, target_json, result_json, snapshot_json, sync_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        publication.id,
        publication.caseId,
        publication.createdAt,
        JSON.stringify(publication.target ?? {}),
        JSON.stringify(publication.result ?? {}),
        JSON.stringify(publication.snapshot ?? {}),
        JSON.stringify(publication.sync ?? {}),
      );
      return publication;
    },
    listPublications(caseId) {
      const rows = caseId
        ? db.prepare(`SELECT * FROM publications WHERE case_id = ? ORDER BY created_at DESC`).all(caseId)
        : db.prepare(`SELECT * FROM publications ORDER BY created_at DESC`).all();
      return rows.map(hydratePublication);
    },
    getPublication(id) {
      const row = db.prepare(`SELECT * FROM publications WHERE id = ?`).get(id);
      return row ? hydratePublication(row) : null;
    },
    findPublicationByIssue({ repo, number }) {
      const targetRepo = String(repo ?? '').trim();
      const targetNumber = Number(number);
      if (!targetRepo || !Number.isFinite(targetNumber)) return null;
      return this.listPublications().find((publication) => {
        return publication.target?.repo === targetRepo && Number(publication.result?.number) === targetNumber;
      }) ?? null;
    },
    updatePublicationSync(id, syncPatch = {}) {
      const current = this.getPublication(id);
      if (!current) return null;
      const nextSync = {
        ...(current.sync ?? {}),
        ...syncPatch,
      };
      db.prepare(`
        UPDATE publications
        SET sync_json = ?
        WHERE id = ?
      `).run(JSON.stringify(nextSync), id);
      return this.getPublication(id);
    },
    saveDecision(decision) {
      db.prepare(`
        INSERT INTO decisions (
          id, case_id, made_at, actor_json, decision, reason, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        decision.id,
        decision.caseId,
        decision.madeAt,
        JSON.stringify(decision.actor ?? {}),
        decision.decision,
        decision.reason ?? '',
        JSON.stringify(decision.payload ?? {}),
      );
      return decision;
    },
    listDecisions(caseId) {
      return db.prepare(`SELECT * FROM decisions WHERE case_id = ? ORDER BY made_at DESC`).all(caseId).map(hydrateDecision);
    },
    saveDelegation(delegation) {
      db.prepare(`
        INSERT INTO delegations (
          id, case_id, created_at, updated_at, kind, status, target_json, request_json, result_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        delegation.id,
        delegation.caseId,
        delegation.createdAt,
        delegation.updatedAt,
        delegation.kind,
        delegation.status,
        JSON.stringify(delegation.target ?? {}),
        JSON.stringify(delegation.request ?? {}),
        JSON.stringify(delegation.result ?? {}),
      );
      return delegation;
    },
    listDelegations(caseId) {
      return db.prepare(`SELECT * FROM delegations WHERE case_id = ? ORDER BY created_at DESC`).all(caseId).map(hydrateDelegation);
    },
    getDelegation(id) {
      const row = db.prepare(`SELECT * FROM delegations WHERE id = ?`).get(id);
      return row ? hydrateDelegation(row) : null;
    },
  };
}

function hydrateSubmission(row) {
  return {
    id: row.id,
    source: row.source,
    submittedAt: row.submitted_at,
    reporter: JSON.parse(row.reporter_json),
    appContext: JSON.parse(row.app_context_json),
    content: JSON.parse(row.content_json),
    evidence: JSON.parse(row.evidence_json),
    privacy: JSON.parse(row.privacy_json),
    raw: JSON.parse(row.raw_json),
  };
}

function hydrateRuntimeEvent(row) {
  return {
    id: row.id,
    source: row.source,
    occurredAt: row.occurred_at,
    environment: row.environment,
    release: row.release,
    route: row.route,
    fingerprint: row.fingerprint,
    error: JSON.parse(row.error_json),
    tags: JSON.parse(row.tags_json),
    context: JSON.parse(row.context_json),
    raw: JSON.parse(row.raw_json),
  };
}

function hydrateCase(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    canonicalTitle: row.canonical_title,
    canonicalSummary: row.canonical_summary,
    classification: JSON.parse(row.classification_json),
    scoring: JSON.parse(row.scoring_json),
    clustering: JSON.parse(row.clustering_json),
    evidenceSummary: JSON.parse(row.evidence_summary_json),
    decisionReadiness: JSON.parse(row.decision_readiness_json),
    publication: JSON.parse(row.publication_json),
    delegations: [],
    links: JSON.parse(row.links_json),
    metadata: JSON.parse(row.metadata_json),
  };
}

function getCaseByFingerprint(db, fingerprint) {
  const row = db.prepare(`SELECT * FROM cases WHERE fingerprint = ?`).get(fingerprint);
  return row ? hydrateCase(row) : null;
}

function getCaseById(db, id) {
  const row = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(id);
  return row ? hydrateCase(row) : null;
}

function hydratePublication(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    createdAt: row.created_at,
    target: JSON.parse(row.target_json),
    result: JSON.parse(row.result_json),
    snapshot: JSON.parse(row.snapshot_json),
    sync: JSON.parse(row.sync_json),
  };
}

function hydrateDecision(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    madeAt: row.made_at,
    actor: JSON.parse(row.actor_json),
    decision: row.decision,
    reason: row.reason,
    payload: JSON.parse(row.payload_json),
  };
}

function hydrateDelegation(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    kind: row.kind,
    status: row.status,
    target: JSON.parse(row.target_json),
    request: JSON.parse(row.request_json),
    result: JSON.parse(row.result_json),
  };
}

function hydrateProject(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    name: row.name,
    slug: row.slug,
    projectKey: row.project_key,
    appName: row.app_name,
    repo: JSON.parse(row.repo_json),
    status: row.status,
    metadata: JSON.parse(row.metadata_json),
  };
}

function hydrateSetupSession(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectId: row.project_id,
    actor: JSON.parse(row.actor_json),
    target: JSON.parse(row.target_json),
    state: JSON.parse(row.state_json),
    status: row.status,
    metadata: JSON.parse(row.metadata_json),
  };
}
