import { useEffect, useRef } from 'react';
import { GRID, STAGE_MAX, STAGE_MIN, stageOf } from '@og/machine';
import { useMachine } from './machineStore';
import { STAGE_PRESETS, THEME_FIELDS, THEMES, useSettings, type Theme } from './settings';

/** Stage size for new machines, and the player's own theme. Escape or the backdrop closes it. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { stage, preset, theme, setStage, applyPreset, setColor, reset } = useSettings();
  const current = useMachine((s) => s.machine);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    card.current?.querySelector<HTMLElement>('button, input')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const now = stageOf(current);
  const side = (axis: 'x' | 'z', label: string) => (
    <label className="stage-side">{label}
      <input type="range" min={STAGE_MIN} max={STAGE_MAX} value={stage[axis]} onChange={(e) => setStage({ ...stage, [axis]: Number(e.target.value) })} />
      <output>{stage[axis]}</output>
    </label>
  );
  const colours = (group: 'Interface' | 'Scene') => (
    <div className="theme-colours">
      {THEME_FIELDS.filter((f) => f.group === group).map((f) => (
        <label key={f.key}><input type="color" value={theme[f.key] as string} onChange={(e) => setColor(f.key, e.target.value as Theme[typeof f.key])} />{f.label}</label>
      ))}
    </div>
  );
  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="welcome-card settings-card" ref={card}>
        <button className="settings-close" onClick={onClose} aria-label="Close settings">✕</button>
        <h2>Settings</h2>
        <p className="settings-note">Saved in this browser. Nothing here changes how a machine behaves.</p>

        <section>
          <h3>Stage size for new machines</h3>
          <p className="settings-note">In cells of 0.5 m. The current machine is {now.x} × {now.z}; ask the prompt to “make the stage bigger” to change it.</p>
          <div className="chip-row">
            {STAGE_PRESETS.map((p) => (
              <button key={p.label} aria-pressed={stage.x === p.stage.x && stage.z === p.stage.z} onClick={() => setStage(p.stage)}>{p.label} <small>{p.stage.x}×{p.stage.z}</small></button>
            ))}
          </div>
          {side('x', 'Width')}
          {side('z', 'Depth')}
          {(stage.x !== GRID.x || stage.z !== GRID.z) && <p className="settings-note">Routes are laid out for this size; very small stages leave less room for long chains.</p>}
        </section>

        <section>
          <h3>Theme</h3>
          <div className="chip-row">
            {Object.entries(THEMES).map(([id, t]) => (
              <button key={id} aria-pressed={preset === id} onClick={() => applyPreset(id)}>
                <span className="swatch" style={{ background: `linear-gradient(135deg, ${t.theme.board} 50%, ${t.theme.accent} 50%)` }} />{t.name}
              </button>
            ))}
            {preset === 'custom' && <button aria-pressed disabled>Your own</button>}
          </div>
          <h4>Interface</h4>
          {colours('Interface')}
          <h4>Scene</h4>
          {colours('Scene')}
          <div className="chip-row">
            <label className="toggle"><input type="checkbox" checked={theme.showGrid} onChange={(e) => setColor('showGrid', e.target.checked)} /> Grid lines</label>
            <label className="toggle"><input type="checkbox" checked={theme.scenery} onChange={(e) => setColor('scenery', e.target.checked)} /> Trees and rocks</label>
          </div>
        </section>

        <div className="settings-actions"><button onClick={reset}>Reset to defaults</button><button className="primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
