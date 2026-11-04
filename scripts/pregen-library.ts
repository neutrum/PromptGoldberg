/**
 * One-off: low-poly Tripo models for the library things players name most, made once and served as
 * static files. Each task is recorded before it is polled, so a rerun resumes it and never pays twice.
 *
 *   npx tsx --env-file=.env scripts/pregen-library.ts [id ...]   (no ids: the whole list)
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { shrinkGlb } from '../apps/server/src/shrinkMesh';

/** Library id (or hero-<name>) → what to ask for (the catalog name, made specific where a name alone is vague). */
export const WANTED: Record<string, string> = {
  'pirate-ship': 'a wooden pirate ship with black sails and a skull flag',
  'train': 'a red and black steam locomotive',
  'airplane': 'a small propeller airplane',
  'helicopter': 'a yellow helicopter',
  'hot-air-balloon': 'a striped hot air balloon with a wicker basket',
  'sailboat': 'a small white sailboat',
  'submarine': 'a yellow cartoon submarine lying level, long and rounded, with a periscope, round portholes along its side and a propeller at the back',
  'space-shuttle': 'a space shuttle standing upright on its tail',
  'flying-saucer': 'a silver flying saucer with a glass dome',
  'fire-truck': 'a red fire truck with a ladder',
  'tractor': 'a green farm tractor',
  'car': 'a small blue car',
  'bus': 'a red double-decker bus',
  'house': 'a cosy cottage with a red roof',
  'barn': 'a red wooden barn',
  'church': 'a small white church with a steeple',
  'tent': 'a camping tent',
  'fountain': 'a stone fountain with water',
  'wishing-well': 'a stone wishing well with a little wooden roof',
  'ferris-wheel': 'a colourful ferris wheel',
  'carousel': 'a carousel with horses',
  'circus-tent': 'a red and white striped circus tent',
  'wind-turbine': 'a tall white wind turbine: a slender tower standing on the ground with three long blades at its top',
  'bridge': 'a stone arch bridge',
  'skyscraper': 'a glass skyscraper',
  'lookout-tower': 'a wooden lookout tower',
  'treasure-chest': 'an open treasure chest full of gold coins',
  'tombstone': 'a rounded grey tombstone',
  'throne': 'a golden royal throne with red cushions',
  'catapult': 'a wooden medieval catapult',
  'giant-mushroom': 'a big red mushroom with white spots',
  'gingerbread-house': 'a gingerbread house with icing',
  'christmas-tree': 'a decorated christmas tree with a star',
  'snowman': 'a snowman with a carrot nose and a top hat',
  'dinosaur': 'a green t-rex dinosaur',
  'elephant': 'a grey elephant',
  'unicorn': 'a white unicorn with a rainbow mane',
  'great-pyramid': 'the Great Pyramid of Giza',
  'taj-mahal': 'the Taj Mahal',
  'colosseum': 'the Roman Colosseum',
  'big-ben': 'the Big Ben clock tower in London',
  'leaning-tower-of-pisa': 'the Leaning Tower of Pisa',
  'moai': 'an Easter Island moai stone head',
  'neuschwanstein-castle': 'Neuschwanstein castle',
  'bratislava-castle': 'Bratislava Castle, a white square castle with four corner towers and red roofs',
  'golden-gate-bridge': 'the whole Golden Gate Bridge seen from the side: a long red suspension bridge with a flat road deck, two tall towers and cables between them',
  'lighthouse': 'a red and white striped lighthouse with a lamp room on top, standing on a small rocky base',
  'igloo': 'a round snow igloo made of ice blocks with a small arched entrance tunnel',
  'volcano': 'a small cone volcano with glowing orange lava at its crater and lava streams down its sides',
  'cave-entrance': 'a rocky hillside with a big dark cave entrance arch in its front',
  // 2026-11-03: famous landmarks players and judges name, and goals from the judge set. Ids that are not
  // library things (eiffel-tower, statue-of-liberty, vr-headset, mountain-chalet) match a part's name exactly.
  'eiffel-tower': 'the Eiffel Tower in Paris, perfectly straight and symmetrical: four wide arched legs joined by a platform, a straight tapering tower above, a small top. Solid simple shapes with a cross-hatch lattice pattern painted on, dark bronze colour, no see-through holes',
  'statue-of-liberty': 'the Statue of Liberty: a green copper woman in a robe holding a torch up high, standing on a stone pedestal',
  'sphinx': 'the Great Sphinx of Giza lying down',
  'sydney-opera-house': 'the Sydney Opera House with its white sail shaped roofs',
  'tower-bridge': 'Tower Bridge in London: two stone towers joined by a blue bridge',
  'christ-the-redeemer': 'the Christ the Redeemer statue in Rio: a big white stone figure in a long robe with both arms stretched straight out sideways, standing on a tall square pedestal',
  'arc-de-triomphe': 'the Arc de Triomphe in Paris',
  'empire-state-building': 'the Empire State Building',
  'burj-khalifa': 'the Burj Khalifa in Dubai: a very tall slim silver-grey glass skyscraper made of stepped setbacks around a central core, ending in a long thin spire',
  'saint-basil-s-cathedral': "Saint Basil's Cathedral in Moscow with colourful onion domes",
  'stonehenge': 'Stonehenge, a ring of standing stones',
  'sagrada-familia': 'the Sagrada Familia church in Barcelona with its tall spires',
  'parthenon': 'the Parthenon temple in Athens with white columns',
  'torii-gate': 'a red Japanese torii gate',
  'great-wall-of-china': 'a short grey stone section of the Great Wall of China: a crenellated wall walk on a stone wall running along, with one square grey stone watchtower in the middle, on a small green hill',
  'vr-headset': 'a virtual reality headset with a strap',
  'cauldron': 'a black witch cauldron with green bubbling potion',
  'mountain-chalet': 'a wooden alpine mountain chalet with a snowy roof',
  // 2026-11-03, second batch: more landmarks, and goals and things the judge set names that were still shapes.
  'kremlin': 'the Moscow Kremlin: red brick walls with pointed towers topped by red stars',
  'mount-rushmore': 'Mount Rushmore: a grey granite mountain with four carved presidential faces',
  'brandenburg-gate': 'the Brandenburg Gate in Berlin with its columns and a chariot on top',
  'petronas-towers': 'the Petronas Twin Towers in Kuala Lumpur joined by a sky bridge',
  'space-needle': 'the Space Needle tower in Seattle with its flying saucer top',
  'notre-dame': 'Notre-Dame cathedral in Paris with two square front towers and a rose window',
  'cn-tower': 'the CN Tower in Toronto: a very tall slim concrete tower with a round pod and a spire',
  'angkor-wat': 'the Angkor Wat temple with its lotus bud shaped stone towers',
  'hagia-sophia': 'the Hagia Sophia with its big central dome and four minarets',
  'machu-picchu': 'Machu Picchu: stone terraces and ruins on a green mountain top',
  'kinkaku-ji': 'the Golden Pavilion Kinkaku-ji: a three storey golden Japanese temple',
  'rialto-bridge': 'the Rialto Bridge in Venice: a white stone arch bridge with a covered arcade on top',
  'st-mark-s-basilica': "St Mark's Basilica in Venice with its round domes and golden front",
  'statue': 'a classical white marble statue of a standing figure on a square plinth',
  'toolbox': 'a red metal toolbox with an open lid and tools inside',
  'frying-pan': 'a black frying pan with a fried egg in it',
  'trash-can': 'a grey metal trash can with a lid',
  'doghouse': 'a red wooden doghouse with a pointed roof and a round door',
  'xylophone': 'a colourful toy xylophone with rainbow bars and two mallets',
  'drum': 'a red marching drum with white rims and two drumsticks',
  'cup': 'a white coffee cup on a saucer',
  'bowling-pin': 'a white bowling pin with two red stripes',
  'gondola': 'a black Venetian gondola with a curled bow',
  'totem-pole': 'a carved and painted wooden totem pole with spread wings on top',
  'wizard-tower': 'a tall purple wizard tower with a pointed blue roof and stars',
  'factory': 'an old brick factory with two tall smoking chimneys',
  'lollipop': 'a giant swirly rainbow lollipop on a stick',
  'toy-box': 'an open wooden toy box with toys peeking out',
  'nest': 'a round bird nest of twigs with three speckled eggs',
  'giant-clam': 'a giant open clam shell with a white pearl inside',
  'ramen-shop': 'a small Japanese ramen shop with a red lantern and a noren curtain',
  'oasis': 'a desert oasis: a small blue pool with two palm trees and green grass',
  'haunted-mansion': 'a spooky purple haunted mansion with a crooked tower and glowing windows',
  'mothership': 'a big round alien mothership with glowing lights underneath',
  // The worlds' centrepieces (landscape heroes), drawn with these instead of their box shapes.
  'hero-dragon': 'a friendly green dragon standing on four legs with folded wings and a long tail',
  'hero-castle': 'a small stone castle with four round corner towers, red pointed roofs and a gate',
  'hero-robot': 'a friendly boxy toy robot standing upright with antenna and round eyes',
  'hero-rocket': 'a red and white retro space rocket standing upright on three fins',
  'hero-windmill': 'a Dutch windmill with a brick tower, a pointed cap and four big sails',
  'hero-teapot': 'a big blue porcelain teapot with a spout and a handle',
};

const STYLE = (what: string) => `Low-poly stylized toy model of ${what}. Chunky simple silhouette, large flat faces, clean bright colours, like a painted tabletop diorama miniature. One isolated object, no ground plane, no base, no pedestal, no text, no people. Upright, front facing the viewer.`;

const API = 'https://api.tripo3d.ai/v2/openapi';
const MODEL = 'v3.1-20260211';
const records = resolve('data/library-models'), output = resolve('apps/web/public/models/library');
const key = process.env.TRIPO_API_KEY?.trim();
if (!key) throw Error('Set TRIPO_API_KEY in .env.');

interface Job { id: string; prompt: string; status: string; taskId?: string; credits?: number; bytes?: number; at: string }
const read = async (path: string): Promise<Job | null> => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } };
const save = async (path: string, value: unknown) => { await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n'); await rename(`${path}.tmp`, path); };
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function call(path: string, body?: object) {
  const res = await fetch(`${API}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const json = await res.json() as { code: number; data?: Record<string, any>; message?: string };
  if (!res.ok || json.code !== 0 || !json.data) throw Error(`Tripo ${path}: HTTP ${res.status} ${json.message ?? ''}`);
  return json.data;
}
/** Only Tripo's own HTTPS hosts; the API key is never sent to storage. */
async function download(url: string) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !/(^|\.)(tripo3d\.ai|tripo3d\.com|tripo\.ai)$/.test(u.hostname)) throw Error(`unexpected download host ${u.hostname}`);
  const res = await fetch(u, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw Error(`download HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw Error('not a GLB');
  return bytes;
}

async function generate(id: string) {
  const path = resolve(records, `${id}.json`);
  let job = await read(path);
  if (job?.status === 'downloaded') return console.log(`${id}: already made`);
  if (job && !job.taskId) throw Error(`${id}: an earlier submission has no task id; check the Tripo dashboard before retrying`);
  if (!job) {
    job = { id, prompt: STYLE(WANTED[id]), status: 'submitting', at: new Date().toISOString() };
    await save(path, job);
    const task = await call('/task', { type: 'text_to_model', model_version: MODEL, prompt: job.prompt, face_limit: 4000, texture: true, pbr: false, texture_quality: 'standard' });
    job.taskId = String(task.task_id); job.status = 'queued'; await save(path, job);
    console.log(`${id}: submitted`);
  }
  for (const end = Date.now() + 20 * 60_000; Date.now() < end; await delay(5000)) {
    const task = await call(`/task/${encodeURIComponent(job.taskId!)}`);
    if (task.status === 'success') {
      const out = task.output ?? {}, asset = out.pbr_model ?? out.model ?? out.base_model;
      const bytes = Buffer.from(shrinkGlb(await download(typeof asset === 'string' ? asset : asset.url)));
      await writeFile(resolve(output, `${id}.glb`), bytes);
      Object.assign(job, { status: 'downloaded', credits: task.consumed_credit, bytes: bytes.length });
      await save(path, job);
      return console.log(`${id}: ${bytes.length} bytes, ${task.consumed_credit} credits`);
    }
    if (!['queued', 'running'].includes(task.status)) { job.status = String(task.status); await save(path, job); throw Error(`${id}: ${task.status}`); }
  }
  throw Error(`${id}: still running after 20 minutes; rerun to resume`);
}

await mkdir(records, { recursive: true }); await mkdir(output, { recursive: true });
const asked = process.argv.slice(2);
const unknown = asked.filter((id) => !WANTED[id]);
if (unknown.length) throw Error(`not on the list: ${unknown.join(', ')}`);
const queue = asked.length ? asked : Object.keys(WANTED);
console.log('balance', JSON.stringify((await call('/user/balance'))));
let failed = 0;
// Three tasks at a time.
await Promise.all([0, 1, 2].map(async () => { for (let id; (id = queue.shift()); ) { try { await generate(id); } catch (e) { failed++; console.error((e as Error).message); } } }));
console.log('balance', JSON.stringify((await call('/user/balance'))), failed ? `${failed} failed` : 'all done');

// Where each model came from, next to the models; and the list the scene draws from (turns kept).
const made = (await Promise.all(Object.keys(WANTED).map((id) => read(resolve(records, `${id}.json`))))).filter((j): j is Job => j?.status === 'downloaded');
await save(resolve(output, 'provenance.json'), { provider: 'Tripo', model: MODEL, options: { face_limit: 4000, texture: true, pbr: false, texture_quality: 'standard' }, note: 'Textures redrawn at 512 px after download.', assets: made.map(({ id, prompt, taskId, credits, at }) => ({ id, prompt, taskId, credits, at })) });
const listPath = resolve('apps/web/src/scene/libraryModels.json');
const list = JSON.parse(await readFile(listPath, 'utf8').catch(() => '{}')) as Record<string, { turn?: number }>;
await writeFile(listPath, JSON.stringify(Object.fromEntries(made.map((j) => [j.id, list[j.id] ?? {}])), null, 2) + '\n');
