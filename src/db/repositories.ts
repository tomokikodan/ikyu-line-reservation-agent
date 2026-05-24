import type { Pool } from "pg";
import type {
  BookingResult,
  Candidate,
  ConversationState,
  ConversationStatus,
  MissingField,
  RankedCandidate,
  ReservationIntent,
  SearchJob,
  SearchJobStatus
} from "../types.js";

function toConversation(row: Record<string, unknown>): ConversationState {
  return {
    lineUserId: String(row.line_user_id),
    status: row.status as ConversationStatus,
    intent: (row.intent ?? {}) as Partial<ReservationIntent>,
    pendingField: (row.pending_field ?? undefined) as MissingField | undefined,
    lastSearchJobId: (row.last_search_job_id ?? undefined) as string | undefined
  };
}

function toSearchJob(row: Record<string, unknown>): SearchJob {
  return {
    id: String(row.id),
    lineUserId: String(row.line_user_id),
    status: row.status as SearchJobStatus,
    intent: row.intent as ReservationIntent,
    errorReason: (row.error_reason ?? undefined) as string | undefined,
    failureArtifact: row.failure_artifact
  };
}

function toCandidate(row: Record<string, unknown>): Candidate {
  return {
    id: String(row.id),
    rank: row.rank == null ? undefined : Number(row.rank),
    name: String(row.name),
    url: String(row.url),
    availability: String(row.availability),
    price: (row.price ?? undefined) as string | undefined,
    genre: (row.genre ?? undefined) as string | undefined,
    area: (row.area ?? undefined) as string | undefined,
    extractionNote: (row.extraction_note ?? undefined) as string | undefined,
    evaluationReason: (row.evaluation_reason ?? undefined) as string | undefined,
    rawPayload: row.raw_payload
  };
}

export class Repositories {
  constructor(private readonly pool: Pool) {}

  async recordProcessedEvent(webhookEventId: string, lineUserId?: string): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO processed_events (webhook_event_id, line_user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [webhookEventId, lineUserId ?? null]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async appendMessage(input: {
    lineUserId: string;
    direction: "inbound" | "outbound";
    messageType: string;
    text?: string;
    rawPayload?: unknown;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO line_messages (line_user_id, direction, message_type, text, raw_payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.lineUserId,
        input.direction,
        input.messageType,
        input.text ?? null,
        JSON.stringify(input.rawPayload ?? {})
      ]
    );
  }

  async getConversation(lineUserId: string): Promise<ConversationState> {
    const result = await this.pool.query(
      `INSERT INTO conversations (line_user_id)
       VALUES ($1)
       ON CONFLICT (line_user_id) DO UPDATE SET updated_at = conversations.updated_at
       RETURNING *`,
      [lineUserId]
    );
    return toConversation(result.rows[0]);
  }

  async updateConversation(input: {
    lineUserId: string;
    status: ConversationStatus;
    intent: Partial<ReservationIntent>;
    pendingField?: MissingField;
    lastSearchJobId?: string;
  }): Promise<ConversationState> {
    const result = await this.pool.query(
      `INSERT INTO conversations (line_user_id, status, intent, pending_field, last_search_job_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (line_user_id) DO UPDATE SET
         status = EXCLUDED.status,
         intent = EXCLUDED.intent,
         pending_field = EXCLUDED.pending_field,
         last_search_job_id = EXCLUDED.last_search_job_id,
         updated_at = now()
       RETURNING *`,
      [
        input.lineUserId,
        input.status,
        JSON.stringify(input.intent),
        input.pendingField ?? null,
        input.lastSearchJobId ?? null
      ]
    );
    return toConversation(result.rows[0]);
  }

  async createSearchJob(lineUserId: string, intent: ReservationIntent): Promise<SearchJob> {
    const result = await this.pool.query(
      `INSERT INTO search_jobs (line_user_id, status, intent)
       VALUES ($1, 'queued', $2)
       RETURNING *`,
      [lineUserId, JSON.stringify(intent)]
    );
    return toSearchJob(result.rows[0]);
  }

  async updateSearchJob(input: {
    id: string;
    status: SearchJobStatus;
    errorReason?: string;
    failureArtifact?: unknown;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE search_jobs
       SET status = $2,
         error_reason = $3,
         failure_artifact = $4,
         started_at = CASE WHEN $2 = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
         completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN now() ELSE completed_at END
       WHERE id = $1`,
      [
        input.id,
        input.status,
        input.errorReason ?? null,
        JSON.stringify(input.failureArtifact ?? null)
      ]
    );
  }

  async saveRankedCandidates(searchJobId: string, candidates: RankedCandidate[]): Promise<Candidate[]> {
    const saved: Candidate[] = [];
    for (const candidate of candidates) {
      const result = await this.pool.query(
        `INSERT INTO candidates (
          search_job_id, rank, name, url, availability, price, genre, area,
          extraction_note, evaluation_reason, raw_payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          searchJobId,
          candidate.rank,
          candidate.name,
          candidate.url,
          candidate.availability,
          candidate.price ?? null,
          candidate.genre ?? null,
          candidate.area ?? null,
          candidate.extractionNote ?? null,
          candidate.evaluationReason,
          JSON.stringify(candidate.rawPayload ?? candidate)
        ]
      );
      saved.push(toCandidate(result.rows[0]));
    }
    return saved;
  }

  async getCandidatesForJob(searchJobId: string): Promise<Candidate[]> {
    const result = await this.pool.query(
      `SELECT * FROM candidates WHERE search_job_id = $1 ORDER BY rank NULLS LAST, created_at`,
      [searchJobId]
    );
    return result.rows.map(toCandidate);
  }

  async getCandidateByJobRank(lineUserId: string, rank: number): Promise<Candidate | undefined> {
    const result = await this.pool.query(
      `SELECT c.*
       FROM conversations cv
       JOIN candidates c ON c.search_job_id = cv.last_search_job_id
       WHERE cv.line_user_id = $1 AND c.rank = $2
       LIMIT 1`,
      [lineUserId, rank]
    );
    return result.rows[0] ? toCandidate(result.rows[0]) : undefined;
  }

  async saveBookingAttempt(input: {
    lineUserId: string;
    candidateId?: string;
    result: BookingResult;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO booking_attempts (
        line_user_id, candidate_id, status, stop_reason, handoff_url, raw_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.lineUserId,
        input.candidateId ?? null,
        input.result.status,
        input.result.stopReason,
        input.result.handoffUrl ?? null,
        JSON.stringify(input.result.rawPayload ?? {})
      ]
    );
  }

  async appendAuditLog(input: {
    lineUserId?: string;
    eventType: string;
    details?: unknown;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (line_user_id, event_type, details)
       VALUES ($1, $2, $3)`,
      [input.lineUserId ?? null, input.eventType, JSON.stringify(input.details ?? {})]
    );
  }

  async getJobReport(jobId: string): Promise<unknown> {
    const jobResult = await this.pool.query(`SELECT * FROM search_jobs WHERE id = $1`, [jobId]);
    const candidates = await this.getCandidatesForJob(jobId);
    return {
      job: jobResult.rows[0] ?? null,
      candidates
    };
  }
}
