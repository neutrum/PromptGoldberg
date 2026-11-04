import { lazy, Suspense, useEffect, useState } from 'react';
import { MachineScreen } from '../ui/MachineScreen';

// The recipe library's review page, a development tool: only loaded at #recipes.
const RecipeReview = lazy(() => import('../review/RecipeReview').then((m) => ({ default: m.RecipeReview })));

/** Prompt Goldberg is one screen: the workshop. #recipes opens the recipe library's review page. */
export function App() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  if (hash === '#recipes') return <Suspense fallback={null}><RecipeReview /></Suspense>;
  return <MachineScreen />;
}
