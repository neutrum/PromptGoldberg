/**
 * The emotional shell, one copy for every page (the game, /docs, /rube): full colour while the
 * player is here; idle for a few seconds and the whole screen slowly drains to black and white; any
 * key, click, scroll or real mouse move brings the colour back within a second. Only saturation
 * changes, never contrast. Settings → Colour → "Always full colour" turns it off (kept in this browser).
 * The game calls pgShell.wake() while a run plays or the AI works, so watching is not idle.
 */
(() => {
  const FULL = 10, IDLE_MS = 6000, DRAIN = 0.5, KEY = 'pg.colour.always';
  const root = document.documentElement;
  let score = FULL, active = Date.now(), last = null, shown = 1;
  let always = false;
  try { always = localStorage.getItem(KEY) === '1'; } catch (e) { /* private mode */ }
  const paint = () => {
    const p = Math.min(1, score / FULL), n = always ? 1 : p * p * (3 - 2 * p);
    // Colour comes in within a second and drains away slowly.
    root.style.transition = n >= shown ? 'filter 1s ease-out' : 'filter 2.5s ease-in-out';
    shown = n;
    root.style.filter = n >= 1 ? '' : 'saturate(' + n.toFixed(3) + ')';
  };
  const wake = () => { active = Date.now(); if (score < FULL) { score = FULL; paint(); } };
  for (const kind of ['keydown', 'pointerdown', 'wheel', 'scroll', 'submit']) addEventListener(kind, wake, { capture: true, passive: true });
  addEventListener('pointermove', (e) => {
    if (!last || Math.hypot(e.clientX - last.x, e.clientY - last.y) > 6) { last = { x: e.clientX, y: e.clientY }; wake(); }
  }, { passive: true });
  setInterval(() => { if (score > 0 && Date.now() - active > IDLE_MS) { score = Math.max(0, score - DRAIN / 4); paint(); } }, 250);
  window.pgShell = {
    wake,
    always: () => always,
    setAlways(on) { always = on; try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* private mode */ } paint(); },
  };
  paint();
})();
