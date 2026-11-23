// Banque d'idées de contenu : les fiches sans date. Mêmes champs que le calendrier de contenu.
import { useMemo, useState } from 'react';
import { getStore, useData } from '../../data/store';
import { useUI } from '../../ui/UI';
import { Empty, Sheet } from '../../ui/kit';
import { Cover } from '../../ui/Cover';
import { blankContent, type ContentDraft } from './ContentEditor';
import {
  FORMAT_COLOR, FORMAT_LABEL, GOAL_LABEL, PILLAR_LABEL, bankFilter, contentProgress, isBankIdea, isPosted, type BankFilter,
} from '../../logic/contentPlan';
import { applyNotionImport, isNotionBundle, planNotionImport, type ImportPlan } from '../../data/importNotion';
import { fmtShort, today, addDays } from '../../lib/date';
import { contentUrgency, urgencyDays, urgencyLabel, URGENT_RED } from '../../logic/urgency';
import { href } from '../../lib/router';
import { IconUpload } from '../../ui/Icons';
import type { ContentFormat, ContentPiece } from '../../data/types';

export function IdeaBank({ onEdit }: { onEdit: (c: ContentDraft) => void }) {
  const state = useData();
  const ui = useUI();
  const contents = useMemo(() => Object.values(state.contents).filter((c) => !c.deleted), [state]);
  const [filter, setFilter] = useState<BankFilter>('todo');
  const [format, setFormat] = useState<ContentFormat | 'all'>('all');
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState('');
  const [quickFormat, setQuickFormat] = useState<ContentFormat>('reel');
  const [plan, setPlan] = useState<ContentPiece | null>(null);
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);

  const count = (f: BankFilter) => contents.filter((c) => bankFilter(c, f)).length;
  const shown = contents
    .filter((c) => bankFilter(c, filter) && (format === 'all' || c.format === format))
    .filter((c) => !q.trim() || `${c.title} ${c.hook ?? ''} ${c.script ?? ''} ${(c.tags ?? []).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => filter === 'planned' ? (a.publishDate ?? a.shootDate ?? '').localeCompare(b.publishDate ?? b.shootDate ?? '') : b.createdAt.localeCompare(a.createdAt));

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quick.trim()) return;
    getStore().create('contents', { ...blankContent({ format: quickFormat }), title: quick.trim() } as ContentPiece);
    setQuick('');
    ui.toast('Idée ajoutée à la banque');
  };

  return (
    <div>
      <form className="card" onSubmit={add} style={{ marginBottom: 12 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <input className="input grow" style={{ minWidth: 200 }} placeholder="Notez une idée de contenu en 5 secondes…" value={quick} onChange={(e) => setQuick(e.target.value)} />
          <select className="input" style={{ width: 140 }} value={quickFormat} onChange={(e) => setQuickFormat(e.target.value as ContentFormat)}>
            {(Object.keys(FORMAT_LABEL) as ContentFormat[]).map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
          </select>
          <button className="btn primary" type="submit">Ajouter</button>
        </div>
        <div className="row between wrap" style={{ marginTop: 8, gap: 8 }}>
          <span className="tiny faint">Une idée reste ici tant qu’elle n’a pas de date. Ouvrez-la pour écrire l’accroche, le script, le CTA et la légende.</span>
          <label className="btn small" style={{ cursor: 'pointer' }}>
            <IconUpload size={14} /> Importer depuis Notion
            <input type="file" accept="application/json,.json" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const json = JSON.parse(await f.text());
                if (!isNotionBundle(json)) throw new Error('ce fichier n’est pas un export de la Banque d’idées');
                setImportPlan(planNotionImport(getStore().state, json));
              } catch (err: any) {
                ui.toast(`Import impossible : ${err?.message ?? err}`);
              }
            }} />
          </label>
        </div>
      </form>

      <div className="chips" style={{ marginBottom: 8 }}>
        {([['todo', 'À planifier'], ['planned', 'Planifiées'], ['posted', 'Publiées'], ['all', 'Toutes']] as [BankFilter, string][]).map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l} · {count(k)}</button>
        ))}
      </div>
      <div className="row wrap" style={{ marginBottom: 12, gap: 8 }}>
        <div className="chips">
          <button className={`chip ${format === 'all' ? 'on' : ''}`} onClick={() => setFormat('all')}>Tous formats</button>
          {(Object.keys(FORMAT_LABEL) as ContentFormat[]).map((f) => <button key={f} className={`chip ${format === f ? 'on' : ''}`} onClick={() => setFormat(f)}>{FORMAT_LABEL[f]}</button>)}
        </div>
        <input className="input grow" style={{ minWidth: 160, minHeight: 34, padding: '4px 12px', fontSize: 14 }} placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {shown.length ? (
        <div className="idea-list">
          {shown.map((c) => {
            const p = contentProgress(c);
            const u = contentUrgency(c, today(), urgencyDays(state));
            const when = isPosted(c)
              ? `Publié${c.publishDate ? ` le ${fmtShort(c.publishDate)}` : ''}`
              : [c.shootDate && `🎬 ${fmtShort(c.shootDate)}`, c.publishDate && `pub. ${fmtShort(c.publishDate)}`].filter(Boolean).join(' · ');
            return (
              <div key={c.id} className={`idea-row ${u.any ? `urg-row-${u.any}` : ''}`} onClick={() => onEdit(c)}>
                <span className="idea-bar" style={{ background: u.any ? URGENT_RED : FORMAT_COLOR[c.format] }} />
                {c.coverMediaId && <div className="idea-thumb"><Cover mediaId={c.coverMediaId} crop={c.coverCrop} aspect="3:4" /></div>}
                <div className="idea-main">
                  <div className="idea-title">{c.title}</div>
                  <div className="idea-meta">
                    <span>{FORMAT_LABEL[c.format]}</span>
                    {c.goal && <span>{GOAL_LABEL[c.goal]}</span>}
                    {c.pillar && <span>{PILLAR_LABEL[c.pillar]}</span>}
                    {when && <span>{when}</span>}
                    {(c.tags ?? []).slice(0, 2).map((t) => <span key={t}>#{t}</span>)}
                  </div>
                </div>
                {u.any && <span className={`urg-tag ${u.any}`}>{urgencyLabel(u.any, u.daysLeft)}</span>}
                <span className={`idea-prog ${p.pct === 100 ? 'ok' : ''}`} title="Étapes faites">{p.done}/{p.total}</span>
                {!isPosted(c) && <button className="btn small idea-plan" onClick={(e) => { e.stopPropagation(); setPlan(c); }}>{isBankIdea(c) ? 'Planifier' : 'Dates'}</button>}
              </div>
            );
          })}
        </div>
      ) : <Empty>{filter === 'todo' ? 'Aucune idée en attente. Notez-en une ci-dessus, ou importez votre Banque d’idées Notion.' : 'Rien dans cette sélection.'}</Empty>}

      {plan && <PlanIdeaSheet piece={plan} onClose={() => setPlan(null)} />}
      {importPlan && <ImportSheet plan={importPlan} onClose={() => setImportPlan(null)} />}
    </div>
  );
}

/** Donner une date de tournage et/ou de publication à une idée → elle rejoint le calendrier de contenu. */
function PlanIdeaSheet({ piece, onClose }: { piece: ContentPiece; onClose: () => void }) {
  const ui = useUI();
  const [shoot, setShoot] = useState(piece.shootDate ?? '');
  const [pub, setPub] = useState(piece.publishDate ?? '');
  const [time, setTime] = useState(piece.publishTime ?? '18:00');
  const [alert, setAlert] = useState(!!piece.redAlert);
  const save = () => {
    getStore().update('contents', piece.id, { shootDate: shoot || undefined, publishDate: pub || undefined, publishTime: pub ? time || undefined : undefined, redAlert: alert || undefined });
    ui.toast(shoot || pub ? 'Ajoutée au calendrier de contenu' : 'Remise dans les idées à planifier');
    onClose();
  };
  return (
    <Sheet title="Planifier cette idée" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn primary" onClick={save}>Enregistrer</button>
    </>}>
      <p className="small muted" style={{ marginTop: 0 }}>« {piece.title} »</p>
      <div className="form-grid">
        <div className="field"><label>Jour de tournage</label><input className="input" type="date" value={shoot} onChange={(e) => setShoot(e.target.value)} /></div>
        <div className="field"><label>Date de publication</label><input className="input" type="date" value={pub} onChange={(e) => setPub(e.target.value)} /></div>
        <div className="field"><label>Heure de publication</label><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <label className="check" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={alert} onChange={(e) => setAlert(e.target.checked)} />
        <span><b>🔴 Alerte rouge</b> — en rouge {piece.redAlertDays ?? 3} jours avant la publication si pas tourné et monté</span>
      </label>
      <div className="chips" style={{ marginTop: 10 }}>
        <button className="chip" onClick={() => setShoot(addDays(today(), 1))}>Tourner demain</button>
        {shoot && <a className="chip" href={href(`contenu/tournage/${shoot}`)}>Voir ce jour de tournage</a>}
        {(piece.shootDate || piece.publishDate) && <button className="chip" onClick={() => { setShoot(''); setPub(''); }}>Retirer les dates (remettre en idée)</button>}
      </div>
      <p className="tiny faint">C’est la même fiche : les textes, la couverture et les cases cochées restent attachés à l’idée.</p>
    </Sheet>
  );
}

/** Aperçu de l'import Notion : rien n'est ajouté avant la confirmation. */
function ImportSheet({ plan, onClose }: { plan: ImportPlan; onClose: () => void }) {
  const ui = useUI();
  const ideas = plan.contents.filter((c) => isBankIdea(c));
  const planned = plan.contents.filter((c) => !isBankIdea(c) && !isPosted(c));
  const posted = plan.contents.filter(isPosted);
  return (
    <Sheet title="Importer la Banque d’idées Notion" onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn primary" disabled={!plan.contents.length} onClick={() => {
        const r = applyNotionImport(plan);
        ui.toast(`${r.contents} fiche(s) importée(s)`);
        onClose();
      }}>Importer {plan.contents.length} fiche{plan.contents.length > 1 ? 's' : ''}</button>
    </>}>
      {!plan.contents.length ? <p className="small">Tout ce fichier est déjà dans l’application. Rien à ajouter.</p> : (
        <>
          <div className="grid-3" style={{ marginBottom: 12 }}>
            <div className="kpi-card"><div className="l">Idées à planifier</div><div className="big-num">{ideas.length}</div><div className="sub">sans date</div></div>
            <div className="kpi-card"><div className="l">Déjà planifiées</div><div className="big-num">{planned.length}</div><div className="sub">tournage ou publication datés</div></div>
            <div className="kpi-card"><div className="l">Déjà publiées</div><div className="big-num">{posted.length}</div><div className="sub">gardées en historique</div></div>
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>Accroche, script, CTA, légende, format, objectif, pilier et dates sont repris de Notion. Les étapes déjà faites dans Notion sont cochées. Relancer l’import ne crée aucun doublon.</p>
          {plan.contents.map((c) => (
            <div key={c.id} className="row small" style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
              <span className="tag" style={{ minWidth: 70, justifyContent: 'center' }}>{FORMAT_LABEL[c.format]}</span>
              <span className="grow">{c.title}</span>
              {c.publishDate && <span className="tag">{fmtShort(c.publishDate)}</span>}
            </div>
          ))}
          {plan.skipped.length > 0 && <p className="tiny faint">{plan.skipped.length} déjà présente(s), ignorée(s).</p>}
        </>
      )}
    </Sheet>
  );
}
