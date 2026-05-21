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
    upsertCase(caseRecord, fingerprint) {
      db.prepare(`
        INSERT INTO cases (
          id, created_at, updated_at, status, canonical_title, canonical_summary,
          classification_json, scoring_json, clustering_json, evidence_summary_json,
          decision_readiness_json, publication_json, links_json, metadata_json, fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fingerprint) DO UPDATE SET
          updated_at = excluded.updated_at,
          status = excluded.status,
          canonical_title = excluded.canonical_title,
          canonical_summary = excluded.canonical_summary,
          classification_json = excluded.classification_json,
          scoring_json = excluded.scoring_json,
          clustering_json = excluded.clustering_json,
          evidence_summary_json = excluded.evidence_summary_json,
          decision_readiness_json = excluded.decision_readiness_json,
          publication_json = excluded.publication_json,
          links_json = excluded.links_json,
          metadata_json = excluded.metadata_json
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
        fingerprint,
      );
      return getCaseByFingerprint(db, fingerprint);
    },
    listCases() {
      return db.prepare(`SELECT * FROM cases ORDER BY updated_at DESC`).all().map(hydrateCase);
    },
    getCase(id) {
      const row = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(id);
      return row ? hydrateCase(row) : null;
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
    links: JSON.parse(row.links_json),
    metadata: JSON.parse(row.metadata_json),
  };
}

function getCaseByFingerprint(db, fingerprint) {
  const row = db.prepare(`SELECT * FROM cases WHERE fingerprint = ?`).get(fingerprint);
  return row ? hydrateCase(row) : null;
}
