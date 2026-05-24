export type ConversationStatus =
  | "idle"
  | "collecting_missing_info"
  | "searching"
  | "presented_candidates"
  | "booking_handoff";

export type SearchJobStatus = "queued" | "running" | "completed" | "failed";

export type BookingAttemptStatus = "stopped_for_user" | "failed";

export type MissingField = "date" | "time" | "partySize" | "area";

export interface ReservationIntent {
  date?: string;
  time?: string;
  partySize?: number;
  area?: string;
  genre?: string;
  occasion?: string;
  budgetPerPerson?: number;
  preferences: string[];
  missingFields: MissingField[];
  originalText: string;
}

export interface Candidate {
  id?: string;
  rank?: number;
  name: string;
  url: string;
  availability: string;
  price?: string;
  genre?: string;
  area?: string;
  extractionNote?: string;
  evaluationReason?: string;
  rawPayload?: unknown;
}

export interface RankedCandidate extends Candidate {
  rank: number;
  evaluationReason: string;
}

export interface ConversationState {
  lineUserId: string;
  status: ConversationStatus;
  intent: Partial<ReservationIntent>;
  pendingField?: MissingField;
  lastSearchJobId?: string;
}

export interface SearchJob {
  id: string;
  lineUserId: string;
  status: SearchJobStatus;
  intent: ReservationIntent;
  errorReason?: string;
  failureArtifact?: unknown;
}

export interface BookingResult {
  status: BookingAttemptStatus;
  stopReason: string;
  handoffUrl?: string;
  rawPayload?: unknown;
}
