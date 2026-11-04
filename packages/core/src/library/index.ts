/**
 * The recipe library: a shape recipe for each common thing (see catalog.ts), composed once by the
 * AI, reviewed on the recipe page, and looked up by words with no AI call at play time. Things
 * the AI composes live for a level can be kept too; they carry their own name and words.
 */
import type { LandmarkShape } from '../landscape';
import { CATALOG, plain, type CatalogItem } from './catalog';
import data from './recipes.json' with { type: 'json' };

export { CATALOG, plain, slug, type CatalogItem } from './catalog';

/** new: composed, nobody looked yet; good: reviewed and kept; bad: reviewed and left out of the game. */
export type RecipeStatus = 'new' | 'good' | 'bad';
export interface LibraryRecipe {
  shapes: LandmarkShape[];
  status: RecipeStatus;
  /** What the reviewer asked for when it was redone. */
  note?: string;
  /** Things kept from a level rather than the catalog: their own name, words and group. */
  name?: string;
  words?: string[];
  group?: string;
}
export type RecipeBook = Record<string, LibraryRecipe>;

export const RECIPES = data as unknown as RecipeBook;

/** Swap in the library as it is on disk now (a server that saved a review), without a restart. */
export function replaceRecipes(book: RecipeBook) {
  for (const id of Object.keys(RECIPES)) delete RECIPES[id];
  Object.assign(RECIPES, book);
  index = null;
}

/** Every thing the library can name: the catalog plus the kept extras, with their recipes. */
export function libraryItems(book: RecipeBook = RECIPES): (CatalogItem & { recipe?: LibraryRecipe })[] {
  const known = new Set(CATALOG.map((c) => c.id));
  return [
    ...CATALOG.map((c) => ({ ...c, recipe: book[c.id] })),
    ...Object.entries(book).filter(([id, r]) => !known.has(id) && r.name).map(([id, r]) => ({
      id, name: r.name!, group: r.group ?? 'kept', words: [...new Set([r.name!, ...(r.words ?? [])].map(plain))], recipe: r,
    })),
  ];
}

let index: { phrase: string; item: CatalogItem & { recipe?: LibraryRecipe } }[] | null = null;
let indexed: RecipeBook | null = null;
function phrases(book: RecipeBook) {
  if (!index || indexed !== book) {
    index = libraryItems(book).flatMap((item) => item.words.map((phrase) => ({ phrase, item }))).sort((a, b) => b.phrase.length - a.phrase.length);
    indexed = book;
  }
  return index;
}

/**
 * The library things the words name, in the order they are named, each once. Longer phrases win
 * ("phone booth" over "phone"), plurals count, and only usable recipes (composed, not rejected).
 */
export function libraryIn(text: string, book: RecipeBook = RECIPES): { id: string; name: string; shapes: LandmarkShape[] }[] {
  const words = ` ${plain(text)} `;
  const taken: [number, number][] = [];
  const hits: { at: number; id: string; name: string; shapes: LandmarkShape[] }[] = [];
  for (const { phrase, item } of phrases(book)) {
    if (!item.recipe || item.recipe.status === 'bad' || hits.some((h) => h.id === item.id)) continue;
    for (const end of ['', 's', 'es']) {
      const at = words.indexOf(` ${phrase}${end} `);
      if (at < 0) continue;
      const span: [number, number] = [at, at + phrase.length + end.length + 1];
      if (taken.some(([a, b]) => span[0] < b && a < span[1])) continue;
      taken.push(span);
      hits.push({ at, id: item.id, name: item.name, shapes: item.recipe.shapes });
      break;
    }
  }
  return hits.sort((a, b) => a.at - b.at).map(({ id, name, shapes }) => ({ id, name, shapes }));
}

/** The library recipe called exactly this ("giraffe", "Taj Mahal"), for swapping a live-composed thing for the reviewed one. */
export function libraryNamed(name: string, book: RecipeBook = RECIPES): { id: string; name: string; shapes: LandmarkShape[] } | null {
  const want = plain(name).replace(/^(?:the|a|an) /, '');
  for (const item of libraryItems(book)) {
    if (!item.recipe || item.recipe.status === 'bad') continue;
    if (item.words.some((w) => w === want || `${w}s` === want || `${w}es` === want)) return { id: item.id, name: item.name, shapes: item.recipe.shapes };
  }
  return null;
}
