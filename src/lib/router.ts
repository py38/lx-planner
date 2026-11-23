import { useEffect, useState } from 'react';

/** Routage par « hash » (#/jour/2026-11-25) : fonctionne hors ligne et sur n'importe quel hébergement statique. */
export function useRoute(): string[] {
  const get = () => (window.location.hash.replace(/^#\/?/, '') || 'jour').split('/').map(decodeURIComponent);
  const [r, setR] = useState(get);
  useEffect(() => {
    const on = () => {
      setR(get());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
export const go = (path: string) => {
  window.location.hash = '/' + path;
};
export const href = (path: string) => '#/' + path;
