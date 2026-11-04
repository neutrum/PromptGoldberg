import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../ui/index.css';
import '../ui/game.css';
import '../ui/machine.css';
import { startColour } from '../ui/colour';

// The screen starts in black and white; the player's words bring the colour.
startColour();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
