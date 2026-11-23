// Fenêtres globales (édition, validation, confirmation, choix de portée, planification) et notifications internes.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Sheet } from './kit';
import { ItemEditor, type Draft } from './ItemEditor';
import { PlanSheet } from './PlanSheet';
import { getStore } from '../data/store';
import { unvalidateItem, validateItem, type Scope } from '../data/actions';
import { fmtDuration, isSunday } from '../lib/date';
import type { ContentPiece, ViewItem } from '../data/types';
import { ContentEditor } from '../views/content/ContentEditor';
import { go } from '../lib/router';

interface Toast { id: number; text: string; action?: { label: string; run: () => void } }
interface UIApi {
  openItem: (id: string) => void;
  newItem: (draft?: Draft) => void;
  toggleDone: (item: ViewItem) => void;
  adjustTime: (item: ViewItem) => void;
  confirm: (text: ReactNode, opts?: { ok?: string; cancel?: string; danger?: boolean; title?: string }) => Promise<boolean>;
  askScope: (verb: string) => Promise<Scope | null>;
  toast: (text: string, action?: Toast['action']) => void;
  plan: (item: ViewItem) => void;
  /** Dimanche protégé : simple avertissement, jamais un blocage */
  checkSunday: (date: string | undefined, categoryId: string | undefined) => Promise<boolean>;
}
const Ctx = createContext<UIApi>(null as unknown as UIApi);
export const useUI = () => useContext(Ctx);

export function UIProvider({ children }: { children: ReactNode }) {
  const [editor, setEditor] = useState<{ id?: string; draft?: Draft; key: number } | null>(null);
  const [timeFor, setTimeFor] = useState<ViewItem | null>(null);
  const [contentEdit, setContentEdit] = useState<ContentPiece | null>(null);
  const [planFor, setPlanFor] = useState<ViewItem | null>(null);
  const [confirmState, setConfirm] = useState<{ text: ReactNode; opts: any; resolve: (b: boolean) => void } | null>(null);
  const [scopeState, setScope] = useState<{ verb: string; resolve: (s: Scope | null) => void } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const tid = useRef(0);

  const toast = useCallback((text: string, action?: Toast['action']) => {
    const id = ++tid.current;
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6000 : 3000);
  }, []);

  const confirm = useCallback<UIApi['confirm']>((text, opts = {}) => new Promise((resolve) => setConfirm({ text, opts, resolve })), []);
  const askScope = useCallback((verb: string) => new Promise<Scope | null>((resolve) => setScope({ verb, resolve })), []);

  const toggleDone = useCallback((item: ViewItem) => {
    if (item.id.startsWith('cp:')) {
      if (item.status === 'done') { unvalidateItem(item.id); toast('Publication décochée'); }
      else { validateItem(item.id, 0); toast('Marqué comme publié ✓'); }
      return;
    }
    if (item.status === 'done') {
      unvalidateItem(item.id);
      toast('Validation annulée');
      return;
    }
    const minutes = item.duration ?? 0;
    const done = validateItem(item.id, minutes);
    if (done) toast(`Validée${minutes ? ` · ${fmtDuration(minutes)} réalisées` : ''}`, { label: 'Ajuster le temps', run: () => setTimeFor(done) });
  }, [toast]);

  const checkSunday = useCallback(async (date?: string, categoryId?: string) => {
    const st = getStore();
    if (!date || !st.settings?.sundayProtected || !isSunday(date)) return true;
    if (!categoryId || st.get('categories', categoryId)?.kind !== 'pro') return true;
    return confirm('Le dimanche est protégé pour l’église, le repos et la famille. Ajouter quand même cette activité professionnelle ce dimanche ?', { ok: 'Oui, exceptionnellement', title: 'Dimanche protégé' });
  }, [confirm]);

  const api: UIApi = {
    openItem: (id) => {
      // éléments venant du calendrier de contenu : on ouvre la fiche contenu (ou la journée de tournage)
      if (id.startsWith('cp:')) { const c = getStore().get('contents', id.slice(3)); if (c) setContentEdit(c); return; }
      if (id.startsWith('cs:')) { go(`contenu/tournage/${id.slice(3)}`); return; }
      setEditor({ id, key: Date.now() });
    },
    newItem: (draft) => setEditor({ draft: draft ?? {}, key: Date.now() }),
    toggleDone,
    adjustTime: (item) => setTimeFor(item),
    confirm,
    askScope,
    toast,
    plan: (item) => setPlanFor(item),
    checkSunday,
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      {editor && <ItemEditor key={editor.key} id={editor.id} draft={editor.draft} onClose={() => setEditor(null)} />}
      {planFor && <PlanSheet item={planFor} onClose={() => setPlanFor(null)} />}
      {contentEdit && <ContentEditor key={contentEdit.id} value={contentEdit} onClose={() => setContentEdit(null)} />}
      {timeFor && <TimeDialog item={timeFor} onClose={() => setTimeFor(null)} />}
      {confirmState && (
        <Sheet title={confirmState.opts.title ?? 'Confirmation'} onClose={() => { confirmState.resolve(false); setConfirm(null); }}
          footer={<>
            <button className="btn" onClick={() => { confirmState.resolve(false); setConfirm(null); }}>{confirmState.opts.cancel ?? 'Annuler'}</button>
            <button className={`btn primary`} style={confirmState.opts.danger ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : undefined} onClick={() => { confirmState.resolve(true); setConfirm(null); }}>{confirmState.opts.ok ?? 'Confirmer'}</button>
          </>}>
          <div style={{ fontSize: 15 }}>{confirmState.text}</div>
        </Sheet>
      )}
      {scopeState && (
        <Sheet title="Élément récurrent" onClose={() => { scopeState.resolve(null); setScope(null); }}>
          <p className="muted" style={{ marginTop: 0 }}>Que voulez-vous {scopeState.verb} ?</p>
          <div className="col">
            {([['one', 'Cette occurrence uniquement'], ['future', 'Cette occurrence et les suivantes'], ['all', 'Toute la série (les occurrences déjà réalisées sont conservées)']] as [Scope, string][]).map(([s, l]) => (
              <button key={s} className="btn" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => { scopeState.resolve(s); setScope(null); }}>{l}</button>
            ))}
          </div>
        </Sheet>
      )}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <span>{t.text}</span>
            {t.action && <button onClick={() => { t.action!.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Saisie du temps réellement passé (optionnelle, pré-remplie avec la durée prévue). */
function TimeDialog({ item, onClose }: { item: ViewItem; onClose: () => void }) {
  const cur = getStore().get('items', item.id) ?? item;
  const [min, setMin] = useState<number>(cur.actualMinutes ?? cur.duration ?? 0);
  const save = () => {
    validateItem(cur.id, min);
    onClose();
  };
  return (
    <Sheet title="Temps réellement passé" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button></>}>
      <p className="muted small" style={{ marginTop: 0 }}>{cur.title}{cur.duration ? ` · prévu : ${fmtDuration(cur.duration)}` : ''}</p>
      <div className="chips" style={{ marginBottom: 12 }}>
        {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
          <button key={m} className={`chip ${min === m ? 'on' : ''}`} onClick={() => setMin(m)}>{fmtDuration(m)}</button>
        ))}
      </div>
      <div className="field">
        <label>Minutes</label>
        <input className="input" type="number" inputMode="numeric" min={0} value={min} onChange={(e) => setMin(Math.max(0, +e.target.value))} />
      </div>
    </Sheet>
  );
}
