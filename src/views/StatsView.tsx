import { useMemo, useState } from 'react';
import { getStore, useData } from '../data/store';
import { Empty, Seg, Sheet } from '../ui/kit';
import { PendingList } from '../ui/PendingList';
import { periodStats, type PeriodStats } from '../logic/stats';
import { expandRange } from '../logic/recurrence';
import {
  addDays, addMonths, fmt, fmtHours, fmtMonth, fmtShort, monthEnd, monthStart, today, weekStart, yearEnd, yearStart, isoWeekNumber,
} from '../lib/date';
import { go, href } from '../lib/router';
import { IconLeft, IconRight } from '../ui/Icons';
import type { WeeklyReview } from '../data/types';

type Kind = 'week' | 'month' | 'year';
const range = (k: Kind, ref: string): [string, string] =>
  k === 'week' ? [weekStart(ref), addDays(weekStart(ref), 6)] : k === 'month' ? [monthStart(ref), monthEnd(ref)] : [yearStart(ref), yearEnd(ref)];
const shift = (k: Kind, ref: string, n: number) => (k === 'week' ? addDays(ref, 7 * n) : k === 'month' ? addMonths(ref, n) : addMonths(ref, 12 * n));
const label = (k: Kind, ref: string) => {
  const [s, e] = range(k, ref);
  return k === 'week' ? `Sem. ${isoWeekNumber(s)} · ${fmt(s, 'd MMM')} – ${fmt(e, 'd MMM')}` : k === 'month' ? fmtMonth(s) : s.slice(0, 4);
};

/** Phrases d'analyse bienveillantes, calculées à partir des données. */
export function insights(st: PeriodStats): string[] {
  const out: string[] = [];
  const t = st.totals;
  if (t.plannedMin === 0 && t.done === 0) return ['Aucune activité professionnelle planifiée sur cette période.'];
  if (t.plannedMin) out.push(`Vous avez réalisé ${fmtHours(t.actualMin)} sur ${fmtHours(t.plannedMin)} prévues (${t.pct} %).`);
  const over = st.categories.filter((c) => c.actualMin > c.plannedMin * 1.15 && c.plannedMin > 0);
  if (over.length) out.push(`${over.map((c) => c.name).join(', ')} ${over.length > 1 ? 'ont' : 'a'} demandé plus de temps que prévu : pensez à prévoir des durées plus larges.`);
  const missed = [...st.categories].sort((a, b) => b.notDone - a.notDone)[0];
  if (missed && missed.notDone >= 2) out.push(`Les tâches non réalisées se concentrent sur « ${missed.name} » (${missed.notDone}). Peut-être un volume trop ambitieux ou des créneaux à mieux protéger.`);
  if (st.postponed >= 3) out.push(`${st.postponed} reports cette période : découper certaines tâches pourrait aider.`);
  if (t.taskPct >= 80) out.push('Très belle régularité sur ce que vous aviez prévu.');
  return out;
}

export function StatsBlocks({ st }: { st: PeriodStats }) {
  const max = Math.max(1, ...st.categories.map((c) => Math.max(c.plannedMin, c.actualMin)));
  return (
    <>
      <div className="grid-3">
        <div className="kpi-card"><div className="l">Heures réalisées / prévues</div><div className="big-num">{fmtHours(st.totals.actualMin)}</div><div className="sub">sur {fmtHours(st.totals.plannedMin)} prévues · {st.totals.pct} %</div></div>
        <div className="kpi-card"><div className="l">Tâches terminées</div><div className="big-num">{st.totals.done}</div><div className="sub">{st.totals.notDone} non terminée(s) · {st.totals.upcoming} à venir · {st.postponed} report(s)</div></div>
        <div className="kpi-card"><div className="l">Rendez-vous clientes réalisés</div><div className="big-num">{st.appointmentsDone}</div><div className="sub">{st.projects.done} projet(s) terminé(s) · {st.projects.active} en cours</div></div>
        <div className="kpi-card"><div className="l">Séances de sport validées</div><div className="big-num">{st.sportSessions}</div><div className="sub">HYROX + running</div></div>
        <div className="kpi-card"><div className="l">Habitudes</div><div className="big-num">{st.habits.pct} %</div><div className="sub">{st.habits.validations} validation(s)</div></div>
        <div className="kpi-card"><div className="l">Taux de réalisation des tâches</div><div className="big-num">{st.totals.taskPct} %</div><div className="sub">{st.objectivesReached} objectif(s) atteint(s)</div></div>
      </div>
      <div className="card section">
        <div className="card-head"><h3>Par catégorie professionnelle</h3>
          <div className="legend"><span><i style={{ background: 'var(--surface-3)' }} />Prévu</span><span><i style={{ background: 'var(--ink)' }} />Réalisé</span></div>
        </div>
        <div className="hbars">
          {st.categories.map((c) => (
            <div key={c.categoryId} className="hb">
              <span className="row small"><span className="cat-dot" style={{ background: c.color }} />{c.name}</span>
              <div className="track">
                <span className="planned" style={{ width: `${(c.plannedMin / max) * 100}%` }} />
                <span className="actual" style={{ width: `${(c.actualMin / max) * 100}%`, background: c.color }} />
              </div>
              <span className="small" style={{ textAlign: 'right' }}>{fmtHours(c.actualMin)} <span className="faint">/ {fmtHours(c.plannedMin)}</span></span>
            </div>
          ))}
        </div>
        <table className="compare-table" style={{ marginTop: 10 }}>
          <thead><tr><th>Catégorie</th><th>Réalisation</th><th>Terminées</th><th>Non terminées</th></tr></thead>
          <tbody>{st.categories.map((c) => <tr key={c.categoryId}><td>{c.name}</td><td>{c.plannedMin ? `${c.pct} %` : '—'}</td><td>{c.done}</td><td>{c.notDone}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

export function StatsView() {
  const state = useData();
  const [kind, setKind] = useState<Kind>('month');
  const [ref, setRef] = useState(today());
  const [compare, setCompare] = useState(true);
  const [s, e] = range(kind, ref);
  const st = useMemo(() => periodStats(state, s, e), [state, s, e]);
  const prevRef = shift(kind, ref, -1);
  const prev = useMemo(() => periodStats(state, ...range(kind, prevRef)), [state, kind, prevRef]);
  const trend = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const r = shift(kind, ref, i - 5);
    const x = periodStats(state, ...range(kind, r));
    return { label: kind === 'week' ? `S${isoWeekNumber(range(kind, r)[0])}` : kind === 'month' ? fmt(r, 'MMM') : r.slice(0, 4), actual: x.totals.actualMin, planned: x.totals.plannedMin, sport: x.sportSessions };
  }), [state, kind, ref]);
  const tmax = Math.max(1, ...trend.map((t) => Math.max(t.actual, t.planned)));
  const reviews = Object.values(state.reviews).filter((r) => !r.deleted).sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  const rows: [string, number, number, (n: number) => string][] = [
    ['Heures réalisées', st.totals.actualMin, prev.totals.actualMin, fmtHours],
    ['Heures prévues', st.totals.plannedMin, prev.totals.plannedMin, fmtHours],
    ...st.categories.map((c) => [`· ${c.name}`, c.actualMin, prev.categories.find((p) => p.categoryId === c.categoryId)?.actualMin ?? 0, fmtHours] as [string, number, number, (n: number) => string]),
    ['Tâches terminées', st.totals.done, prev.totals.done, String],
    ['Rendez-vous clientes', st.appointmentsDone, prev.appointmentsDone, String],
    ['Séances de sport', st.sportSessions, prev.sportSessions, String],
    ['Habitudes (%)', st.habits.pct, prev.habits.pct, (n) => `${n} %`],
    ['Projets terminés', st.projects.done, prev.projects.done, String],
  ];

  return (
    <div>
      <div className="page-head">
        <div className="title-block"><div className="eyebrow">Bilans & statistiques</div><h1>{label(kind, ref)}</h1></div>
        <div className="row wrap">
          <Seg value={kind} onChange={(k) => setKind(k)} options={[{ value: 'week', label: 'Semaine' }, { value: 'month', label: 'Mois' }, { value: 'year', label: 'Année' }]} />
          <button className="icon-btn" aria-label="Période précédente" onClick={() => setRef(shift(kind, ref, -1))}><IconLeft /></button>
          <button className="icon-btn" aria-label="Période suivante" onClick={() => setRef(shift(kind, ref, 1))}><IconRight /></button>
        </div>
      </div>
      <div className="banner soft" style={{ marginBottom: 14 }}>
        <span className="grow">Toutes les statistiques reposent uniquement sur ce que vous avez validé. Une tâche planifiée n’est jamais comptée comme réalisée.</span>
      </div>
      {insights(st).length > 0 && <div className="card" style={{ marginBottom: 14 }}>{insights(st).map((t, i) => <p key={i} style={{ margin: '4px 0' }} className="small">{t}</p>)}</div>}
      <StatsBlocks st={st} />

      <div className="grid-2 section">
        <div className="card">
          <div className="card-head"><h3>Évolution · heures pro</h3><div className="legend"><span><i style={{ background: 'var(--surface-3)' }} />Prévu</span><span><i style={{ background: 'var(--ink)' }} />Réalisé</span></div></div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 150, paddingTop: 10 }}>
            {trend.map((t, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%' }}>
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', gap: 3, justifyContent: 'center' }}>
                  <div title={`Prévu ${fmtHours(t.planned)}`} style={{ width: '38%', height: `${(t.planned / tmax) * 100}%`, background: 'var(--surface-3)', borderRadius: 4, minHeight: 2 }} />
                  <div title={`Réalisé ${fmtHours(t.actual)}`} style={{ width: '38%', height: `${(t.actual / tmax) * 100}%`, background: 'var(--ink)', borderRadius: 4, minHeight: 2 }} />
                </div>
                <span className="tiny faint">{t.label}</span>
              </div>
            ))}
          </div>
          <div className="tiny faint" style={{ marginTop: 6 }}>Sport : {trend.map((t) => t.sport).join(' · ')} séances</div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Comparaison</h3><label className="check small"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> vs {label(kind, prevRef)}</label></div>
          {compare && (
            <table className="compare-table">
              <thead><tr><th /><th>{kind === 'year' ? s.slice(0, 4) : 'Actuel'}</th><th>Précédent</th><th>Écart</th></tr></thead>
              <tbody>{rows.map(([l, a, b, f]) => (
                <tr key={l}><td>{l}</td><td>{f(a)}</td><td className="faint">{f(b)}</td><td className={a > b ? 'delta-up' : a < b ? 'delta-down' : 'faint'}>{a === b ? '=' : `${a > b ? '+' : '−'}${f(Math.abs(a - b))}`}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card section">
        <div className="card-head"><h3>Bilans hebdomadaires clôturés</h3></div>
        {reviews.length ? reviews.map((r) => {
          const snap = r.snapshot as PeriodStats | undefined;
          return (
            <a key={r.id} href={href(`semaine/${r.weekStart}/bilan`)} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none' }}>
              <span className="grow">Semaine du {fmtShort(r.weekStart)}</span>
              {snap && <span className="small muted">{fmtHours(snap.totals.actualMin)} réalisées · {snap.totals.done} tâches · {snap.sportSessions} séances</span>}
            </a>
          );
        }) : <Empty>Aucun bilan clôturé pour l’instant. Clôturez une semaine depuis la vue Semaine → Bilan.</Empty>}
      </div>
    </div>
  );
}

export function WeeklyReviewView({ date }: { date: string }) {
  const state = useData();
  const ws = weekStart(date), we = addDays(ws, 6);
  const st = useMemo(() => periodStats(state, ws, we), [state, ws, we]);
  const review = Object.values(state.reviews).find((r) => !r.deleted && r.weekStart === ws);
  const [notes, setNotes] = useState(review?.notes ?? '');
  const [showSnap, setShowSnap] = useState(false);
  const unfinished = expandRange(state, ws, we).filter((i) => i.kind !== 'event' && i.status !== 'done' && i.date! <= today()).sort((a, b) => a.date!.localeCompare(b.date!));
  const missedByCat = st.categories.filter((c) => c.missed.length);

  const close = () => {
    const snapshot = JSON.parse(JSON.stringify({ ...st, categories: st.categories.map((c) => ({ ...c, missed: c.missed.map((m) => ({ id: m.id, title: m.title, date: m.date })) })) }));
    if (review) getStore().update('reviews', review.id, { notes, closedAt: new Date().toISOString(), snapshot });
    else getStore().create('reviews', { weekStart: ws, notes, closedAt: new Date().toISOString(), snapshot } as WeeklyReview);
  };

  return (
    <div>
      <div className="page-head">
        <div className="title-block">
          <a className="eyebrow row" href={href(`semaine/${ws}`)} style={{ textDecoration: 'none' }}><IconLeft size={12} /> Semaine</a>
          <h1>Bilan · {fmt(ws, 'd MMM')} – {fmt(we, 'd MMM')}</h1>
        </div>
        <div className="row">
          <button className="icon-btn" aria-label="Semaine précédente" onClick={() => go(`semaine/${addDays(ws, -7)}/bilan`)}><IconLeft /></button>
          <button className="icon-btn" aria-label="Semaine suivante" onClick={() => go(`semaine/${addDays(ws, 7)}/bilan`)}><IconRight /></button>
        </div>
      </div>

      {insights(st).length > 0 && <div className="card" style={{ marginBottom: 14 }}>{insights(st).map((t, i) => <p key={i} className="small" style={{ margin: '4px 0' }}>{t}</p>)}</div>}
      <StatsBlocks st={st} />

      {missedByCat.length > 0 && (
        <div className="card section">
          <div className="card-head"><h3>Activités non réalisées par catégorie</h3></div>
          {missedByCat.map((c) => (
            <div key={c.categoryId} style={{ padding: '6px 0' }}>
              <div className="row small"><span className="cat-dot" style={{ background: c.color }} /><b>{c.name}</b></div>
              <div className="small muted" style={{ paddingLeft: 17 }}>{c.missed.map((m) => `${m.title} (${fmtShort(m.date!)})`).join(' · ')}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card section">
        <div className="card-head"><h3>Fin de semaine · tâches à traiter ({unfinished.length})</h3></div>
        <p className="small muted" style={{ marginTop: 0 }}>Pour chaque tâche, choisissez : reporter à la semaine suivante, reprogrammer, laisser dans « À planifier » ou supprimer. Aucun report automatique.</p>
        <PendingList items={unfinished} nextWeekFrom={ws} />
      </div>

      <div className="card section">
        <div className="card-head"><h3>Mes notes de la semaine</h3>{review && <span className="tiny faint">Clôturée le {new Date(review.closedAt).toLocaleDateString('fr-FR')}</span>}</div>
        <textarea className="input" placeholder="Ce qui a bien fonctionné, ce que je veux ajuster…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
          {review && <button className="btn" onClick={() => setShowSnap(true)}>Voir le bilan figé</button>}
          <button className="btn primary" onClick={close}>{review ? 'Mettre à jour le bilan' : 'Clôturer la semaine'}</button>
        </div>
        <div className="tiny faint" style={{ marginTop: 6 }}>La clôture enregistre une copie des chiffres de la semaine pour suivre votre évolution.</div>
      </div>
      {showSnap && review && (
        <Sheet title="Bilan au moment de la clôture" onClose={() => setShowSnap(false)} wide>
          <StatsBlocks st={{ ...(review.snapshot as PeriodStats), categories: (review.snapshot as PeriodStats).categories.map((c) => ({ ...c, missed: [] })) }} />
        </Sheet>
      )}
    </div>
  );
}
