import { useMemo, useState } from 'react';
import { getStore, useData } from '../../data/store';
import { useUI } from '../../ui/UI';
import { Bar, Empty, Sheet } from '../../ui/kit';
import { Cover } from '../../ui/Cover';
import { ContentEditor, blankContent, toggleCheck, type ContentDraft } from './ContentEditor';
import { FeedView } from './FeedView';
import { TimeGrid } from '../../ui/TimeGrid';
import { useDrag } from '../../ui/drag';
import { cancelShootDay, moveItem } from '../../data/actions';
import { contentUrgency, urgencyDays, urgencyLabel, URGENT_RED, type Urgency } from '../../logic/urgency';
import { IdeaBank } from './IdeaBank';
import {
  CHECK_LABEL, FORMAT_COLOR, contentPlanningItems, publishRefId, FORMAT_LABEL, GOAL_LABEL, PILLAR_LABEL, checksFor, contentProgress, isBankIdea, distributeDates, isPosted, shootDays, type Rhythm,
} from '../../logic/contentPlan';
import { createItem } from '../../data/actions';
import { addDays, addMonths, fmt, fmtLong, fmtMonth, fmtShort, fmtTime, monthEnd, monthGrid, monthStart, today, weekDays, weekStart, WEEKDAYS_SHORT } from '../../lib/date';
import { go, href } from '../../lib/router';
import { IconLeft, IconPlus, IconRight, IconSparkle, IconTrash } from '../../ui/Icons';
import type { ContentGoal, ContentPiece, ContentPillar, ContentFormat, DateStr } from '../../data/types';

type Tab = 'idees' | 'calendrier' | 'tournages' | 'feed';

export function ContentHub({ route }: { route: string[] }) {
  const [, r1, r2] = route;
  const tab: Tab = r1 === 'feed' ? 'feed' : r1 === 'tournages' || r1 === 'tournage' ? 'tournages' : r1 === 'idees' ? 'idees' : 'calendrier';
  const [edit, setEdit] = useState<ContentDraft | null>(null);
  const [wizard, setWizard] = useState(false);

  return (
    <div>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="title-block"><div className="eyebrow">Instagram & Développement</div><h1>Contenu</h1></div>
        <div className="row">
          <button className="btn" onClick={() => setWizard(true)}><IconSparkle size={15} /> Planifier un mois</button>
          <button className="btn primary" onClick={() => setEdit(blankContent())}><IconPlus size={16} /> {tab === 'idees' ? 'Idée' : 'Contenu'}</button>
        </div>
      </div>
      <div className="cal-switch" style={{ marginBottom: 16 }}>
        <a className={tab === 'idees' ? 'on' : ''} href={href('contenu/idees')}>Idées</a>
        <a className={tab === 'calendrier' ? 'on' : ''} href={href('contenu')}>Calendrier</a>
        <a className={tab === 'tournages' ? 'on' : ''} href={href('contenu/tournages')}>Tournages</a>
        <a className={tab === 'feed' ? 'on' : ''} href={href('contenu/feed')}>Feed</a>
      </div>
      {tab === 'idees' && <IdeaBank onEdit={setEdit} />}
      {tab === 'calendrier' && (r1 === 'jour' || r1 === 'semaine'
        ? <ContentTimeView view={r1} date={r2 && /^\d{4}-\d{2}-\d{2}$/.test(r2) ? r2 : today()} />
        : <ContentCalendar date={r1 === 'mois' && r2 ? r2 : today()} onEdit={setEdit} />)}
      {tab === 'tournages' && (r1 === 'tournage' && r2 ? <ShootDay date={r2} onEdit={setEdit} /> : <ShootList onPlan={() => setWizard(true)} />)}
      {tab === 'feed' && <FeedView onEditContent={(c) => setEdit(c)} />}
      {edit && <ContentEditor key={edit.id ?? 'new'} value={edit} onClose={() => setEdit(null)} />}
      {wizard && <PlanMonthWizard onClose={() => setWizard(false)} />}
    </div>
  );
}

const useContents = () => {
  const state = useData();
  return useMemo(() => Object.values(state.contents).filter((c) => !c.deleted), [state]);
};

// ---------------------------------------------------------------- Calendrier
/** Jour / Semaine / Mois du calendrier de contenu (comme le Calendrier Apple). */
function ViewSwitch({ view, date }: { view: 'jour' | 'semaine' | 'mois'; date: DateStr }) {
  const t = today();
  const target = (v: string) => v === 'jour' ? `contenu/jour/${date.slice(0, 7) === t.slice(0, 7) && view !== 'jour' ? t : date}`
    : v === 'semaine' ? `contenu/semaine/${weekStart(date)}` : `contenu/mois/${monthStart(date)}`;
  return (
    <div className="seg" style={{ marginBottom: 12, display: 'flex' }}>
      {([['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois']] as const).map(([v, l]) => (
        <button key={v} className={view === v ? 'on' : ''} style={{ flex: 1 }} onClick={() => go(target(v))}>{l}</button>
      ))}
    </div>
  );
}

/** Vues Jour et Semaine : grille horaire Apple, publications et tournages déplaçables. */
function ContentTimeView({ view, date }: { view: 'jour' | 'semaine'; date: DateStr }) {
  const state = useData();
  const days = view === 'jour' ? [date] : weekDays(date);
  // dans le calendrier de contenu : blocs plus lisibles (titre seul, hauteur d'1 h)
  const items = useMemo(() => contentPlanningItems(state, days[0], days[days.length - 1], { always: true })
    .map((i) => i.contentRef?.kind === 'publish' ? { ...i, title: i.title.replace('📲 Publier · ', ''), duration: 60 } : i),
  [state, days[0], days.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = view === 'jour' ? 1 : 7;
  const pubs = items.filter((i) => i.contentRef?.kind === 'publish');
  const shoots = items.filter((i) => i.contentRef?.kind === 'shoot');
  const strip = weekDays(date);
  return (
    <>
      <ViewSwitch view={view} date={date} />
      <div className="cal-titlebar" style={{ marginTop: 0, marginBottom: 10 }}>
        <h2 className="cal-title" style={{ fontSize: 20 }}>{view === 'jour' ? fmt(date, 'EEEE d MMMM') : `${fmt(days[0], 'd MMM')} – ${fmt(days[6], 'd MMM yyyy')}`}</h2>
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn small" aria-label="Précédent" onClick={() => go(`contenu/${view}/${addDays(days[0], -step)}`)}><IconLeft size={16} /></button>
          <button className="btn small" disabled={days.includes(today())} onClick={() => go(`contenu/${view}/${view === 'semaine' ? weekStart(today()) : today()}`)}>Aujourd’hui</button>
          <button className="icon-btn small" aria-label="Suivant" onClick={() => go(`contenu/${view}/${addDays(days[0], step)}`)}><IconRight size={16} /></button>
        </div>
      </div>
      {view === 'jour' && (
        <div className="cal-strip">
          {strip.map((d) => {
            const has = Object.values(state.contents).some((c) => !c.deleted && (c.publishDate === d || c.shootDate === d));
            return (
              <a key={d} href={href(`contenu/jour/${d}`)} aria-label={fmtLong(d)}>
                <span className="wd">{fmt(d, 'EEEEE')}</span>
                <span className={`dn ${d === today() ? 'today' : ''} ${d === date ? 'sel' : ''}`}>{fmt(d, 'd')}</span>
                <span className={`dot ${has ? '' : 'none'}`} />
              </a>
            );
          })}
        </div>
      )}
      <div className="row between small" style={{ marginBottom: 8, gap: 10 }}>
        <span className="muted"><b style={{ color: 'var(--ink)' }}>{pubs.filter((p) => p.status === 'done').length}/{pubs.length}</b> publication{pubs.length > 1 ? 's' : ''} faite{pubs.length > 1 ? 's' : ''}</span>
        {shoots.length > 0 && <span className="muted">{shoots.length} jour{shoots.length > 1 ? 's' : ''} de tournage</span>}
      </div>
      <TimeGrid
        days={days}
        items={items}
        minColWidth={view === 'semaine' ? 78 : 0}
        showHeader={view === 'semaine'}
        onHeaderClick={(d) => go(`contenu/jour/${d}`)}
        height={view === 'semaine' ? 'var(--week-grid-h)' : 'var(--day-grid-h)'}
        colorOf={(i) => i.contentRef?.kind === 'publish' ? FORMAT_COLOR[state.contents[i.contentRef.contentId]?.format ?? 'reel'] : '#33251A'}
      />
      <div className="kbd-hint" style={{ marginTop: 6 }}>
        Glissez une publication vers un autre jour (ligne « journée ») ou à une autre heure. Sur iPhone : appui long puis glisser. Touchez-la pour ouvrir la fiche.
      </div>
    </>
  );
}

function ContentCalendar({ date, onEdit }: { date: DateStr; onEdit: (c: ContentDraft) => void }) {
  const contents = useContents();
  const state = useData();
  const ms = monthStart(date), me = monthEnd(date);
  const grid = monthGrid(ms);
  const shoots = useMemo(() => shootDays(state), [state]);
  const [day, setDay] = useState<DateStr | null>(null);
  const ui = useUI();
  const dayAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest('[data-day]') as HTMLElement | null)?.dataset.day;
  // glisser une publication sur un autre jour du mois (l'heure de publication est conservée)
  const { drag, start, clickGuard } = useDrag<{ c: ContentPiece }>((d) => {
    const to = dayAt(d.x, d.y);
    if (!to || to === d.payload.c.publishDate) return;
    moveItem(publishRefId(d.payload.c.id), to, d.payload.c.publishTime ?? null);
    ui.toast(`« ${d.payload.c.title} » déplacé au ${fmt(to, 'EEEE d MMMM')}`);
  });
  const overDay = drag ? dayAt(drag.x, drag.y) : undefined;
  const uDays = urgencyDays(state);
  const pubUrg = (c: ContentPiece) => contentUrgency(c, today(), uDays).publish;
  const shootUrg = (list: ContentPiece[]) => list.reduce<Urgency>((a, c) => { const u = contentUrgency(c, today(), uDays).shoot; return a === 'late' || u === 'late' ? 'late' : a ?? u; }, undefined);
  const inMonth = contents.filter((c) => c.publishDate && c.publishDate >= ms && c.publishDate <= me);
  const undated = contents.filter((c) => !c.publishDate);

  const mix = <K extends string>(key: 'format' | 'goal' | 'pillar', labels: Record<K, string>) => {
    const counts = new Map<string, number>();
    for (const c of inMonth) { const v = c[key] as string | undefined; if (v) counts.set(v, (counts.get(v) ?? 0) + 1); }
    return (Object.keys(labels) as K[]).map((k) => ({ k, label: labels[k], n: counts.get(k) ?? 0 })).filter((x) => x.n);
  };

  return (
    <>
      <ViewSwitch view="mois" date={ms} />
      <div className="cal-titlebar" style={{ marginTop: 0, marginBottom: 12 }}>
        <h2 className="cal-title" style={{ fontSize: 20 }}>{fmtMonth(ms)}</h2>
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn small" aria-label="Mois précédent" onClick={() => go(`contenu/mois/${addMonths(ms, -1)}`)}><IconLeft size={16} /></button>
          <button className="btn small" disabled={ms === monthStart(today())} onClick={() => go('contenu')}>Ce mois-ci</button>
          <button className="icon-btn small" aria-label="Mois suivant" onClick={() => go(`contenu/mois/${addMonths(ms, 1)}`)}><IconRight size={16} /></button>
        </div>
      </div>

      <div className="am-grid">
        <div className="am-wd">{['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => <div key={d}>{d}</div>)}</div>
        <div className="am-days">
          {grid.map((d) => {
            const pubs = contents.filter((c) => c.publishDate === d).sort((a, b) => (a.publishTime ?? '').localeCompare(b.publishTime ?? ''));
            const shoot = shoots.get(d);
            return (
              <div key={d} data-day={d} className={`am-day ${d < ms || d > me ? 'out' : ''} ${d === today() ? 'today' : ''} ${overDay === d && drag ? 'drop-over' : ''} ${pubs.some(pubUrg) || (shoot && shootUrg(shoot)) ? 'has-urgent' : ''}`} onClick={() => { if (!clickGuard()) setDay(d); }} role="button" aria-label={fmtLong(d)}>
                <span className="am-num">{fmt(d, 'd')}</span>
                {shoot && <span className={`shoot-badge ${shootUrg(shoot) ? `urg-${shootUrg(shoot)}` : ''}`}>🎬 {shoot.length}</span>}
                {pubs.slice(0, 3).map((c) => (
                  <span key={c.id} className={`am-ev draggable ${isPosted(c) ? 'done' : ''} ${pubUrg(c) ? `urg-${pubUrg(c)}` : ''}`} style={{ ['--c' as string]: pubUrg(c) ? URGENT_RED : FORMAT_COLOR[c.format], opacity: drag?.payload.c.id === c.id ? 0.35 : undefined }}
                    onPointerDown={(e) => start(e, { c })}
                    onClick={(e) => { e.stopPropagation(); if (!clickGuard()) onEdit(c); }}>
                    {FORMAT_LABEL[c.format]} · {c.title}
                  </span>
                ))}
                {pubs.length > 3 && <span className="am-more">+{pubs.length - 3}</span>}
                <span className="am-dots">{pubs.slice(0, 4).map((c) => <span key={c.id} className="cat-dot" style={{ width: 6, height: 6, background: pubUrg(c) ? URGENT_RED : FORMAT_COLOR[c.format] }} />)}</span>
              </div>
            );
          })}
        </div>
      </div>
      {drag && <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>{drag.payload.c.title}</div>}
      <div className="kbd-hint" style={{ marginTop: 6 }}>Ordinateur : glissez une publication sur un autre jour. iPhone : passez en vue Semaine ou Jour pour déplacer.</div>
      <div className="legend" style={{ marginTop: 8 }}>
        {(Object.keys(FORMAT_LABEL) as ContentFormat[]).map((f) => <span key={f}><i style={{ background: FORMAT_COLOR[f] }} />{FORMAT_LABEL[f]}</span>)}
        <span>🎬 = jour de tournage</span>
      </div>

      <div className="grid-2 section">
        <div className="card">
          <div className="card-head"><h3>Équilibre du mois</h3><span className="small muted">{inMonth.length} publication(s) · {inMonth.filter(isPosted).length} publiée(s)</span></div>
          {inMonth.length ? (['format', 'goal', 'pillar'] as const).map((k) => {
            const rows = k === 'format' ? mix<ContentFormat>('format', FORMAT_LABEL) : k === 'goal' ? mix<ContentGoal>('goal', GOAL_LABEL) : mix<ContentPillar>('pillar', PILLAR_LABEL);
            return rows.length ? (
              <div key={k} style={{ marginBottom: 10 }}>
                <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{k === 'format' ? 'Formats' : k === 'goal' ? 'Objectifs' : 'Piliers'}</div>
                {rows.map((r) => (
                  <div key={r.k} className="row small" style={{ gap: 8, padding: '2px 0' }}>
                    <span style={{ width: 130 }}>{r.label}</span>
                    <div className="grow"><Bar pct={(r.n / inMonth.length) * 100} thin /></div>
                    <span className="faint" style={{ width: 24, textAlign: 'right' }}>{r.n}</span>
                  </div>
                ))}
              </div>
            ) : null;
          }) : <Empty>Aucune publication prévue ce mois-ci.</Empty>}
        </div>
        <div className="card">
          <div className="card-head"><h3>Sans date de publication · {undated.length}</h3></div>
          {undated.length ? undated.slice(0, 12).map((c) => <ContentRow key={c.id} c={c} onEdit={onEdit} />) : <Empty>Tous vos contenus ont une date.</Empty>}
        </div>
      </div>

      {day && <DaySheet date={day} onClose={() => setDay(null)} onEdit={(c) => { setDay(null); onEdit(c); }} />}
    </>
  );
}

function DaySheet({ date, onClose, onEdit }: { date: DateStr; onClose: () => void; onEdit: (c: ContentDraft) => void }) {
  const contents = useContents();
  const shoot = contents.filter((c) => c.shootDate === date);
  const pubs = contents.filter((c) => c.publishDate === date);
  return (
    <Sheet title={fmtLong(date)} onClose={onClose} footer={<>
      <button className="btn" onClick={() => onEdit(blankContent({ shootDate: date }))}>+ À tourner ce jour</button>
      <button className="btn primary" onClick={() => onEdit(blankContent({ publishDate: date }))}>+ À publier ce jour</button>
    </>}>
      <div className="section-title">🎬 À tourner · {shoot.length}</div>
      {shoot.length ? <>
        {shoot.slice(0, 5).map((c) => <ContentRow key={c.id} c={c} onEdit={onEdit} />)}
        <a className="btn small" href={href(`contenu/tournage/${date}`)} style={{ marginTop: 6 }}>Ouvrir la journée de tournage ({shoot.length})</a>
      </> : <Empty>Pas de tournage prévu.</Empty>}
      <div className="section-title" style={{ marginTop: 16 }}>À publier · {pubs.length}</div>
      {pubs.length ? pubs.map((c) => <ContentRow key={c.id} c={c} onEdit={onEdit} showShoot />) : <Empty>Aucune publication ce jour.</Empty>}
    </Sheet>
  );
}

function ContentRow({ c, onEdit, showShoot }: { c: ContentPiece; onEdit: (c: ContentDraft) => void; showShoot?: boolean }) {
  const state = useData();
  const p = contentProgress(c);
  const u = contentUrgency(c, today(), urgencyDays(state));
  return (
    <div className={`item ${u.any ? `urg-row-${u.any}` : ''}`} onClick={() => onEdit(c)}>
      <span className="bar-cat" style={{ background: FORMAT_COLOR[c.format] }} />
      {c.coverMediaId && <div style={{ width: 34, flexShrink: 0 }}><Cover mediaId={c.coverMediaId} crop={c.coverCrop} aspect="3:4" /></div>}
      <div className="body">
        <div className="title">{c.title}</div>
        <div className="meta">
          <span>{FORMAT_LABEL[c.format]}</span>
          {c.publishDate && <span>publication {fmtShort(c.publishDate)}{c.publishTime ? ` ${fmtTime(c.publishTime)}` : ''}</span>}
          {showShoot && c.shootDate && <span>tournage {fmtShort(c.shootDate)}</span>}
          {c.goal && <span>{GOAL_LABEL[c.goal]}</span>}
        </div>
      </div>
      {u.any && <span className={`urg-tag ${u.any}`}>{urgencyLabel(u.any, u.daysLeft)}</span>}
      <span className={`tag ${p.pct === 100 ? 'ok' : ''}`}>{p.done}/{p.total}</span>
    </div>
  );
}

// ---------------------------------------------------------------- Tournages
function ShootList({ onPlan }: { onPlan: () => void }) {
  const state = useData();
  const days = useMemo(() => [...shootDays(state).entries()].sort((a, b) => b[0].localeCompare(a[0])), [state]);
  const upcoming = days.filter(([d]) => d >= today()).reverse();
  const past = days.filter(([d]) => d < today());
  const Row = ([d, list]: [DateStr, ContentPiece[]]) => {
    const shot = list.filter((c) => c.checks.shot).length;
    const late = list.some((c) => contentUrgency(c, today(), urgencyDays(state)).shoot === 'late');
    const soon = !late && list.some((c) => contentUrgency(c, today(), urgencyDays(state)).shoot === 'soon');
    return (
      <a key={d} href={href(`contenu/tournage/${d}`)} className={`card ${late ? 'urg-card-late' : soon ? 'urg-card-soon' : ''}`} style={{ display: 'block', textDecoration: 'none', marginTop: 0 }}>
        <div className="row between"><b>{(late || soon) && <span className={`urg-tag ${late ? 'late' : 'soon'}`} style={{ marginRight: 6 }}>{late ? 'En retard' : 'Bientôt'}</span>}{fmtLong(d)}</b><span className="small muted">{shot}/{list.length} tournés</span></div>
        <Bar pct={(shot / list.length) * 100} thin />
        <div className="tiny faint" style={{ marginTop: 6 }}>Publications du {fmtShort(list.map((c) => c.publishDate ?? '9999').sort()[0] ?? d)} au {fmtShort(list.map((c) => c.publishDate ?? '').sort().pop() || d)}</div>
      </a>
    );
  };
  return (
    <>
      <div className="section-title">À venir</div>
      {upcoming.length ? <div className="grid-2">{upcoming.map(Row)}</div> : (
        <Empty>Aucune journée de tournage prévue. <button className="btn small" onClick={onPlan}>Planifier un mois de contenu</button></Empty>
      )}
      {past.length > 0 && <><div className="section-title section">Passées</div><div className="grid-2">{past.map(Row)}</div></>}
    </>
  );
}

function ShootDay({ date, onEdit }: { date: DateStr; onEdit: (c: ContentDraft) => void }) {
  const state = useData();
  const ui = useUI();
  const list = useMemo(() => shootDays(state).get(date) ?? [], [state, date]);
  const [open, setOpen] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const shot = list.filter((c) => c.checks.shot).length;
  const withPub = list.filter((c) => c.publishDate).length;

  const cancel = (alsoPublishDates: boolean) => {
    const n = cancelShootDay(date, { alsoPublishDates });
    setCancelOpen(false);
    ui.toast(`Tournage annulé · ${n} idée${n > 1 ? 's' : ''} conservée${n > 1 ? 's' : ''}`);
    go(alsoPublishDates ? 'contenu/idees' : 'contenu/tournages');
  };
  /** retirer un seul script de ce tournage (la fiche est conservée) */
  const removeOne = (c: ContentPiece) => {
    getStore().update('contents', c.id, { shootDate: undefined });
    ui.toast(`« ${c.title} » retiré du tournage`, { label: 'Annuler', run: () => getStore().update('contents', c.id, { shootDate: date }) });
  };
  const blocked = Object.values(state.items).some((i) => !i.deleted && i.date === date && i.title.startsWith('Journée de tournage'));

  const blockInPlanning = async () => {
    const cat = Object.values(state.categories).find((c) => c.name === 'Création de contenu' && !c.deleted);
    if (!(await ui.checkSunday(date, cat?.id))) return;
    createItem({ kind: 'event', title: `Journée de tournage · ${list.length} contenu${list.length > 1 ? 's' : ''}`, date, start: '09:00', duration: 8 * 60, categoryId: cat?.id, priority: 'must' });
    ui.toast('Journée bloquée dans votre planning');
  };

  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 12, gap: 10 }}>
        <div>
          <a className="eyebrow row" href={href('contenu/tournages')} style={{ textDecoration: 'none', fontSize: 12, color: 'var(--ink-3)' }}><IconLeft size={12} /> Tournages</a>
          <h2 className="cal-title" style={{ fontSize: 21 }}>🎬 {fmtLong(date)}</h2>
        </div>
        <div className="row wrap">
          <button className="icon-btn small" aria-label="Jour précédent" onClick={() => go(`contenu/tournage/${addDays(date, -1)}`)}><IconLeft size={16} /></button>
          <button className="icon-btn small" aria-label="Jour suivant" onClick={() => go(`contenu/tournage/${addDays(date, 1)}`)}><IconRight size={16} /></button>
          {!blocked && list.length > 0 && <button className="btn small" onClick={blockInPlanning}>Bloquer dans mon planning</button>}
          <button className="btn small primary" onClick={() => onEdit(blankContent({ shootDate: date }))}><IconPlus size={14} /> Script</button>
          {list.length > 0 && <button className="btn small ghost danger" onClick={() => setCancelOpen(true)}><IconTrash size={14} /> Annuler ce tournage</button>}
        </div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row between small"><span><b>{shot}/{list.length}</b> contenus tournés</span><span className="muted">{list.filter((c) => c.checks.script).length} scripts prêts</span></div>
        <Bar pct={list.length ? (shot / list.length) * 100 : 0} />
      </div>

      {!list.length && <Empty>Aucun script prévu pour ce jour. Ajoutez des contenus avec cette date de tournage.</Empty>}
      {list.map((c, i) => {
        const isOpen = open === c.id;
        return (
          <div key={c.id} className={`card shoot-card ${contentUrgency(c, today(), urgencyDays(state)).any ? `urg-card-${contentUrgency(c, today(), urgencyDays(state)).any}` : ''}`} style={{ marginTop: i ? 10 : 0 }}>
            <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
              <span className="shoot-num">{i + 1}</span>
              <div className="grow" style={{ cursor: 'pointer', minWidth: 0 }} onClick={() => setOpen(isOpen ? null : c.id)}>
                <div style={{ fontWeight: 600 }}>{(() => { const u = contentUrgency(c, today(), urgencyDays(state)); return u.any ? <span className={`urg-tag ${u.any}`} style={{ marginRight: 6 }}>{urgencyLabel(u.any, u.daysLeft)}</span> : null; })()}{c.title}</div>
                <div className="row wrap tiny" style={{ gap: 6, marginTop: 4 }}>
                  <span className="tag" style={{ background: `color-mix(in srgb, ${FORMAT_COLOR[c.format]} 18%, var(--surface))` }}>{FORMAT_LABEL[c.format]}</span>
                  <label className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <span className="faint">publication</span>
                    <input type="date" className="inline-date" value={c.publishDate ?? ''} aria-label={`Date de publication de ${c.title}`}
                      onChange={(e) => getStore().update('contents', c.id, { publishDate: e.target.value || undefined })} />
                  </label>
                  {c.goal && <span className="tag">{GOAL_LABEL[c.goal]}</span>}
                  {c.pillar && <span className="tag">{PILLAR_LABEL[c.pillar]}</span>}
                  {c.platforms.map((p) => <span key={p} className="tag">{p === 'instagram' ? 'IG' : 'TikTok'}</span>)}
                </div>
              </div>
              <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
                <button className="btn small ghost" onClick={() => onEdit(c)}>Modifier</button>
                <button className="btn small ghost faint" style={{ fontSize: 12 }} onClick={() => removeOne(c)}>Retirer</button>
              </div>
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              {checksFor(c).map((k) => (
                <button key={k} className={`chip ${c.checks[k] ? 'on' : ''}`} onClick={() => toggleCheck(c, k)}>{c.checks[k] ? '✓ ' : ''}{CHECK_LABEL[k]}</button>
              ))}
            </div>
            {isOpen && (
              <div className="script-read">
                {c.hook && <><div className="lbl">Accroche</div><p className="hook">{c.hook}</p></>}
                {c.script ? <><div className="lbl">Script</div><p>{c.script}</p></> : <p className="faint">Script pas encore écrit.</p>}
                {c.cta && <><div className="lbl">CTA</div><p>{c.cta}</p></>}
                {c.caption && <><div className="lbl">Légende</div><p className="small muted">{c.caption}</p></>}
                {c.notes && <><div className="lbl">Notes</div><p className="small muted">{c.notes}</p></>}
              </div>
            )}
            {!isOpen && (c.hook || c.script) && <button className="btn ghost small" style={{ marginTop: 6 }} onClick={() => setOpen(c.id)}>Lire l’accroche et le script</button>}
          </div>
        );
      })}
      {cancelOpen && (
        <Sheet title="Annuler ce tournage ?" onClose={() => setCancelOpen(false)}>
          <p style={{ marginTop: 0 }}>Le tournage du <b>{fmtLong(date)}</b> sera retiré de vos calendriers.</p>
          <p className="small muted">Vos {list.length} idée{list.length > 1 ? 's' : ''} de contenu sont <b>conservées</b> : accroche, script, CTA, légende, couverture et cases déjà cochées ne bougent pas.</p>
          <div className="col" style={{ marginTop: 14 }}>
            <button className="btn primary" style={{ whiteSpace: 'normal', textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => cancel(true)}>
              Annuler le tournage et les dates de publication{withPub ? ` (${withPub})` : ''} — tout revient dans la Banque d’idées
            </button>
            {withPub > 0 && (
              <button className="btn" style={{ whiteSpace: 'normal', textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => cancel(false)}>
                Annuler seulement le tournage — garder les dates de publication
              </button>
            )}
            <button className="btn ghost" onClick={() => setCancelOpen(false)}>Ne rien changer</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Assistant « planifier un mois »
type Mode = Rhythm['mode'] | 'manual';

function PlanMonthWizard({ onClose }: { onClose: () => void }) {
  const state = useData();
  const ui = useUI();
  const nextMonth = monthStart(addMonths(today(), 1));
  const [shootDate, setShootDate] = useState(addDays(today(), 2));
  const [start, setStart] = useState(nextMonth);
  const [mode, setMode] = useState<Mode>('daily');
  const [every, setEvery] = useState(2);
  const [wds, setWds] = useState<number[]>([1, 3, 5]);
  const [skipSun, setSkipSun] = useState(false);
  const [time, setTime] = useState('18:00');
  const [platforms, setPlatforms] = useState({ instagram: true, tiktok: false });
  const [selected, setSelected] = useState<string[]>([]);
  const [blank, setBlank] = useState(0);
  const [blankTitles, setBlankTitles] = useState<Record<number, string>>({});
  /** dates choisies à la main (prioritaires sur les suggestions) ; '' = sans date pour l'instant */
  const [manual, setManual] = useState<Record<string, string>>({});
  // la banque d'idées = fiches sans date (ni tournage ni publication)
  const ideas = Object.values(state.contents).filter((c) => !c.deleted && isBankIdea(c) && !isPosted(c)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // une ligne par contenu à créer : idées choisies puis contenus vides
  const rows = [
    ...selected.map((id) => ({ key: id, title: state.contents[id]?.title ?? '', ideaId: id as string | undefined, blankIndex: -1 })),
    ...Array.from({ length: blank }, (_, j) => ({ key: `blank-${j}`, title: blankTitles[j] ?? '', ideaId: undefined, blankIndex: j })),
  ];
  const suggested = mode === 'manual' ? [] : distributeDates(start, rows.length, { mode, every, weekdays: wds, skipSundays: skipSun });
  const dateOf = (key: string, i: number) => (key in manual ? manual[key] : suggested[i] ?? '');
  const finalDates = rows.map((r, i) => dateOf(r.key, i));
  const dated = finalDates.filter(Boolean).sort();
  const perDay = new Map<string, number>();
  for (const d of finalDates) if (d) perDay.set(d, (perDay.get(d) ?? 0) + 1);

  const create = () => {
    if (!rows.length) return;
    const pl = (Object.keys(platforms) as ('instagram' | 'tiktok')[]).filter((k) => platforms[k]);
    getStore().transact(() => {
      rows.forEach((r, i) => {
        const publishDate = finalDates[i] || undefined;
        const dates = { shootDate, publishDate, publishTime: publishDate ? time || undefined : undefined, order: i };
        if (r.ideaId) {
          // même fiche : on lui donne simplement ses dates (rien n'est recopié)
          const cur = state.contents[r.ideaId];
          getStore().update('contents', r.ideaId, { ...dates, platforms: cur.platforms.length ? cur.platforms : pl });
        } else {
          getStore().create('contents', { title: r.title.trim() || `Contenu ${i + 1}`, format: 'reel', checks: {}, platforms: pl, ...dates } as ContentPiece);
        }
      });
    });
    ui.toast(`${rows.length} contenu${rows.length > 1 ? 's' : ''} planifié${rows.length > 1 ? 's' : ''} · tournage le ${fmtShort(shootDate)}`);
    onClose();
    go(`contenu/tournage/${shootDate}`);
  };

  return (
    <Sheet wide title="Planifier un mois de contenu" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn primary" disabled={!rows.length} onClick={create}>Créer {rows.length} contenu{rows.length > 1 ? 's' : ''}</button>
    </>}>
      <p className="small muted" style={{ marginTop: 0 }}>Tous les scripts seront regroupés le jour du tournage. Chaque date de publication se choisit librement à l’étape 3 (l’app peut seulement vous en suggérer).</p>
      <div className="form-grid">
        <div className="field"><label>1. Jour de tournage</label><input className="input" type="date" value={shootDate} onChange={(e) => setShootDate(e.target.value)} /></div>
        <div className="field"><label>Heure de publication habituelle</label><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        <div className="field full"><label>Plateformes</label><div className="chips">
          <button className={`chip ${platforms.instagram ? 'on' : ''}`} onClick={() => setPlatforms((p) => ({ ...p, instagram: !p.instagram }))}>Instagram</button>
          <button className={`chip ${platforms.tiktok ? 'on' : ''}`} onClick={() => setPlatforms((p) => ({ ...p, tiktok: !p.tiktok }))}>TikTok</button>
        </div></div>
      </div>

      <div className="section-title section">2. Idées à tourner (Banque d’idées) · {rows.length}</div>
      <div className="row" style={{ marginBottom: 6, gap: 6 }}>
        <button className="btn small" onClick={() => setSelected(ideas.map((i) => i.id))}>Tout sélectionner</button>
        <button className="btn small ghost" onClick={() => setSelected([])}>Aucune</button>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 12, padding: '4px 10px' }}>
        {ideas.length ? ideas.map((i) => {
          const on = selected.includes(i.id);
          return (
            <label key={i.id} className="check" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
              <input type="checkbox" checked={on} onChange={() => setSelected((s) => (on ? s.filter((x) => x !== i.id) : [...s, i.id]))} />
              <span className="grow small">{i.title} <span className="faint">· {FORMAT_LABEL[i.format]}</span></span>
            </label>
          );
        }) : <Empty>Aucune idée à planifier dans la banque.</Empty>}
      </div>
      <div className="field" style={{ marginTop: 10, maxWidth: 260 }}><label>+ Contenus vides à compléter</label><input className="input" type="number" min={0} max={60} value={blank} onChange={(e) => setBlank(Math.max(0, Math.min(60, +e.target.value)))} /></div>

      {rows.length > 0 && <>
        <div className="section-title section">3. Dates de publication</div>
        <div className="form-grid" style={{ marginBottom: 10 }}>
          <div className="field"><label>Pré-remplir</label>
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="manual">Non, je choisis chaque date moi-même</option>
              <option value="daily">Suggérer : 1 publication par jour</option>
              <option value="every">Suggérer : tous les X jours</option>
              <option value="weekdays">Suggérer : certains jours de la semaine</option>
            </select>
          </div>
          {mode !== 'manual' && <div className="field"><label>À partir du</label><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>}
          {mode === 'every' && <div className="field"><label>Tous les … jours</label><input className="input" type="number" min={1} value={every} onChange={(e) => setEvery(Math.max(1, +e.target.value))} /></div>}
          {mode === 'weekdays' && <div className="field full"><label>Jours</label><div className="chips">{[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} className={`chip ${wds.includes(d) ? 'on' : ''}`} onClick={() => setWds((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d])}>{WEEKDAYS_SHORT[d]}</button>)}</div></div>}
          {(mode === 'daily' || mode === 'every') && <label className="check full"><input type="checkbox" checked={skipSun} onChange={(e) => setSkipSun(e.target.checked)} /> Ne pas suggérer le dimanche</label>}
        </div>
        <div className="row between" style={{ marginBottom: 6 }}>
          <span className="tiny faint">Modifiez n’importe quelle date : elle ne sera plus changée par les suggestions.</span>
          {Object.keys(manual).length > 0 && <button className="btn small ghost" onClick={() => setManual({})}>Revenir aux suggestions</button>}
        </div>
        <div className="date-rows">
          {rows.map((r, i) => {
            const d = dateOf(r.key, i);
            const isManual = r.key in manual;
            return (
              <div key={r.key} className="date-row">
                <span className="n">{i + 1}</span>
                {r.ideaId
                  ? <span className="grow small t">{r.title}</span>
                  : <input className="input grow" style={{ minHeight: 34, padding: '4px 10px', fontSize: 14 }} placeholder={`Contenu ${i + 1} (sujet à préciser)`} value={r.title} onChange={(e) => setBlankTitles((x) => ({ ...x, [r.blankIndex]: e.target.value }))} />}
                <input className={`input date-in ${isManual ? 'manual' : ''}`} type="date" value={d} aria-label={`Date de publication de ${r.title || `contenu ${i + 1}`}`}
                  onChange={(e) => setManual((m) => ({ ...m, [r.key]: e.target.value }))} />
                {d && (perDay.get(d) ?? 0) > 1 && <span className="tag warn" title="Plusieurs publications le même jour">×{perDay.get(d)}</span>}
                {d && <button className="icon-btn small ghost" aria-label="Laisser sans date" title="Sans date pour l’instant" onClick={() => setManual((m) => ({ ...m, [r.key]: '' }))}>✕</button>}
              </div>
            );
          })}
        </div>
        <p className="small muted">
          {dated.length ? <>Publications du <b>{fmtShort(dated[0])}</b> au <b>{fmtShort(dated[dated.length - 1])}</b></> : 'Aucune date choisie pour l’instant'}
          {rows.length - dated.length > 0 && <> · {rows.length - dated.length} sans date (à placer plus tard)</>}
          {' '}· tournage de {rows.length} contenu{rows.length > 1 ? 's' : ''} le <b>{fmtShort(shootDate)}</b>
        </p>
      </>}
    </Sheet>
  );
}
