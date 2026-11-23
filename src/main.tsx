import { createRoot } from 'react-dom/client';
import '@fontsource/poppins/300.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import './styles.css';
import { App } from './App';
import { getStore } from './data/store';
import { getSync } from './data/sync';
import { runMigrations } from './data/migrations';

// une seule racine React, même si le module est ré-exécuté (rechargement à chaud en développement)
const w = window as unknown as { __lxRoot?: ReturnType<typeof createRoot> };
const root = (w.__lxRoot ??= createRoot(document.getElementById('root')!));

function Fatal({ error }: { error: string }) {
  return (
    <div style={{ padding: 32, maxWidth: 520, margin: '40px auto', fontFamily: 'Poppins, sans-serif' }}>
      <h2>Impossible d’ouvrir vos données</h2>
      <p>Le stockage local de ce navigateur n’est pas accessible ({error}). En navigation privée, les données ne peuvent pas être conservées.</p>
      <button onClick={() => location.reload()}>Réessayer</button>
    </div>
  );
}

(async () => {
  try {
    await getStore().init();
  } catch (e: any) {
    root.render(<Fatal error={e?.message ?? String(e)} />);
    return;
  }
  // la Banque d'idées utilise désormais les fiches contenu : conversion des anciennes idées (sans doublon)
  try { runMigrations(getStore()); } catch (e) { console.error('Migration des idées', e); }
  // demande au navigateur de ne pas effacer automatiquement les données
  navigator.storage?.persist?.().catch(() => {});
  root.render(<App />);
  getSync().start().catch((e) => console.error(e));
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn('Service worker', e));
  }
})();
