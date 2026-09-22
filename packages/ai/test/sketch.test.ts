import { describe, expect, it } from 'vitest';
import { sketchFrom } from '../src/llm/sketch';
import { levelReply } from './helpers';

describe('sketchFrom', () => {
  it('returns only the bodies that are complete so far, however the reply is cut', () => {
    const reply = levelReply();
    const full = sketchFrom(reply);
    expect(full.bodies.length).toBeGreaterThan(2);
    expect(full.bodies.find((b) => b.launched)?.id).toBe('probe');
    let last = 0;
    for (let n = 0; n <= reply.length; n += 37) {
      const partial = sketchFrom(reply.slice(0, n));
      expect(partial.bodies.length).toBeGreaterThanOrEqual(last);
      expect(partial.bodies).toEqual(full.bodies.slice(0, partial.bodies.length));
      last = partial.bodies.length;
    }
  });

  it('reads orbits and survives strings with braces', () => {
    const text = '```json\n{"title":"Moon \\"Fall\\"","bodies":[{"id":"sun","name":"Sun {x}","type":"star","placement":{"kind":"free"}},{"id":"jove","name":"Jove","type":"planet","placement":{"kind":"orbit","parent":"sun","a":5.2,"phase":30}},{"id":"io","na';
    const s = sketchFrom(text);
    expect(s.title).toBe('Moon "Fall"');
    expect(s.bodies.map((b) => b.id)).toEqual(['sun', 'jove']);
    expect(s.bodies[1]).toMatchObject({ parent: 'sun', a: 5.2, phase: 30 });
  });
});
