/** The recipe library on disk (packages/core/src/library/recipes.json) and filling it with the AI. */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { libraryItems, type LibraryRecipe, type RecipeBook } from '@pg/core';
import type { Completion, LlmBackend } from '../llm/client';
import { batchesOf, composeRecipes, type ComposeItem } from './recipes';

export const RECIPE_FILE = fileURLToPath(new URL('../../../core/src/library/recipes.json', import.meta.url));

export function readBook(file = RECIPE_FILE): RecipeBook {
  try { return JSON.parse(readFileSync(file, 'utf8')) as RecipeBook; } catch { return {}; }
}

/** One recipe per entry and one shape per line, sorted, so a review shows as a small diff. */
export function writeBook(book: RecipeBook, file = RECIPE_FILE) {
  const ids = Object.keys(book).sort();
  const entry = (id: string) => {
    const { shapes, ...rest } = book[id];
    const head = JSON.stringify(rest).slice(1, -1);
    return `  ${JSON.stringify(id)}: {${head ? `${head}, ` : ''}"shapes": [\n${shapes.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}\n  ]}`;
  };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `{\n${ids.map(entry).join(',\n')}\n}\n`);
  renameSync(tmp, file);
}

export interface FillOptions {
  /** Only these ids (catalog or kept); default every catalog thing without a recipe. */
  ids?: string[];
  /** Compose again even when a recipe exists (a redo keeps the reviewer's note and shows the last try). */
  redo?: boolean;
  /** Only things still marked bad (to redo after a review). */
  bad?: boolean;
  group?: string;
  note?: string;
  batch?: number;
  jobs?: number;
  file?: string;
  signal?: AbortSignal;
  /** How many things are about to be composed. */
  onStart?: (total: number) => void;
  onBatch?: (done: { ids: string[]; missing: string[]; ms: number; error?: string }) => void;
}

/** Compose the library's missing (or chosen) recipes, saving after every batch so a stop loses little. */
export async function fillLibrary(llm: LlmBackend, opts: FillOptions = {}): Promise<{ composed: number; failed: string[] }> {
  const file = opts.file ?? RECIPE_FILE;
  const start = readBook(file);
  const items = libraryItems(start).filter((it) =>
    (opts.ids ? opts.ids.includes(it.id) : true) && (!opts.group || it.group === opts.group)
    && (opts.bad ? it.recipe?.status === 'bad' : opts.redo || opts.ids ? true : !it.recipe));
  const asks: ComposeItem[] = items.map((it) => ({
    id: it.id, name: it.name, group: it.group, words: it.words,
    note: opts.note ?? it.recipe?.note, previous: (opts.redo || opts.bad || opts.ids) && it.recipe ? it.recipe.shapes : undefined,
  }));
  opts.onStart?.(asks.length);
  let composed = 0;
  let failed: string[] = [];
  const calls: Completion[] = [];
  let queue: ComposeItem[][] = [];
  const worker = async () => {
    for (let b = queue.shift(); b && !opts.signal?.aborted; b = queue.shift()) {
      const t = Date.now();
      try {
        const got = await composeRecipes(llm, b, calls);
        // Read again before writing: other workers (and the review page) save too.
        const book = readBook(file);
        for (const [id, shapes] of got) {
          const note = b.find((x) => x.id === id)?.note;
          // A kept thing keeps its own name and words; every redo goes back to review.
          book[id] = { ...book[id], shapes, status: 'new', ...(note ? { note } : {}) };
        }
        writeBook(book, file);
        composed += got.size;
        const missing = b.filter((x) => !got.has(x.id)).map((x) => x.id);
        failed.push(...missing);
        opts.onBatch?.({ ids: [...got.keys()], missing, ms: Date.now() - t });
      } catch (err) {
        failed.push(...b.map((x) => x.id));
        opts.onBatch?.({ ids: [], missing: b.map((x) => x.id), ms: Date.now() - t, error: err instanceof Error ? err.message : String(err) });
      }
    }
  };
  const run = (list: ComposeItem[], size: number) => {
    queue = batchesOf(list, size);
    return Promise.all(Array.from({ length: Math.max(1, opts.jobs ?? 3) }, worker));
  };
  await run(asks, opts.batch ?? 8);
  // What a batch dropped or a call lost gets one more try, a few at a time (smaller replies fail less).
  if (failed.length && !opts.signal?.aborted) {
    const again = asks.filter((a) => failed.includes(a.id));
    failed = [];
    await run(again, 3);
  }
  return { composed, failed };
}

/** Set a recipe's review status (and the note for its redo). */
export function reviewRecipe(id: string, status: LibraryRecipe['status'], note?: string, file = RECIPE_FILE): LibraryRecipe | null {
  const book = readBook(file);
  if (!book[id]) return null;
  book[id] = { ...book[id], status, ...(note ? { note } : {}) };
  if (!note && status === 'good') delete book[id].note;
  writeBook(book, file);
  return book[id];
}
