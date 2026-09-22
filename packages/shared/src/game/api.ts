import type { SimEvent } from '../events';
import type { GoalResult } from '../goal';
import type { Level, Piece } from './level';

/**
 * Wire contract between web and server for the game endpoints.
 *
 * POST /api/level  { prompt }                 -> text/event-stream of LevelStreamEvent
 * POST /api/edit   { level, instruction }     -> text/event-stream of LevelStreamEvent
 * POST /api/coach  CoachRequest               -> CoachResponse (JSON)
 *
 * Stream framing: standard SSE, `event: <type>` + `data: <json>` lines, blank line between events.
 */
export type LevelStage = 'designing' | 'verifying' | 'redesigning' | 'editing';

/**
 * How far a level version got: `designed` = the AI's design, playable but not yet proven;
 * `solved` = the optimizer found a winning shot (it may still get loosened or redesigned).
 */
export type LevelDraftStatus = 'designed' | 'solved';

/**
 * Levels arrive progressively so players never wait for the whole pipeline: a `draft` as soon as
 * each design is valid, another once it is proven solvable, then the final `level`.
 * Drafts of the same `attempt` are the same design (same bodies); a new attempt is a redesign.
 */
export type LevelStreamEvent =
  | { type: 'stage'; stage: LevelStage; attempt: number; maxAttempts: number; message: string }
  | { type: 'progress'; attempt: number; evals: number; bestScore: number; goalLength: number }
  | { type: 'draft'; level: Level; status: LevelDraftStatus; attempt: number }
  | { type: 'level'; level: Level; solved: boolean; attempts: number; notes: string[]; cached: boolean; attempt?: number }
  | { type: 'error'; error: string };

export interface LevelRequest {
  prompt: string;
}

export interface EditRequest {
  level: Level;
  instruction: string;
}

export interface CoachRequest {
  level: Level;
  values: number[];
  pieces: Piece[];
  shots: number;
  goal: GoalResult;
  events: SimEvent[];
}

export interface CoachResponse {
  /** One or two short, friendly sentences telling the player what went wrong and what to try. */
  tip: string;
}

/**
 * Community gallery.
 *
 * GET  /api/gallery?sort=new|top&limit=N  -> GalleryListResponse
 * GET  /api/gallery/:id                   -> GalleryEntryResponse
 * POST /api/gallery   GalleryPublishRequest -> GalleryEntryResponse (level must carry a solution the server verifies)
 * POST /api/gallery/:id/result  GalleryResultRequest -> GalleryItem
 *
 * Errors on JSON endpoints: non-2xx status with ApiError. On the SSE endpoints, errors
 * (including 400/429/503 before any work starts) arrive as an `error` event in the stream.
 */
export type GallerySort = 'new' | 'top';

export interface GalleryItem {
  id: string;
  title: string;
  briefing: string;
  author: string;
  plays: number;
  clears: number;
  /** Fewest shots in a reported clear, null until someone clears it. */
  bestShots: number | null;
  /** ISO timestamp. */
  createdAt: string;
}

export interface GalleryListResponse {
  items: GalleryItem[];
}

export interface GalleryPublishRequest {
  level: Level;
  author?: string;
}

export interface GalleryEntryResponse extends GalleryItem {
  level: Level;
}

export interface GalleryResultRequest {
  cleared: boolean;
  shots: number;
}

export interface ApiError {
  error: string;
  issues?: string[];
}
