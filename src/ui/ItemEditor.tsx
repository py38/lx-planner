import { useMemo, useState } from 'react';
import { Sheet, Seg, PRIORITY_LABEL, STATUS_LABEL, CatDot } from './kit';
import { useUI } from './UI';
import { getStore, useData } from '../data/store';
import { createItem, deleteItem, duplicateItem, postponeItem, updateItem, updateSeriesRule } from '../data/actions';
import { isVirtualId, parseVirtualId, virtualItem } from '../logic/recurrence';
import { REMINDER_PRESETS, describeReminder } from '../logic/reminders';
import { addDays, fmtDuration, fmtLong, today, weekday, WEEKDAYS_SHORT, weekStart } from '../lib/date';
import { uid } from '../lib/id';
import type { Item, ItemKind, Priority, RecurrenceRule, Reminder, Status } from '../data/types';
import { IconRepeat, IconTrash, IconX } from './Icons';

export type Draft = Partial<Item> & { recurrence?: Omit<RecurrenceRule, 'start'> };

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];
type RecMode = 'none' | 'daily' | 'weekly' | 'monthly' | 'interval';

export function ItemEditor({ id, draft, onClose }: { id?: string; draft?: Draft; onClose: () => void }) {
  const state = useData();
  const ui = useUI();
  const store = getStore();

  const original: Item | undefined = useMemo(() => {
    if (!id) return undefined;
    if (isVirtualId(id)) {
      const { seriesId, date } = parseVirtualId(id);
      const s = store.get('series', seriesId);
      return s ? virtualItem(s, date) : undefined;
    }
    return store.get('items', id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const series = original?.seriesId ? store.get('series', original.seriesId) : undefined;
  const isNew = !original;

  const [f, setF] = useState<Partial<Item>>(() => original ?? {
    kind: 'task', priority: 'important', status: 'todo', ...draft,
  });
  const set = <K extends keyof Item>(k: K, v: Item[K] | undefined) => setF((x) => ({ ...x, [k]: v }));
  const [rec, setRec] = useState<RecMode>(draft?.recurrence?.freq ?? (series ? series.rule.freq : 'none'));
  const [recInterval, setRecInterval] = useState<number>(draft?.recurrence?.interval ?? series?.rule.interval ?? 1);
  const [recDays, setRecDays] = useState<number[]>(draft?.recurrence?.weekdays ?? series?.rule.weekdays ?? (f.date ? [weekday(f.date)] : [1]));
  const [recUntil, setRecUntil] = useState<string>(series?.rule.until ?? '');
  const [more, setMore] = useState<boolean>(!!(original?.description || original?.notes || original?.links?.length));
  const [error, setError] = useState('');

  const categories = state.categories ? Object.values(state.categories).filter((c) => !c.deleted && !c.archived).sort((a, b) => a.order - b.order) : [];
  const projects = Object.values(state.projects).filter((p) => !p.deleted && p.status !== 'done');
  const habits = Object.values(state.habits).filter((h) => !h.deleted && !h.archived);
  const clientCat = categories.find((c) => c.name === 'Rendez-vous clientes');

  const setKind = (k: ItemKind) => {
    setF((x) => ({ ...x, kind: k, categoryId: k === 'appointment' && clientCat && !x.categoryId ? clientCat.id : x.categoryId, confirmed: k === 'appointment' ? x.confirmed ?? true : x.confirmed }));
  };

  const buildRule = (): Omit<RecurrenceRule, 'start'> | undefined => {
    if (rec === 'none') return undefined;
    return { freq: rec, interval: Math.max(1, recInterval || 1), weekdays: rec === 'weekly' ? recDays : undefined, until: recUntil || undefined };
  };

  const save = async () => {
    if (!f.title?.trim()) { setError('Ajoutez un titre'); return; }
    const data: Partial<Item> = { ...f, title: f.title.trim() };
    if (!data.date) data.start = undefined;
    if (data.date !== original?.date || data.categoryId !== original?.categoryId) {
      if (!(await ui.checkSunday(data.date, data.categoryId))) return;
    }
    const rule = buildRule();
    if (isNew) {
      if (rule && !data.date) { setError('Choisissez une date de début pour la répétition'); return; }
      createItem(data as any, rule ? { ...rule, start: data.date } : undefined);
      ui.toast(rule ? 'Série créée' : data.date ? 'Ajouté au planning' : 'Ajouté à « À planifier »');
      onClose();
      return;
    }
    const patch: Partial<Item> = {};
    for (const k of Object.keys(data) as (keyof Item)[]) if (JSON.stringify(data[k]) !== JSON.stringify(original![k])) (patch as any)[k] = data[k];
    for (const k of Object.keys(original!) as (keyof Item)[]) if (!(k in data)) (patch as any)[k] = undefined;
    delete (patch as any).virtual;
    let scope: 'one' | 'future' | 'all' = 'one';
    const templateChanged = Object.keys(patch).some((k) => !['date', 'status', 'actualMinutes', 'completedAt', 'notes'].includes(k));
    if (series && templateChanged) {
      const s = await ui.askScope('modifier');
      if (!s) return;
      scope = s;
    }
    if (Object.keys(patch).length) updateItem(original!.id, patch, scope);
    if (series && rule && JSON.stringify({ ...series.rule, ...rule, start: series.rule.start }) !== JSON.stringify(series.rule)) {
      updateSeriesRule(series.id, { ...series.rule, ...rule, until: recUntil || undefined });
    }
    ui.toast('Modifications enregistrées');
    onClose();
  };

  const remove = async () => {
    if (series) {
      const s = await ui.askScope('supprimer');
      if (!s) return;
      deleteItem(original!.id, s);
    } else {
      if (!(await ui.confirm(`Supprimer « ${original!.title} » ?`, { ok: 'Supprimer', danger: true }))) return;
      deleteItem(original!.id);
    }
    ui.toast('Supprimé');
    onClose();
  };

  const postpone = (to: string | null) => {
    postponeItem(original!.id, to);
    ui.toast(to ? `Reporté au ${fmtLong(to)}` : 'Renvoyé dans « À planifier »');
    onClose();
  };

  const addReminder = (r: Omit<Reminder, 'id'>) => set('reminders', [...(f.reminders ?? []), { ...r, id: uid() }]);
  const kindLabel = { task: 'Tâche', appointment: 'RDV cliente', event: 'Événement' };

  return (
    <Sheet
      onClose={onClose}
      title={isNew ? 'Nouvel élément' : series ? <span className="row"><IconRepeat size={16} /> Occurrence</span> : 'Modifier'}
      footer={<>
        {!isNew && <button className="btn ghost danger" onClick={remove} style={{ marginRight: 'auto' }}><IconTrash size={16} /> Supprimer</button>}
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" onClick={save}>{isNew ? 'Ajouter' : 'Enregistrer'}</button>
      </>}
    >
      <div className="col" style={{ gap: 14 }}>
        <Seg value={(f.kind ?? 'task') as ItemKind} onChange={setKind} options={(['task', 'appointment', 'event'] as ItemKind[]).map((k) => ({ value: k, label: kindLabel[k] }))} />
        <input className="input title-input" autoFocus={isNew} placeholder={f.kind === 'appointment' ? 'Ex : Pose gel — Sarah' : 'Titre'} value={f.title ?? ''} onChange={(e) => { set('title', e.target.value); setError(''); }} />
        {error && <div className="banner danger">{error}</div>}

        <div className="field">
          <label>Catégorie</label>
          <div className="chips">
            {categories.map((c) => (
              <button key={c.id} type="button" className={`chip ${f.categoryId === c.id ? 'on' : ''}`} onClick={() => set('categoryId', f.categoryId === c.id ? undefined : c.id)}>
                <CatDot cat={c} /> {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Date</label>
            <input className="input" type="date" value={f.date ?? ''} onChange={(e) => set('date', e.target.value || undefined)} />
          </div>
          <div className="field">
            <label>Horaire</label>
            <input className="input" type="time" step={300} value={f.start ?? ''} disabled={!f.date} onChange={(e) => set('start', e.target.value || undefined)} />
          </div>
          {!f.date && <div className="full tiny faint">Sans date, l’élément reste visible dans « À planifier » jusqu’à ce que vous le planifiiez.</div>}
          <div className="field full">
            <label>Durée {f.duration ? `· ${fmtDuration(f.duration)}` : ''}</label>
            <div className="chips">
              {DURATIONS.map((d) => <button key={d} type="button" className={`chip ${f.duration === d ? 'on' : ''}`} onClick={() => set('duration', f.duration === d ? undefined : d)}>{fmtDuration(d)}</button>)}
              <input className="input" style={{ width: 96, minHeight: 32, padding: '4px 10px', fontSize: 14 }} type="number" min={0} step={5} inputMode="numeric" placeholder="min" value={f.duration ?? ''} onChange={(e) => set('duration', e.target.value ? +e.target.value : undefined)} />
            </div>
          </div>
        </div>

        {f.kind === 'appointment' && (
          <div className="form-grid">
            <div className="field"><label>Cliente</label><input className="input" value={f.client ?? ''} onChange={(e) => set('client', e.target.value || undefined)} /></div>
            <div className="field"><label>Prestation</label><input className="input" value={f.service ?? ''} onChange={(e) => set('service', e.target.value || undefined)} /></div>
            <label className="check full"><input type="checkbox" checked={f.confirmed ?? false} onChange={(e) => set('confirmed', e.target.checked)} /> Rendez-vous confirmé (jamais déplacé automatiquement)</label>
          </div>
        )}

        <div className="field">
          <label>Priorité</label>
          <Seg value={(f.priority ?? 'important') as Priority} onChange={(p) => set('priority', p)} options={(['must', 'important', 'optional'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Statut</label>
            <select className="input" value={f.status ?? 'todo'} onChange={(e) => set('status', e.target.value as Status)}>
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Échéance finale</label>
            <input className="input" type="date" value={f.deadline ?? ''} onChange={(e) => set('deadline', e.target.value || undefined)} />
          </div>
          {f.status === 'done' && (
            <div className="field full">
              <label>Temps réellement passé (minutes)</label>
              <input className="input" type="number" min={0} inputMode="numeric" value={f.actualMinutes ?? f.duration ?? 0} onChange={(e) => set('actualMinutes', Math.max(0, +e.target.value))} />
            </div>
          )}
        </div>

        {/* Répétition */}
        {(isNew || series) && (
          <div className="field">
            <label>Répétition {series && <span className="faint">(règle de la série)</span>}</label>
            <select className="input" value={rec} disabled={!!series && rec === 'none'} onChange={(e) => setRec(e.target.value as RecMode)}>
              {!series && <option value="none">Ne se répète pas</option>}
              <option value="daily">Tous les jours</option>
              <option value="weekly">Certains jours de la semaine</option>
              <option value="monthly">Tous les mois (même date)</option>
              <option value="interval">Tous les X jours</option>
            </select>
            {rec === 'weekly' && (
              <div className="chips" style={{ marginTop: 6 }}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <button key={d} type="button" className={`chip ${recDays.includes(d) ? 'on' : ''}`} onClick={() => setRecDays((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d])}>{WEEKDAYS_SHORT[d]}</button>
                ))}
              </div>
            )}
            {rec !== 'none' && (
              <div className="form-grid" style={{ marginTop: 6 }}>
                <div className="field">
                  <label>{rec === 'interval' ? 'Tous les … jours' : rec === 'weekly' ? 'Toutes les … semaines' : rec === 'monthly' ? 'Tous les … mois' : 'Tous les … jours'}</label>
                  <input className="input" type="number" min={1} value={recInterval} onChange={(e) => setRecInterval(Math.max(1, +e.target.value))} />
                </div>
                <div className="field"><label>Jusqu’au (facultatif)</label><input className="input" type="date" value={recUntil} onChange={(e) => setRecUntil(e.target.value)} /></div>
              </div>
            )}
          </div>
        )}

        {/* Rappels */}
        <div className="field">
          <label>Rappels</label>
          <div className="chips">
            {(f.reminders ?? []).map((r) => (
              <span key={r.id} className={`chip ${r.disabled ? 'faint' : ''}`}>
                {describeReminder(r)}{r.disabled ? ' (désactivé)' : ''}
                <button type="button" className="icon-btn ghost small" style={{ width: 18, height: 18 }} aria-label="Retirer" onClick={() => set('reminders', (f.reminders ?? []).filter((x) => x.id !== r.id))}><IconX size={12} /></button>
              </span>
            ))}
            <select className="input" style={{ width: 'auto', minHeight: 32, padding: '4px 30px 4px 10px', fontSize: 13 }} value="" onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom') {
                const n = prompt('Rappel personnalisé : combien de minutes avant le début ? (ex : 30, 120, 2880 pour 2 jours)');
                if (n && +n > 0) addReminder({ offsetMin: +n, anchor: 'start' });
              } else if (v) {
                const p = REMINDER_PRESETS[+v];
                addReminder({ offsetMin: p.offsetMin, anchor: p.anchor });
              }
            }}>
              <option value="">+ Ajouter un rappel</option>
              {REMINDER_PRESETS.map((p, i) => <option key={i} value={i} disabled={p.anchor === 'deadline' && !f.deadline}>{p.label}</option>)}
              <option value="custom">Personnalisé…</option>
            </select>
          </div>
        </div>

        <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setMore((m) => !m)}>{more ? 'Moins d’options' : 'Plus d’options (projet, notes, liens, trajet…)'}</button>
        {more && (
          <div className="col" style={{ gap: 12 }}>
            <div className="form-grid">
              <div className="field">
                <label>Projet</label>
                <select className="input" value={f.projectId ?? ''} onChange={(e) => set('projectId', e.target.value || undefined)}>
                  <option value="">Aucun</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Habitude liée</label>
                <select className="input" value={f.habitId ?? ''} onChange={(e) => set('habitId', e.target.value || undefined)}>
                  <option value="">Aucune</option>
                  {habits.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Trajet avant (min)</label>
                <input className="input" type="number" min={0} step={5} value={f.travelMin ?? ''} onChange={(e) => set('travelMin', e.target.value ? +e.target.value : undefined)} />
              </div>
            </div>
            <div className="field"><label>Description</label><textarea className="input" value={f.description ?? ''} onChange={(e) => set('description', e.target.value || undefined)} /></div>
            <div className="field"><label>Notes</label><textarea className="input" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value || undefined)} /></div>
            <div className="field">
              <label>Liens (un par ligne)</label>
              <textarea className="input" style={{ minHeight: 60 }} value={(f.links ?? []).join('\n')} onChange={(e) => set('links', e.target.value ? e.target.value.split('\n') : undefined)} />
              {(f.links ?? []).filter((l) => /^https?:\/\//.test(l.trim())).map((l) => <a key={l} className="small" href={l.trim()} target="_blank" rel="noreferrer">{l.trim()}</a>)}
            </div>
          </div>
        )}

        {!isNew && original!.status !== 'done' && (
          <div className="field">
            <label>Reporter</label>
            <div className="chips">
              <button className="chip" onClick={() => postpone(addDays(original!.date && original!.date >= today() ? original!.date : today(), 1))}>Au lendemain</button>
              <button className="chip" onClick={() => postpone(addDays(weekStart(original!.date ?? today()), 7 + ((weekday(original!.date ?? today()) + 6) % 7)))}>Semaine suivante</button>
              {original!.date && <button className="chip" onClick={() => postpone(null)}>Dans « À planifier »</button>}
              <button className="chip" onClick={() => { onClose(); ui.plan(original!); }}>Trouver un créneau…</button>
            </div>
          </div>
        )}
        {!isNew && (
          <div className="row wrap">
            <button className="btn small" onClick={() => { duplicateItem(original!.id); ui.toast('Copie créée'); onClose(); }}>Dupliquer</button>
            {original!.completedAt && <span className="tiny faint">Validée le {new Date(original!.completedAt).toLocaleString('fr-FR')}</span>}
          </div>
        )}
      </div>
    </Sheet>
  );
}
