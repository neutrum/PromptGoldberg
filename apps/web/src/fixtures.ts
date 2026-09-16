import slingshot from '@og/shared/fixtures/slingshot.json';
import eclipse from '@og/shared/fixtures/eclipse.json';
import rogue from '@og/shared/fixtures/rogue.json';

export const FIXTURES: { id: string; label: string; spec: unknown }[] = [
  { id: 'slingshot', label: 'Grand Tour Slingshot', spec: slingshot },
  { id: 'eclipse', label: 'Three-Day Eclipse', spec: eclipse },
  { id: 'rogue', label: 'The Moon Thief', spec: rogue },
];
