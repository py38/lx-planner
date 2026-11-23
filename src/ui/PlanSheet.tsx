import { useMemo, useState } from 'react';
import { Sheet } from './kit';
import { useUI } from './UI';
import { getStore, useData } from '../data/store';
import { moveItem } from '../data/actions';
import { suggestSlots } from '../logic/planner';
import { fmtDay, fmtDuration, fmtTime, today } from '../lib/date';
import type { ViewItem } from '../data/types';
import { IconSparkle } from './Icons';

/** Planifier une tâche : créneaux libres suggérés (jamais appliqués sans clic) ou choix manuel. */
export function PlanSheet({ item, onClose }: { item: ViewItem; onClose: () => void }) {
  const state = useData();
  const ui = useUI();
  const settings = getStore().settings;
  const [date, setDate] = useState(item.date ?? today());
  const [start, setStart] = useState(item.start ?? '');
  const suggestions = useMemo(() => suggestSlots(state, item, settings, today(), 21, 6), [state, item, settings]);

  const apply = async (d: string, s?: string) => {
    if (!(await ui.checkSunday(d, item.categoryId))) return;
    moveItem(item.id, d, s ?? null);
    ui.toast(`Planifié · ${fmtDay(d)}${s ? ` à ${fmtTime(s)}` : ''}`);
    onClose();
  };

  return (
    <Sheet title="Planifier" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>{item.title}{item.duration ? ` · ${fmtDuration(item.duration)}` : ' · durée non renseignée (1 h par défaut)'}</p>
      <div className="section-title"><IconSparkle size={14} /> Créneaux libres suggérés</div>
      {suggestions.length ? (
        <div className="col" style={{ gap: 6 }}>
          {suggestions.map((s) => (
            <button key={s.date + s.start} className="item" style={{ textAlign: 'left' }} onClick={() => apply(s.date, s.start)}>
              <div className="body">
                <div className="title">{fmtDay(s.date)} · {fmtTime(s.start)}</div>
                <div className="meta">{s.reason}</div>
              </div>
              <span className="btn small">Choisir</span>
            </button>
          ))}
          <div className="tiny faint">Les suggestions tiennent compte de vos rendez-vous, trajets, marges, de la pause repas, de la charge maximale par jour{settings.sundayProtected ? ' et du dimanche protégé' : ''}. Rien n’est déplacé sans votre choix.</div>
        </div>
      ) : <div className="empty">Aucun créneau libre trouvé dans les 3 prochaines semaines avec vos réglages actuels.</div>}

      <div className="divider" />
      <div className="section-title">Choisir moi-même</div>
      <div className="form-grid">
        <div className="field"><label>Date</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Horaire (facultatif)</label><input className="input" type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} /></div>
      </div>
      <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
        <button className="btn primary" disabled={!date} onClick={() => apply(date, start || undefined)}>Planifier</button>
      </div>
    </Sheet>
  );
}
