/**
 * The workbench library: every part a designer has made, with its 3D look once one is made. Asking
 * for a part by a name or words it already has gives the kept one, with no AI call and no 3D credits.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { plain, type Landmark } from '@pg/core';
import { readJson, writeFileAtomic } from './files';

export interface KeptPart extends Landmark { id: string; words: string[]; model?: string; at: string }

const MAX_PARTS = 300;
/** "a zigzag slide" and "Zigzag slide!" are the same ask. */
const ask = (s: string) => plain(s).replace(/^(a|an|the|some) /, '');

export class PartLibrary {
  private parts: KeptPart[] = [];
  private chain: Promise<void> = Promise.resolve();
  private constructor(private file: string) {}

  static async open(dir: string): Promise<PartLibrary> {
    const lib = new PartLibrary(join(dir, 'workbench-parts.json'));
    lib.parts = (await readJson<KeptPart[]>(lib.file)) ?? [];
    return lib;
  }

  /** Newest first. */
  list(): KeptPart[] {
    return [...this.parts].reverse();
  }

  get(id: string): KeptPart | undefined {
    return this.parts.find((p) => p.id === id);
  }

  find(text: string): KeptPart | undefined {
    const a = ask(text);
    return a ? this.parts.find((p) => ask(p.name) === a || p.words.includes(a)) : undefined;
  }

  /** Keeps a new part; one by the same name already kept is the library's part, now known by these words too. */
  async add(part: Landmark, text: string, now = new Date()): Promise<KeptPart> {
    const words = [ask(text)].filter(Boolean);
    const same = this.parts.find((p) => ask(p.name) === ask(part.name));
    if (same) {
      same.words = [...new Set([...same.words, ...words])].slice(-12);
      await this.save();
      return same;
    }
    const kept: KeptPart = { id: randomBytes(6).toString('hex'), name: part.name, shapes: part.shapes, words, at: now.toISOString() };
    this.parts = [...this.parts, kept].slice(-MAX_PARTS);
    await this.save();
    return kept;
  }

  /** A kept part's new shapes after a fix in the test lab; its name stays, its old 3D look (made for the old shape) goes. */
  async reshape(id: string, part: Landmark): Promise<void> {
    const kept = this.parts.find((p) => p.id === id);
    if (!kept) return;
    kept.shapes = part.shapes;
    delete kept.model;
    await this.save();
  }

  /** The 3D look of a kept part; the first one made stays. */
  async look(id: string, model: string): Promise<void> {
    const part = this.parts.find((p) => p.id === id);
    if (!part || part.model) return;
    part.model = model;
    await this.save();
  }

  private save() {
    const snapshot = JSON.stringify(this.parts);
    this.chain = this.chain.then(() => writeFileAtomic(this.file, snapshot));
    return this.chain;
  }
}
