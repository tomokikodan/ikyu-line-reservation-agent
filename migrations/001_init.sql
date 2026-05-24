CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS processed_events (
  webhook_event_id TEXT PRIMARY KEY,
  line_user_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  line_user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'idle',
  intent JSONB NOT NULL DEFAULT '{}'::jsonb,
  pending_field TEXT,
  last_search_job_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS line_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  message_type TEXT NOT NULL,
  text TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS search_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  intent JSONB NOT NULL,
  error_reason TEXT,
  failure_artifact JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_job_id UUID NOT NULL REFERENCES search_jobs(id) ON DELETE CASCADE,
  rank INTEGER,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT '不明',
  price TEXT,
  genre TEXT,
  area TEXT,
  extraction_note TEXT,
  evaluation_reason TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL,
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  stop_reason TEXT,
  handoff_url TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_jobs_line_user_created ON search_jobs(line_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidates_job_rank ON candidates(search_job_id, rank);
CREATE INDEX IF NOT EXISTS idx_audit_logs_line_user_created ON audit_logs(line_user_id, created_at DESC);
