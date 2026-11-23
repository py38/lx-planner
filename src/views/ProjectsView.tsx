import { useMemo, useState } from 'react';
import { getStore, useData } from '../data/store';
import { useUI } from '../ui/UI';
import { Bar, Empty, CatDot, Sheet, Seg, STATUS_LABEL, STATUS_TAG } from '../ui/kit';
import { ItemRow } from '../ui/ItemRow';
import { projectHealth, projectSteps } from '../logic/progress';
import { setPublishDate, applyRecalc, type RecalcChange } from '../logic/content';
import { createItem, createProject, deleteProject, setProjectDone } from '../data/actions';
import { fmtShort, fmtLong, today, isoWeekKey } from '../lib/date';
import { go, href } from '../lib/router';
import { IconPlus, IconLeft, IconTrash, IconIdea } from '../ui/Icons';
import type { Objective, ObjectiveLevel, Priority, Project, ProjectStatus } from '../data/types';

const LEVEL_LABEL: Record<ObjectiveLevel, string> = { year: 'Annuels', month: 'Mensuels', week: 'Hebdomadaires', oneoff: 'Ponctuels' };
const PSTATUS: Record<ProjectStatus, string> = { active: 'En cours', done: 'Terminé', blocked: 'Bloqué', paused: 'En pause' };

type Filter = 'all' | 'late' | 'blocked' | 'near' | 'done';

export function ProjectsView() {
  const state = useData();
  const [filter, setFilter] = useState<Filter>('all');
  const [editObj, setEditObj] = useState<Partial<Objective> | null>(null);
  const [editProj, setEditProj] = useState<Partial<Project> | null>(null);

  const projects = useMemo(() => Object.values(state.projects).filter((p) => !p.deleted).map((p) => ({ p, h: projectHealth(state, p) })), [state]);
  const filtered = projects.filter(({ p, h }) =>
    filter === 'all' ? p.status !== 'done' : filter === 'done' ? p.status === 'done' : filter === 'late' ? h.late : filter === 'blocked' ? h.blocked : h.nearDeadline);
  const objectives = Object.values(state.objectives).filter((o) => !o.deleted);
  const counts = { late: projects.filter((x) => x.h.late).length, blocked: projects.filter((x) => x.h.blocked).length, near: projects.filter((x) => x.h.nearDeadline).length };

  const ProjectCard = ({ p, h }: { p: Project; h: ReturnType<typeof projectHealth> }) => {
    const cat = p.categoryId ? state.categories[p.categoryId] : undefined;
    return (
      <div className="card" style={{ cursor: 'pointer', marginTop: 0 }} onClick={() => go(`projets/${p.id}`)}>
        <div className="row between" style={{ marginBottom: 6 }}>
          <span className="row" style={{ minWidth: 0 }}><CatDot cat={cat} /><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</b></span>
          <span className="faint small nowrap">{h.pct} %</span>
        </div>
        <Bar pct={h.pct} color={cat?.color} />
        <div className="row wrap small" style={{ marginTop: 8, gap: 6 }}>
          <span className="faint">{h.done}/{h.total} étapes</span>
          {p.type === 'content' && <span className="tag">Contenu{p.publishDate ? ` · ${fmtShort(p.publishDate)}` : ''}</span>}
          {p.deadline && p.type !== 'content' && <span className="tag">Échéance {fmtShort(p.deadline)}</span>}
          {h.blocked && <span className="tag danger">Bloqué</span>}
          {h.late && <span className="tag danger">En retard</span>}
          {!h.late && h.nearDeadline && <span className="tag warn">J-{h.daysLeft}</span>}
          {p.status === 'done' && <span className="tag ok">Terminé</span>}
        </div>
        {h.nextStep && p.status !== 'done' && <div className="tiny faint" style={{ marginTop: 6 }}>Prochaine étape : {h.nextStep.title}{h.nextStep.date ? ` (${fmtShort(h.nextStep.date)})` : ''}</div>}
      </div>
    );
  };

  return (
    <div>
      <div className="page-head">
        <div className="title-block"><div className="eyebrow">Projets & Objectifs</div><h1>Mes projets</h1></div>
        <div className="row">
          <button className="btn" onClick={() => setEditObj({ level: 'year', period: String(new Date().getFullYear()) })}><IconPlus size={16} /> Objectif</button>
          <button className="btn primary" onClick={() => setEditProj({ status: 'active', type: 'standard' })}><IconPlus size={16} /> Projet</button>
        </div>
      </div>

      <div className="chips" style={{ marginBottom: 14 }}>
        {([['all', 'En cours'], ['late', `En retard${counts.late ? ` · ${counts.late}` : ''}`], ['blocked', `Bloqués${counts.blocked ? ` · ${counts.blocked}` : ''}`], ['near', `Échéance proche${counts.near ? ` · ${counts.near}` : ''}`], ['done', 'Terminés']] as [Filter, string][]).map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {filtered.length ? <div className="grid-2">{filtered.map(({ p, h }) => <ProjectCard key={p.id} p={p} h={h} />)}</div> : <Empty>Aucun projet dans cette sélection.</Empty>}

      <div className="section">
        <div className="section-title">Objectifs</div>
        {(['year', 'month', 'week', 'oneoff'] as ObjectiveLevel[]).map((lvl) => {
          const objs = objectives.filter((o) => o.level === lvl);
          if (!objs.length) return null;
          return (
            <div key={lvl} className="card">
              <div className="card-head"><h3>{LEVEL_LABEL[lvl]}</h3></div>
              {objs.map((o) => {
                const linked = projects.filter((x) => x.p.objectiveId === o.id);
                const tot = linked.reduce((s, x) => s + x.h.total, 0), dn = linked.reduce((s, x) => s + x.h.done, 0);
                return (
                  <div key={o.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="row">
                      <button className={`checkbox ${o.done ? 'on' : ''}`} aria-label="Objectif atteint" onClick={() => getStore().update('objectives', o.id, o.done ? { done: false, completedAt: undefined } : { done: true, completedAt: new Date().toISOString() })}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      </button>
                      <div className="grow" style={{ cursor: 'pointer' }} onClick={() => setEditObj(o)}>
                        <div className={o.done ? 'strike' : ''} style={{ fontWeight: 500 }}>{o.title}</div>
                        <div className="tiny faint">{[o.period, o.deadline && `échéance ${fmtShort(o.deadline)}`, linked.length && `${linked.length} projet(s)`].filter(Boolean).join(' · ')}</div>
                      </div>
                      <button className="btn small ghost" onClick={() => setEditProj({ status: 'active', type: 'standard', objectiveId: o.id, categoryId: o.categoryId, deadline: o.deadline })}><IconPlus size={14} /> Projet</button>
                    </div>
                    {tot > 0 && <div style={{ marginTop: 6, paddingLeft: 34 }}><Bar pct={(dn / tot) * 100} thin /></div>}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!objectives.length && <Empty>Aucun objectif pour l’instant.</Empty>}
      </div>

      {editObj && <ObjectiveEditor value={editObj} onClose={() => setEditObj(null)} />}
      {editProj && <ProjectEditor value={editProj} onClose={() => setEditProj(null)} />}
    </div>
  );
}

export function ObjectiveEditor({ value, onClose }: { value: Partial<Objective>; onClose: () => void }) {
  const state = useData();
  const ui = useUI();
  const [o, setO] = useState<Partial<Objective>>(value);
  const cats = Object.values(state.categories).filter((c) => !c.deleted && !c.archived).sort((a, b) => a.order - b.order);
  const defaultPeriod = (lvl: ObjectiveLevel) => lvl === 'year' ? today().slice(0, 4) : lvl === 'month' ? today().slice(0, 7) : lvl === 'week' ? isoWeekKey(today()) : undefined;
  const save = () => {
    if (!o.title?.trim()) return;
    if (o.id) getStore().update('objectives', o.id, o);
    else getStore().create('objectives', { level: 'year', ...o, title: o.title.trim() } as Objective);
    onClose();
  };
  const remove = async () => {
    if (!(await ui.confirm('Supprimer cet objectif ? Les projets liés sont conservés.', { ok: 'Supprimer', danger: true }))) return;
    getStore().transact(() => {
      for (const p of Object.values(getStore().state.projects)) if (p.objectiveId === o.id) getStore().update('projects', p.id, { objectiveId: undefined });
      getStore().remove('objectives', o.id!);
    });
    onClose();
  };
  return (
    <Sheet title={o.id ? 'Objectif' : 'Nouvel objectif'} onClose={onClose} footer={<>
      {o.id && <button className="btn ghost danger" style={{ marginRight: 'auto' }} onClick={remove}><IconTrash size={16} /></button>}
      <button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button>
    </>}>
      <div className="col" style={{ gap: 12 }}>
        <input className="input title-input" autoFocus placeholder="Ex : Lancer LX Academy Online" value={o.title ?? ''} onChange={(e) => setO({ ...o, title: e.target.value })} />
        <div className="field"><label>Niveau</label>
          <Seg value={(o.level ?? 'year') as ObjectiveLevel} onChange={(l) => setO({ ...o, level: l, period: defaultPeriod(l) })} options={(['year', 'month', 'week', 'oneoff'] as ObjectiveLevel[]).map((l) => ({ value: l, label: { year: 'Année', month: 'Mois', week: 'Semaine', oneoff: 'Ponctuel' }[l] }))} />
        </div>
        <div className="form-grid">
          {o.level !== 'oneoff' && <div className="field"><label>Période</label>
            {o.level === 'month' ? <input className="input" type="month" value={o.period ?? ''} onChange={(e) => setO({ ...o, period: e.target.value })} />
              : o.level === 'week' ? <input className="input" type="week" value={o.period ?? ''} onChange={(e) => setO({ ...o, period: e.target.value })} />
              : <input className="input" inputMode="numeric" value={o.period ?? ''} onChange={(e) => setO({ ...o, period: e.target.value })} />}
          </div>}
          <div className="field"><label>Date cible</label><input className="input" type="date" value={o.deadline ?? ''} onChange={(e) => setO({ ...o, deadline: e.target.value || undefined })} /></div>
          <div className="field full"><label>Catégorie</label>
            <select className="input" value={o.categoryId ?? ''} onChange={(e) => setO({ ...o, categoryId: e.target.value || undefined })}>
              <option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field"><label>Description</label><textarea className="input" value={o.description ?? ''} onChange={(e) => setO({ ...o, description: e.target.value })} /></div>
      </div>
    </Sheet>
  );
}

export function ProjectEditor({ value, onClose }: { value: Partial<Project>; onClose: () => void }) {
  const state = useData();
  const [p, setP] = useState<Partial<Project>>(value);
  const cats = Object.values(state.categories).filter((c) => !c.deleted && !c.archived).sort((a, b) => a.order - b.order);
  const objectives = Object.values(state.objectives).filter((o) => !o.deleted && !o.done);
  const save = () => {
    if (!p.title?.trim()) return;
    if (p.id) getStore().update('projects', p.id, p);
    else {
      const created = createProject({ ...p, title: p.title.trim() });
      go(`projets/${created.id}`);
    }
    onClose();
  };
  return (
    <Sheet title={p.id ? 'Modifier le projet' : 'Nouveau projet'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <input className="input title-input" autoFocus placeholder="Nom du projet" value={p.title ?? ''} onChange={(e) => setP({ ...p, title: e.target.value })} />
        <div className="form-grid">
          <div className="field"><label>Objectif</label>
            <select className="input" value={p.objectiveId ?? ''} onChange={(e) => setP({ ...p, objectiveId: e.target.value || undefined })}>
              <option value="">Aucun</option>{objectives.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          </div>
          <div className="field"><label>Catégorie</label>
            <select className="input" value={p.categoryId ?? ''} onChange={(e) => setP({ ...p, categoryId: e.target.value || undefined })}>
              <option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Échéance finale</label><input className="input" type="date" value={p.deadline ?? ''} onChange={(e) => setP({ ...p, deadline: e.target.value || undefined })} /></div>
          <div className="field"><label>Statut</label>
            <select className="input" value={p.status ?? 'active'} onChange={(e) => setP({ ...p, status: e.target.value as ProjectStatus })}>
              {(Object.keys(PSTATUS) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PSTATUS[s]}</option>)}
            </select>
          </div>
        </div>
        <div className="field"><label>Description</label><textarea className="input" value={p.description ?? ''} onChange={(e) => setP({ ...p, description: e.target.value })} /></div>
      </div>
    </Sheet>
  );
}

export function ProjectDetail({ id }: { id: string }) {
  const state = useData();
  const ui = useUI();
  const p = state.projects[id];
  const [edit, setEdit] = useState(false);
  const [recalc, setRecalc] = useState<(RecalcChange & { on: boolean })[] | null>(null);
  const [nt, setNt] = useState({ title: '', date: '', duration: '', priority: 'important' as Priority });
  if (!p || p.deleted) return <Empty>Projet introuvable. <a href={href('projets')}>Retour</a></Empty>;
  const h = projectHealth(state, p);
  const steps = projectSteps(state, id);
  const cat = p.categoryId ? state.categories[p.categoryId] : undefined;
  const objective = p.objectiveId ? state.objectives[p.objectiveId] : undefined;
  const idea = p.ideaId ? state.ideas[p.ideaId] : undefined;

  const addStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nt.title.trim()) return;
    createItem({ title: nt.title.trim(), projectId: id, categoryId: p.categoryId, ideaId: p.ideaId, date: nt.date || undefined, duration: nt.duration ? +nt.duration : undefined, priority: nt.priority, order: steps.length });
    setNt({ ...nt, title: '' });
  };

  const changePublish = (d: string) => {
    if (!d) return;
    const proposal = setPublishDate(id, d);
    if (proposal.length) setRecalc(proposal.map((c) => ({ ...c, on: true })));
    else ui.toast('Date de publication mise à jour');
  };

  return (
    <div>
      <div className="page-head">
        <div className="title-block" style={{ minWidth: 0 }}>
          <a className="eyebrow row" href={href('projets')} style={{ textDecoration: 'none' }}><IconLeft size={12} /> Projets</a>
          <h1>{p.title}</h1>
          <div className="row wrap small muted" style={{ marginTop: 4, gap: 8 }}>
            {cat && <span className="row"><CatDot cat={cat} /> {cat.name}</span>}
            {objective && <span>· Objectif : {objective.title}</span>}
            {p.deadline && <span>· Échéance {fmtLong(p.deadline)}</span>}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setEdit(true)}>Modifier</button>
          <button className={`btn ${h.pct === 100 && p.status !== 'done' ? 'primary' : ''}`} onClick={() => setProjectDone(id, p.status !== 'done')}>{p.status === 'done' ? 'Rouvrir' : 'Marquer terminé'}</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row between small" style={{ marginBottom: 6 }}>
          <span><b>{h.pct} %</b> · {h.done} étape{h.done > 1 ? 's' : ''} validée{h.done > 1 ? 's' : ''} sur {h.total}</span>
          <span className="row" style={{ gap: 6 }}>
            <span className="tag">{PSTATUS[p.status]}</span>
            {h.late && <span className="tag danger">En retard</span>}
            {h.blocked && <span className="tag danger">Bloqué</span>}
            {!h.late && h.nearDeadline && <span className="tag warn">J-{h.daysLeft}</span>}
          </span>
        </div>
        <Bar pct={h.pct} color={cat?.color} />
        {p.description && <p className="small muted" style={{ marginBottom: 0 }}>{p.description}</p>}
      </div>

      {p.type === 'content' && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head"><h3>Publication</h3>{idea && <a className="btn small ghost" href={href('contenu/idees')}><IconIdea size={14} /> Idée d’origine</a>}</div>
          <div className="row wrap">
            <div className="field" style={{ width: 200 }}><label>Date de publication</label>
              <input className="input" type="date" value={p.publishDate ?? ''} onChange={(e) => changePublish(e.target.value)} />
            </div>
            <div className="small muted grow">Si vous changez cette date, l’application vous proposera de recalculer les dates du script, du tournage et du montage. Rien n’est modifié sans votre accord.</div>
          </div>
        </div>
      )}

      <div className="section-title">Étapes</div>
      <form className="card" onSubmit={addStep} style={{ marginBottom: 10, padding: 12 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <input className="input grow" style={{ minWidth: 180 }} placeholder="Nouvelle étape…" value={nt.title} onChange={(e) => setNt({ ...nt, title: e.target.value })} />
          <input className="input" type="date" style={{ width: 160 }} value={nt.date} onChange={(e) => setNt({ ...nt, date: e.target.value })} aria-label="Date (facultatif)" />
          <input className="input" type="number" min={0} step={15} style={{ width: 100 }} placeholder="min" value={nt.duration} onChange={(e) => setNt({ ...nt, duration: e.target.value })} aria-label="Durée estimée" />
          <select className="input" style={{ width: 140 }} value={nt.priority} onChange={(e) => setNt({ ...nt, priority: e.target.value as Priority })}>
            <option value="must">Obligatoire</option><option value="important">Important</option><option value="optional">Facultatif</option>
          </select>
          <button className="btn primary" type="submit"><IconPlus size={16} /> Ajouter</button>
        </div>
        <div className="tiny faint" style={{ marginTop: 6 }}>Une étape datée apparaît automatiquement dans le calendrier ; sans date, elle va dans « À planifier ».</div>
      </form>
      {steps.length ? steps.map((s) => (
        <ItemRow key={s.id} item={s} showDate actions={s.status !== 'todo' && s.status !== 'done' ? <span className={`tag ${STATUS_TAG[s.status]}`}>{STATUS_LABEL[s.status]}</span> : undefined} />
      )) : <Empty>Aucune étape. Ajoutez la première ci-dessus.</Empty>}

      <div className="section card">
        <div className="card-head"><h3>Notes</h3></div>
        <textarea className="input" defaultValue={p.notes ?? ''} placeholder="Notes, liens, idées…" onBlur={(e) => e.target.value !== (p.notes ?? '') && getStore().update('projects', id, { notes: e.target.value })} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn ghost danger small" onClick={async () => {
            const withTasks = await ui.confirm('Supprimer ce projet. Voulez-vous aussi supprimer ses étapes non terminées ? (Les étapes terminées restent dans votre historique.)', { ok: 'Supprimer projet + étapes', cancel: 'Garder les étapes' });
            if (!(await ui.confirm(`Confirmer la suppression de « ${p.title} » ?`, { ok: 'Supprimer', danger: true }))) return;
            deleteProject(id, withTasks);
            go('projets');
          }}><IconTrash size={15} /> Supprimer le projet</button>
        </div>
      </div>

      {edit && <ProjectEditor value={p} onClose={() => setEdit(false)} />}
      {recalc && (
        <Sheet title="Réorganiser les étapes ?" onClose={() => setRecalc(null)} footer={<>
          <button className="btn" onClick={() => { setRecalc(null); ui.toast('Étapes laissées telles quelles'); }}>Ne rien changer</button>
          <button className="btn primary" onClick={() => { applyRecalc(recalc.filter((r) => r.on)); setRecalc(null); ui.toast('Étapes recalculées'); }}>Appliquer</button>
        </>}>
          <p className="muted small" style={{ marginTop: 0 }}>La date de publication a changé. Ces étapes pourraient être décalées pour garder le même rythme de préparation :</p>
          {recalc.map((r, i) => (
            <label key={r.item.id} className="check" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <input type="checkbox" checked={r.on} onChange={(e) => setRecalc(recalc.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))} />
              <span className="grow">{r.item.title}</span>
              <span className="small nowrap">{r.from ? fmtShort(r.from) : '—'} → <b>{fmtShort(r.to)}</b></span>
            </label>
          ))}
        </Sheet>
      )}
    </div>
  );
}
