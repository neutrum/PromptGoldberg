import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export { FakeLlm, clone, impossibleSpec, levelReply, slingshotLevel } from '../../../packages/ai/test/helpers';

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'og-server-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
