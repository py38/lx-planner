import { useUI } from './UI';
import { ItemRow } from './ItemRow';
import { Empty } from './kit';
import { deleteItem, postponeItem } from '../data/actions';
import { addDays, fmtShort, today, weekStart } from '../lib/date';
import type { ViewItem } from '../data/types';

/**
 * Traitement des tâches non réalisées : chaque décision est prise par vous, une par une.
 * Rien n'est reporté automatiquement.
 */
export function PendingList({ items, nextWeekFrom }: { items: ViewItem[]; nextWeekFrom?: string }) {
  const ui = useUI();
  if (!items.length) return <Empty>Rien à traiter. Tout est à jour.</Empty>;
  const nextMonday = addDays(weekStart(nextWeekFrom ?? today()), 7);
  return (
    <div>
      {items.map((it) => {
        const sameDayNextWeek = it.date ? addDays(it.date, 7) : nextMonday;
        const target = sameDayNextWeek < today() ? nextMonday : sameDayNextWeek;
        return (
          <div key={it.id} style={{ marginBottom: 10 }}>
            <ItemRow item={it} showDate />
            <div className="chips" style={{ marginTop: 6, paddingLeft: 4 }}>
              <button className="chip" onClick={() => ui.toggleDone(it)}>C’était fait</button>
              <button className="chip" onClick={() => { postponeItem(it.id, target); ui.toast(`Reporté au ${fmtShort(target)}`); }}>Semaine suivante ({fmtShort(target)})</button>
              <button className="chip" onClick={() => ui.plan(it)}>Reprogrammer…</button>
              <button className="chip" onClick={() => { postponeItem(it.id, null); ui.toast('Laissé dans « À planifier »'); }}>À planifier</button>
              <button className="chip" style={{ color: 'var(--danger)' }} onClick={async () => {
                if (it.seriesId) { deleteItem(it.id, 'one'); ui.toast('Occurrence supprimée'); return; }
                if (await ui.confirm(`Supprimer « ${it.title} » ?`, { ok: 'Supprimer', danger: true })) { deleteItem(it.id); ui.toast('Supprimé'); }
              }}>Supprimer</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
