/**
 * Wire types shared by the AI pipeline, the server and the web app. Plain data only.
 *
 * POST /api/machine       { prompt }                 -> text/event-stream of MachineStreamEvent
 * POST /api/machine/edit  { machine, instruction }   -> text/event-stream of MachineStreamEvent
 */
import type { MachineResult } from './goal';
import type { MachineSpec, Part, Terrain } from './schema';

export type MachineStage = 'designing' | 'verifying' | 'nudging' | 'redesigning' | 'editing';

/**
 * Machines arrive progressively: `sketch` events with the parts Claude has written so far, a
 * `draft` as soon as the design is valid (status 'designed'), another once the physics proved it
 * works ('solved', with the optimizer's nudges applied), then the final `machine`.
 */
export type MachineStreamEvent =
  | { type: 'stage'; stage: MachineStage; attempt: number; maxAttempts: number; message: string }
  | { type: 'progress'; attempt: number; evals: number; bestScore: number; goalLength: number }
  | { type: 'sketch'; attempt: number; title?: string; parts: Part[]; terrain?: Terrain[] }
  | { type: 'draft'; machine: MachineSpec; status: 'designed' | 'solved'; attempt: number; result?: MachineResult }
  | {
    type: 'machine'; machine: MachineSpec; solved: boolean; attempts: number; notes: string[]; cached: boolean;
    result: MachineResult; moved: { id: string; cells: number }[]; attempt?: number;
    /** False for a level the AI only set up: nobody has run it, the player's build is the first. */
    verified?: boolean;
  }
  | { type: 'error'; error: string };
