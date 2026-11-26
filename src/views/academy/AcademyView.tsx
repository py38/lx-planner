// Espace LX Academy Présentiel : accueil (10 rubriques), bibliothèque pédagogique et paramètres.
// Phase 1 : fondations. Les rubriques des phases suivantes sont visibles mais annoncées « à venir ».
import { useMemo, useState, type ReactNode } from 'react';
import { getStore, useData } from '../../data/store';
import { useUI } from '../../ui/UI';
import { Empty, Seg, Sheet } from '../../ui/kit';
import { href } from '../../lib/router';
import { today, fmtLong } from '../../lib/date';
import { IconLeft, IconPlus, IconRight } from '../../ui/Icons';
import { AC_SETTINGS_ID } from '../../data/academyDefaults';
import {
  FORMAT_LABEL, MODALITY_LABEL, ONLINE_TYPES, TYPE_LABEL, dayConsistency, euros, hasOnline, hasOnsite, hours, missingSetup, modalityOf, offerPedagogicalMin, parseEuros, setDefault, termsSummary, updateModule, updateOfferTerms,
} from '../../logic/academy';
import type { AcFormat, AcIdentity, AcModality, AcModule, AcModuleContent, AcOffer, AcOfferTerms, AcTrainer, AcTrainingType, AcVenue } from '../../data/types';

interface Section { key: string; title: string; text: string; phase?: number }
export const ACADEMY_SECTIONS: Section[] = [
  { key: 'tableau-de-bord', title: 'Tableau de bord', text: 'Ventes, encaissements, prochaines formations, actions à faire', phase: 6 },
  { key: 'prospects', title: 'Prospects & inscriptions', text: 'Pipeline, appels découverte, relances', phase: 2 },
  { key: 'sessions', title: 'Sessions', text: 'Coachings Solo et Duo, calendrier, conflits', phase: 2 },
  { key: 'stagiaires', title: 'Stagiaires', text: 'Dossiers individuels', phase: 2 },
  { key: 'reglements', title: 'Règlements', text: 'Échéanciers, paiements, Stripe', phase: 2 },
  { key: 'bibliotheque', title: 'Bibliothèque pédagogique', text: 'Modules M01 à M15 et vos supports' },
  { key: 'documents', title: 'Documents & modèles', text: 'Programmes, contrats, livrets, attestations', phase: 3 },
  { key: 'qualite', title: 'Qualité & satisfaction', text: 'Questionnaires, réclamations, amélioration continue', phase: 5 },
  { key: 'statistiques', title: 'Statistiques & objectifs', text: 'Indicateurs commerciaux et pédagogiques', phase: 6 },
  { key: 'parametres', title: 'Paramètres', text: 'Tarifs, lieux, formatrices, identité administrative' },
];

export function AcademyView({ route }: { route: string[] }) {
  const sub = route[1];
  if (sub === 'bibliotheque') return <LibraryPage />;
  if (sub === 'parametres') return <SettingsPage />;
  const section = ACADEMY_SECTIONS.find((s) => s.key === sub);
  if (section) return <ComingSoon section={section} />;
  return <AcademyHome />;
}

function Head({ title, back = true, action }: { title: string; back?: boolean; action?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="title-block">
        {back
          ? <a className="eyebrow ac-back" href={href('academy')}><IconLeft size={13} /> LX Academy</a>
          : <div className="eyebrow">LX Academy Présentiel</div>}
        <h1>{title}</h1>
      </div>
      {action}
    </div>
  );
}

function AcademyHome() {
  const state = useData();
  const missing = useMemo(() => missingSetup(state), [state]);
  return (
    <div>
      <Head title="Formations en présentiel" back={false} />
      {missing.length > 0 && (
        <a className="banner ac-banner" href={href('academy/parametres')}>
          <span className="grow">À compléter dans les paramètres : {missing.join(', ').toLowerCase()}.</span>
          <IconRight size={16} />
        </a>
      )}
      <div className="ac-tiles">
        {ACADEMY_SECTIONS.map((s) => (
          <a key={s.key} className={`ac-tile ${s.phase ? 'soon' : ''}`} href={href(`academy/${s.key}`)}>
            <span className="ac-tile-title">{s.title}</span>
            <span className="ac-tile-text">{s.text}</span>
            {s.phase && <span className="tag">Phase {s.phase}</span>}
          </a>
        ))}
      </div>
    </div>
  );
}

function ComingSoon({ section }: { section: Section }) {
  return (
    <div>
      <Head title={section.title} />
      <div className="card">
        <p style={{ marginTop: 0 }}>{section.text}.</p>
        <p className="small muted" style={{ marginBottom: 0 }}>Cette rubrique arrive en <strong>phase {section.phase}</strong>, après validation de la phase en cours. Rien n’est encore enregistré ici.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Bibliothèque pédagogique

function LibraryPage() {
  const state = useData();
  const [show, setShow] = useState<'active' | 'archived'>('active');
  const [edit, setEdit] = useState<Partial<AcModule> | null>(null);
  const all = Object.values(state.acModules).filter((m) => !m.deleted).sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
  const list = all.filter((m) => m.status === show);
  const nextCode = () => {
    const max = Math.max(0, ...all.map((m) => Number(/^M(\d+)$/.exec(m.code)?.[1] ?? 0)));
    return `M${String(max + 1).padStart(2, '0')}`;
  };
  return (
    <div>
      <Head title="Bibliothèque pédagogique" action={<button className="btn primary" onClick={() => setEdit({ code: nextCode(), status: 'active' })}><IconPlus size={16} /> Module</button>} />
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <Seg value={show} onChange={setShow} options={[{ value: 'active', label: `Actifs (${all.filter((m) => m.status === 'active').length})` }, { value: 'archived', label: 'Archivés' }]} />
      </div>
      {!list.length && <Empty>{show === 'active' ? 'Aucun module actif.' : 'Aucun module archivé.'}</Empty>}
      <div className="card ac-list">
        {list.map((m) => (
          <button key={m.id} className="ac-row" onClick={() => setEdit(m)}>
            <span className="ac-code">{m.code}</span>
            <span className="ac-row-main">
              <span className="ac-row-title">{m.title}</span>
              <span className="tiny faint">{m.objective || 'Objectif à compléter'}</span>
            </span>
            <span className="ac-row-side tiny faint">
              {m.durationMin ? hours(m.durationMin) : 'Durée ?'}
              {!m.pdfFileId && <span className="tag warn">Support à importer</span>}
            </span>
          </button>
        ))}
      </div>
      <p className="tiny faint" style={{ marginTop: 10 }}>Les supports PDF (Canva) s’importeront en phase 3. Le contenu détaillé reste à compléter par vous : rien n’est inventé.</p>
      {edit && <ModuleEditor initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

const MODULE_FIELDS: [keyof AcModuleContent, string][] = [
  ['title', 'Intitulé'], ['durationMin', 'Durée prévisionnelle'], ['objective', 'Objectif pédagogique'], ['content', 'Contenu détaillé'],
  ['prerequisites', 'Prérequis'], ['material', 'Matériel'], ['evaluationCriteria', 'Critères d’évaluation'],
];

function ModuleEditor({ initial, onClose }: { initial: Partial<AcModule>; onClose: () => void }) {
  const ui = useUI();
  const [d, setD] = useState<Partial<AcModule>>(initial);
  const set = (p: Partial<AcModule>) => setD((x) => ({ ...x, ...p }));
  const save = () => {
    const store = getStore();
    if (!d.code?.trim() || !d.title?.trim()) return ui.toast('Le code et l’intitulé sont obligatoires');
    const clean = { ...d, code: d.code.trim(), title: d.title.trim(), objective: d.objective?.trim() ?? '' };
    if (initial.id) {
      const { record, changed } = updateModule(store, initial.id, clean);
      ui.toast(changed && record ? `Module enregistré — version ${record.version} (l’ancienne est conservée)` : 'Module enregistré');
    } else {
      const order = Math.max(-1, ...store.list('acModules').map((m) => m.order)) + 1;
      store.create('acModules', { ...clean, version: 1, versionDate: today(), status: 'active', order } as AcModule);
      ui.toast('Module ajouté');
    }
    onClose();
  };
  const archive = () => {
    if (!initial.id) return;
    const next = initial.status === 'archived' ? 'active' : 'archived';
    getStore().update('acModules', initial.id, { status: next });
    ui.toast(next === 'archived' ? 'Module archivé (il reste consultable)' : 'Module réactivé');
    onClose();
  };
  const field = (label: string, key: keyof AcModule, rows?: number, placeholder?: string) => (
    <div className="field">
      <label>{label}</label>
      {rows
        ? <textarea className="input" rows={rows} placeholder={placeholder} value={(d[key] as string) ?? ''} onChange={(e) => set({ [key]: e.target.value })} />
        : <input className="input" placeholder={placeholder} value={(d[key] as string) ?? ''} onChange={(e) => set({ [key]: e.target.value })} />}
    </div>
  );
  return (
    <Sheet title={initial.id ? `${initial.code} — module` : 'Nouveau module'} onClose={onClose}
      footer={<>
        {initial.id && <button className="btn ghost" onClick={archive}>{initial.status === 'archived' ? 'Réactiver' : 'Archiver'}</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" onClick={save}>Enregistrer</button>
      </>}>
      <div className="grid">
        <div className="ac-two">
          {field('Code', 'code')}
          <div className="field">
            <label>Durée prévisionnelle (minutes)</label>
            <input className="input" inputMode="numeric" value={d.durationMin ?? ''} placeholder="ex. 90" onChange={(e) => set({ durationMin: e.target.value ? Math.max(0, Number(e.target.value.replace(/\D/g, ''))) : undefined })} />
          </div>
        </div>
        {field('Intitulé', 'title')}
        {field('Objectif pédagogique', 'objective', 2)}
        {field('Contenu détaillé', 'content', 5, 'À compléter par vous')}
        {field('Prérequis', 'prerequisites', 2)}
        {field('Matériel', 'material', 2)}
        {field('Critères d’évaluation', 'evaluationCriteria', 3)}
        {initial.id && <p className="tiny faint" style={{ margin: 0 }}>Version {initial.version} · mise à jour le {fmtLong(initial.versionDate!)}. Modifier le contenu crée automatiquement une nouvelle version ; l’ancienne est conservée en entier ci-dessous.</p>}
        {!!initial.history?.length && (
          <div>
            <div className="section-title">Versions précédentes</div>
            {[...initial.history].reverse().map((h) => (
              <details key={`${h.version}-${h.replacedAt}`} className="ac-version">
                <summary className="small">v{h.version} · {h.title} <span className="tiny faint">· du {new Date(h.versionDate).toLocaleDateString('fr-FR')} au {new Date(h.replacedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span></summary>
                <dl className="ac-version-body tiny">
                  {MODULE_FIELDS.map(([k, label]) => (
                    <div key={k}><dt className="faint">{label}</dt><dd>{k === 'durationMin' ? (h.durationMin ? `${h.durationMin} min` : '—') : ((h[k] as string | undefined) || '—')}</dd></div>
                  ))}
                </dl>
              </details>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Paramètres

function SettingsPage() {
  const state = useData();
  const missing = useMemo(() => missingSetup(state), [state]);
  return (
    <div>
      <Head title="Paramètres" />
      {missing.length > 0 && <div className="banner" style={{ marginBottom: 12 }}>À compléter : {missing.join(', ').toLowerCase()}.</div>}
      <OffersSection />
      <TrainersSection />
      <VenuesSection />
      <IdentitySection />
    </div>
  );
}

function OffersSection() {
  const state = useData();
  const [edit, setEdit] = useState<Partial<AcOffer> | null>(null);
  const offers = Object.values(state.acOffers).filter((o) => !o.deleted).sort((a, b) => a.order - b.order);
  return (
    <div className="card">
      <div className="card-head"><h3>Catalogue & tarifs</h3><button className="btn small" onClick={() => setEdit({ type: 'private_coaching', format: 'solo', active: true })}><IconPlus size={14} /> Offre</button></div>
      <div className="ac-list">
        {offers.map((o) => (
          <button key={o.id} className={`ac-row ${o.active ? '' : 'off'}`} onClick={() => setEdit(o)}>
            <span className="ac-row-main">
              <span className="ac-row-title">{o.title}</span>
              <span className="tiny faint">{termsSummary(o)}</span>
            </span>
            <span className="ac-row-side">
              <strong>{euros(o.priceCents)}</strong>
              <span className="tiny faint">{o.format === 'solo' ? '' : 'par stagiaire · '}v{o.version}{o.active ? '' : ' · inactive'}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="tiny faint" style={{ marginBottom: 0 }}>Un changement de tarif ne modifie jamais une inscription déjà enregistrée : elle garde le tarif du jour où elle a été faite.</p>
      {edit && <OfferEditor initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function OfferEditor({ initial, onClose }: { initial: Partial<AcOffer>; onClose: () => void }) {
  const ui = useUI();
  const opt = (n: number | undefined) => (n === undefined ? '' : String(n));
  const [d, setD] = useState({
    title: initial.title ?? '', type: (initial.type ?? 'private_coaching') as AcTrainingType, format: (initial.format ?? 'solo') as AcFormat,
    modality: modalityOf(initial),
    price: initial.priceCents !== undefined ? String(initial.priceCents / 100).replace('.', ',') : '',
    // présentiel (valeurs proposées pour une nouvelle offre)
    capacity: initial.id ? opt(initial.capacity) : '1', days: initial.id ? opt(initial.days) : '1',
    startTime: initial.startTime ?? (initial.id ? '' : '09:00'), endTime: initial.endTime ?? (initial.id ? '' : '17:00'),
    lunchMin: initial.id ? opt(initial.lunchMin) : '30', pedagogicalMinPerDay: initial.id ? opt(initial.pedagogicalMinPerDay) : '450',
    // en ligne
    accessDays: opt(initial.accessDays), lessons: opt(initial.lessons), onlineMinutes: opt(initial.onlineMinutes), platform: initial.platform ?? '',
    active: initial.active ?? true,
  });
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  /** nombre saisi, ou undefined si le champ est vide */
  const num = (v: string) => (v.trim() === '' ? undefined : Math.max(0, Math.round(Number(v.replace(',', '.')) || 0)));
  const onsite = hasOnsite(d.modality);
  const online = hasOnline(d.modality);
  // seules les conditions de la modalité choisie sont enregistrées ; les autres champs de l'offre restent tels quels
  const terms: Partial<AcOfferTerms> & { priceCents: number } = {
    priceCents: parseEuros(d.price) ?? -1,
    ...(onsite ? { capacity: num(d.capacity), days: num(d.days), startTime: d.startTime || undefined, endTime: d.endTime || undefined, lunchMin: num(d.lunchMin), pedagogicalMinPerDay: num(d.pedagogicalMinPerDay) } : {}),
    ...(online ? { accessDays: num(d.accessDays), lessons: num(d.lessons), onlineMinutes: num(d.onlineMinutes), platform: d.platform.trim() || undefined } : {}),
  };
  const warn = onsite ? dayConsistency(terms) : null;
  const total = offerPedagogicalMin({ ...terms, modality: d.modality });
  const save = async () => {
    if (!d.title.trim()) return ui.toast('L’intitulé est obligatoire');
    if (terms.priceCents < 0) return ui.toast('Tarif invalide');
    if (onsite && (!terms.capacity || terms.capacity < 1 || !terms.days || terms.days < 1)) return ui.toast('Présentiel : capacité et nombre de journées, au moins 1');
    if (onsite && (!terms.startTime || !terms.endTime || terms.lunchMin === undefined || terms.pedagogicalMinPerDay === undefined)) return ui.toast('Présentiel : horaires, pause et durée par journée à compléter');
    const store = getStore();
    if (initial.id) {
      const cur = store.get('acOffers', initial.id)!;
      if (cur.priceCents !== terms.priceCents && !(await ui.confirm(`Passer « ${cur.title} » de ${euros(cur.priceCents)} à ${euros(terms.priceCents)} ? Les inscriptions déjà enregistrées gardent l’ancien tarif.`, { ok: 'Modifier le tarif' }))) return;
      updateOfferTerms(store, initial.id, { ...terms, title: d.title.trim(), active: d.active });
      // la modalité n'est écrite que si elle change : une offre existante reste exactement telle quelle sinon
      store.update('acOffers', initial.id, { type: d.type, format: d.format, ...(d.modality !== modalityOf(cur) ? { modality: d.modality } : {}) });
    } else {
      const order = Math.max(-1, ...store.list('acOffers').map((o) => o.order)) + 1;
      const clean = Object.fromEntries(Object.entries(terms).filter(([, v]) => v !== undefined)) as unknown as AcOfferTerms;
      store.create('acOffers', { ...clean, modality: d.modality, title: d.title.trim(), code: `offre-${Date.now().toString(36)}`, type: d.type, format: d.format, active: d.active, order, version: 1, history: [] });
    }
    ui.toast('Offre enregistrée');
    onClose();
  };
  return (
    <Sheet title={initial.id ? 'Offre' : 'Nouvelle offre'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid">
        <div className="field"><label>Intitulé</label><input className="input" value={d.title} onChange={(e) => set({ title: e.target.value })} /></div>
        <div className="ac-two">
          <div className="field"><label>Type</label>
            <select className="input" value={d.type} onChange={(e) => {
              const type = e.target.value as AcTrainingType;
              // une nouvelle offre d'un type « en ligne » passe en modalité En ligne (modifiable)
              set({ type, ...(!initial.id && ONLINE_TYPES.includes(type) ? { modality: 'online' as AcModality } : {}) });
            }}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div className="field"><label>Modalité</label>
            <select className="input" value={d.modality} onChange={(e) => set({ modality: e.target.value as AcModality })}>
              {Object.entries(MODALITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
        </div>
        <div className="ac-two">
          <div className="field"><label>Format</label>
            <select className="input" value={d.format} onChange={(e) => set({ format: e.target.value as AcFormat })}>
              {Object.entries(FORMAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div className="field"><label>Tarif par stagiaire (€)</label><input className="input" inputMode="decimal" value={d.price} onChange={(e) => set({ price: e.target.value })} /></div>
        </div>
        {onsite && (
          <>
            <div className="section-title">Présentiel</div>
            <div className="ac-two">
              <div className="field"><label>Stagiaires par session</label><input className="input" inputMode="numeric" value={d.capacity} onChange={(e) => set({ capacity: e.target.value })} /></div>
              <div className="field"><label>Nombre de journées</label><input className="input" inputMode="numeric" value={d.days} onChange={(e) => set({ days: e.target.value })} /></div>
            </div>
            <div className="ac-two">
              <div className="field"><label>Début</label><input className="input" type="time" value={d.startTime} onChange={(e) => set({ startTime: e.target.value })} /></div>
              <div className="field"><label>Fin</label><input className="input" type="time" value={d.endTime} onChange={(e) => set({ endTime: e.target.value })} /></div>
            </div>
            <div className="ac-two">
              <div className="field"><label>Pause déjeuner (min)</label><input className="input" inputMode="numeric" value={d.lunchMin} onChange={(e) => set({ lunchMin: e.target.value })} /></div>
              <div className="field"><label>Durée pédagogique par journée (min)</label><input className="input" inputMode="numeric" value={d.pedagogicalMinPerDay} onChange={(e) => set({ pedagogicalMinPerDay: e.target.value })} /></div>
            </div>
            {terms.pedagogicalMinPerDay !== undefined && <span className="tiny faint">{hours(terms.pedagogicalMinPerDay)} par jour</span>}
            {warn && <div className="banner small">{warn}</div>}
          </>
        )}
        {online && (
          <>
            <div className="section-title">En ligne</div>
            <p className="tiny faint" style={{ margin: 0 }}>Aucune journée ni session présentielle n’est nécessaire. Tous ces champs sont facultatifs.</p>
            <div className="ac-two">
              <div className="field"><label>Durée d’accès (jours)</label><input className="input" inputMode="numeric" placeholder="vide = sans limite" value={d.accessDays} onChange={(e) => set({ accessDays: e.target.value })} /></div>
              <div className="field"><label>Nombre de leçons</label><input className="input" inputMode="numeric" value={d.lessons} onChange={(e) => set({ lessons: e.target.value })} /></div>
            </div>
            <div className="ac-two">
              <div className="field"><label>Durée totale estimée (min)</label><input className="input" inputMode="numeric" value={d.onlineMinutes} onChange={(e) => set({ onlineMinutes: e.target.value })} /></div>
              <div className="field"><label>Plateforme</label><input className="input" placeholder="à choisir plus tard" value={d.platform} onChange={(e) => set({ platform: e.target.value })} /></div>
            </div>
          </>
        )}
        {total !== undefined && <span className="tiny faint">Durée pédagogique totale : {hours(total)}</span>}
        <label className="row small"><input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} /> Offre proposée (décocher pour la retirer du catalogue sans la supprimer)</label>
        {!!initial.history?.length && (
          <div>
            <div className="section-title">Versions précédentes</div>
            {[...initial.history].reverse().map((h) => (
              <div key={h.version} className="tiny faint">v{h.version} · {euros(h.priceCents)} · {termsSummary({ ...h, modality: initial.modality })} · jusqu’au {new Date(h.validUntil).toLocaleDateString('fr-FR')}</div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function TrainersSection() {
  const state = useData();
  const [edit, setEdit] = useState<Partial<AcTrainer> | null>(null);
  const list = Object.values(state.acTrainers).filter((t) => !t.deleted).sort((a, b) => a.order - b.order);
  return (
    <div className="card">
      <div className="card-head"><h3>Formatrices</h3><button className="btn small" onClick={() => setEdit({ active: true })}><IconPlus size={14} /> Formatrice</button></div>
      <div className="ac-list">
        {list.map((t) => (
          <button key={t.id} className={`ac-row ${t.active ? '' : 'off'}`} onClick={() => setEdit(t)}>
            <span className="ac-row-main"><span className="ac-row-title">{t.name || 'Nom à compléter'}</span>{t.email && <span className="tiny faint">{t.email}</span>}</span>
            <span className="ac-row-side">{t.isDefault && <span className="tag ok">Par défaut</span>}{!t.active && <span className="tag">Inactive</span>}</span>
          </button>
        ))}
      </div>
      {edit && <PersonEditor kind="acTrainers" initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function VenuesSection() {
  const state = useData();
  const [edit, setEdit] = useState<Partial<AcVenue> | null>(null);
  const list = Object.values(state.acVenues).filter((v) => !v.deleted).sort((a, b) => a.order - b.order);
  return (
    <div className="card">
      <div className="card-head"><h3>Lieux de formation</h3><button className="btn small" onClick={() => setEdit({ active: true })}><IconPlus size={14} /> Lieu</button></div>
      <div className="ac-list">
        {list.map((v) => (
          <button key={v.id} className={`ac-row ${v.active ? '' : 'off'}`} onClick={() => setEdit(v)}>
            <span className="ac-row-main"><span className="ac-row-title">{v.name}</span><span className="tiny faint">{v.address || 'Adresse à compléter'}{v.maxTrainees ? ` · ${v.maxTrainees} stagiaires max.` : ''}</span></span>
            <span className="ac-row-side">{v.isDefault && <span className="tag ok">Par défaut</span>}{!v.active && <span className="tag">Inactif</span>}</span>
          </button>
        ))}
      </div>
      {edit && <PersonEditor kind="acVenues" initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

/** Éditeur commun formatrice / lieu (jamais de suppression : on désactive). */
function PersonEditor({ kind, initial, onClose }: { kind: 'acTrainers' | 'acVenues'; initial: Partial<AcTrainer & AcVenue>; onClose: () => void }) {
  const ui = useUI();
  const [d, setD] = useState<Partial<AcTrainer & AcVenue>>(initial);
  const set = (p: Partial<AcTrainer & AcVenue>) => setD((x) => ({ ...x, ...p }));
  const venue = kind === 'acVenues';
  const save = () => {
    const store = getStore();
    const name = (d.name ?? '').trim();
    if (venue && !name) return ui.toast('Donnez un nom au lieu');
    const data = venue
      ? { name, address: (d.address ?? '').trim(), maxTrainees: d.maxTrainees || undefined, notes: d.notes?.trim() || undefined, active: d.active ?? true }
      : { name, email: d.email?.trim() || undefined, phone: d.phone?.trim() || undefined, active: d.active ?? true };
    let id = initial.id;
    if (id) store.update(kind, id, data as never);
    else {
      const order = Math.max(-1, ...store.list(kind).map((r) => r.order)) + 1;
      id = store.create(kind, { ...data, order } as never).id;
    }
    if (d.isDefault && !initial.isDefault) setDefault(store, kind, id!);
    ui.toast('Enregistré');
    onClose();
  };
  return (
    <Sheet title={venue ? (initial.id ? 'Lieu' : 'Nouveau lieu') : (initial.id ? 'Formatrice' : 'Nouvelle formatrice')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid">
        <div className="field"><label>{venue ? 'Nom du lieu' : 'Prénom et nom'}</label><input className="input" value={d.name ?? ''} onChange={(e) => set({ name: e.target.value })} /></div>
        {venue ? <>
          <div className="field"><label>Adresse</label><textarea className="input" rows={2} value={d.address ?? ''} onChange={(e) => set({ address: e.target.value })} /></div>
          <div className="field"><label>Capacité d’accueil (stagiaires en même temps, facultatif)</label><input className="input" inputMode="numeric" value={d.maxTrainees ?? ''} onChange={(e) => set({ maxTrainees: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : undefined })} /></div>
          <div className="field"><label>Notes (accès, stationnement…)</label><textarea className="input" rows={2} value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></div>
        </> : <>
          <div className="field"><label>E-mail (facultatif)</label><input className="input" type="email" value={d.email ?? ''} onChange={(e) => set({ email: e.target.value })} /></div>
          <div className="field"><label>Téléphone (facultatif)</label><input className="input" type="tel" value={d.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} /></div>
        </>}
        <label className="row small"><input type="checkbox" checked={!!d.isDefault} disabled={!!initial.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} /> {venue ? 'Lieu' : 'Formatrice'} sélectionné{venue ? '' : 'e'} par défaut</label>
        <label className="row small"><input type="checkbox" checked={d.active ?? true} onChange={(e) => set({ active: e.target.checked })} /> {venue ? 'Actif' : 'Active'} (décocher plutôt que supprimer)</label>
      </div>
    </Sheet>
  );
}

const IDENTITY_FIELDS: [keyof AcIdentity, string, string?][] = [
  ['legalName', 'Nom et prénom de l’entrepreneur'],
  ['legalForm', 'Forme juridique'],
  ['tradeName', 'Nom commercial'],
  ['trainingBrand', 'Nom de l’activité de formation'],
  ['siret', 'SIRET'],
  ['nda', 'Numéro de déclaration d’activité (NDA)'],
  ['address', 'Adresse administrative'],
  ['email', 'E-mail professionnel'],
  ['phone', 'Téléphone professionnel'],
  ['vatRegime', 'Régime de TVA', 'à confirmer avec votre comptable'],
  ['mediator', 'Médiateur de la consommation'],
];

function IdentitySection() {
  const state = useData();
  const ui = useUI();
  const rec = state.acSettings[AC_SETTINGS_ID];
  const [d, setD] = useState<AcIdentity>(rec?.identity ?? {});
  const dirty = JSON.stringify(d) !== JSON.stringify(rec?.identity ?? {});
  const save = () => {
    const identity = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, (v as string)?.trim() || undefined]).filter(([, v]) => v)) as AcIdentity;
    getStore().update('acSettings', AC_SETTINGS_ID, { identity });
    setD(identity);
    ui.toast('Identité administrative enregistrée');
  };
  if (!rec) return null;
  return (
    <div className="card">
      <div className="card-head"><h3>Identité administrative</h3></div>
      <p className="tiny faint" style={{ marginTop: 0 }}>Utilisée plus tard sur les programmes, contrats et attestations. Laissez vide ce que vous n’avez pas encore : rien ne sera inventé.</p>
      <div className="grid">
        {IDENTITY_FIELDS.map(([k, label, ph]) => (
          <div className="field" key={k}><label>{label}</label><input className="input" placeholder={ph} value={d[k] ?? ''} onChange={(e) => setD((x) => ({ ...x, [k]: e.target.value }))} /></div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
        <button className="btn primary" disabled={!dirty} onClick={save}>Enregistrer</button>
      </div>
    </div>
  );
}
