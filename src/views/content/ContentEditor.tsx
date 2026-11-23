import { useState } from 'react';
import { getStore } from '../../data/store';
import { useUI } from '../../ui/UI';
import { Sheet, Seg } from '../../ui/kit';
import { Cover, CropEditor } from '../../ui/Cover';
import { pickImages, saveMedia } from '../../data/media';
import { CHECK_LABEL, FORMAT_LABEL, GOAL_LABEL, PILLAR_LABEL, PLATFORM_LABEL, checksFor, contentProgress } from '../../logic/contentPlan';
import { IconCamera, IconTrash } from '../../ui/Icons';
import type { ContentFormat, ContentGoal, ContentPiece, ContentPillar, Platform } from '../../data/types';

export type ContentDraft = Partial<ContentPiece>;

export const blankContent = (d: ContentDraft = {}): ContentDraft => ({ format: 'reel', platforms: ['instagram'], checks: {}, ...d });

/** Coche / décoche une étape d'un contenu. */
export function toggleCheck(p: ContentPiece, c: keyof ContentPiece['checks']) {
  getStore().update('contents', p.id, { checks: { ...p.checks, [c]: !p.checks[c] } });
}

export function ContentEditor({ value, onClose }: { value: ContentDraft; onClose: () => void }) {
  const ui = useUI();
  const [c, setC] = useState<ContentDraft>(value);
  const [crop, setCrop] = useState(false);
  const isNew = !c.id;
  const set = <K extends keyof ContentPiece>(k: K, v: ContentPiece[K] | undefined) => setC((x) => ({ ...x, [k]: v }));

  const save = () => {
    if (!c.title?.trim()) { ui.toast('Ajoutez un titre'); return; }
    const data = { ...c, title: c.title.trim() } as ContentPiece;
    if (isNew) getStore().create('contents', data);
    else getStore().update('contents', c.id!, data);
    ui.toast(isNew ? (data.shootDate || data.publishDate ? 'Ajouté au calendrier de contenu' : 'Idée ajoutée à la banque') : 'Enregistré');
    onClose();
  };
  const remove = async () => {
    if (!(await ui.confirm(`Supprimer « ${c.title} » du calendrier de contenu ?`, { ok: 'Supprimer', danger: true }))) return;
    getStore().remove('contents', c.id!);
    onClose();
  };
  const upload = async () => {
    const [f] = await pickImages(false);
    if (!f) return;
    const id = await saveMedia(f);
    setC((x) => ({ ...x, coverMediaId: id, coverCrop: undefined, checks: { ...(x.checks ?? {}), cover: true } }));
  };

  const checks = checksFor({ format: c.format ?? 'reel', platforms: c.platforms ?? [] });
  const prog = c.id ? contentProgress({ ...(c as ContentPiece) }) : null;
  const togglePlatform = (p: Platform) => set('platforms', (c.platforms ?? []).includes(p) ? (c.platforms ?? []).filter((x) => x !== p) : [...(c.platforms ?? []), p]);

  return (
    <Sheet wide title={!c.shootDate && !c.publishDate ? (isNew ? 'Nouvelle idée de contenu' : 'Idée de contenu') : isNew ? 'Nouveau contenu' : 'Contenu'} onClose={onClose} footer={<>
      {!isNew && <button className="btn ghost danger" style={{ marginRight: 'auto' }} onClick={remove}><IconTrash size={16} /> Supprimer</button>}
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn primary" onClick={save}>{isNew ? 'Ajouter' : 'Enregistrer'}</button>
    </>}>
      <div className="content-editor">
        <div className="col" style={{ gap: 14 }}>
          <input className="input title-input" autoFocus={isNew} placeholder="Sujet du contenu" value={c.title ?? ''} onChange={(e) => set('title', e.target.value)} />

          <div className="field"><label>Format</label>
            <Seg value={(c.format ?? 'reel') as ContentFormat} onChange={(v) => set('format', v)} options={(Object.keys(FORMAT_LABEL) as ContentFormat[]).map((k) => ({ value: k, label: FORMAT_LABEL[k] }))} />
          </div>
          <div className="field"><label>Objectif</label>
            <div className="chips">{(Object.keys(GOAL_LABEL) as ContentGoal[]).map((k) => <button key={k} className={`chip ${c.goal === k ? 'on' : ''}`} onClick={() => set('goal', c.goal === k ? undefined : k)}>{GOAL_LABEL[k]}</button>)}</div>
          </div>
          <div className="field"><label>Pilier de contenu</label>
            <div className="chips">{(Object.keys(PILLAR_LABEL) as ContentPillar[]).map((k) => <button key={k} className={`chip ${c.pillar === k ? 'on' : ''}`} onClick={() => set('pillar', c.pillar === k ? undefined : k)}>{PILLAR_LABEL[k]}</button>)}</div>
          </div>
          <div className="field"><label>Où publier</label>
            <div className="chips">{(Object.keys(PLATFORM_LABEL) as Platform[]).map((k) => <button key={k} className={`chip ${(c.platforms ?? []).includes(k) ? 'on' : ''}`} onClick={() => togglePlatform(k)}>{PLATFORM_LABEL[k]}</button>)}</div>
          </div>
          <div className="field"><label>Mots-clés (séparés par des virgules)</label>
            <input className="input" placeholder="Ex : Formation en ligne, Pré-lancement" value={(c.tags ?? []).join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))} />
          </div>
          <div className="form-grid">
            <div className="field"><label>Jour de tournage</label><input className="input" type="date" value={c.shootDate ?? ''} onChange={(e) => set('shootDate', e.target.value || undefined)} /></div>
            <div className="field"><label>Date de publication</label><input className="input" type="date" value={c.publishDate ?? ''} onChange={(e) => set('publishDate', e.target.value || undefined)} /></div>
            <div className="field"><label>Heure de publication</label><input className="input" type="time" value={c.publishTime ?? ''} onChange={(e) => set('publishTime', e.target.value || undefined)} /></div>
            <div className="full tiny faint">Sans date, la fiche reste dans la Banque d’idées. Avec une date, elle apparaît dans le calendrier de contenu.</div>
          </div>
          <div className={`red-alert-box ${c.redAlert ? 'on' : ''}`}>
            <label className="check">
              <input type="checkbox" checked={!!c.redAlert} onChange={(e) => set('redAlert', e.target.checked || undefined)} />
              <span><b>🔴 Alerte rouge</b> — contenu à ne pas oublier (collab, marque, lancement…)</span>
            </label>
            {c.redAlert && (
              <div className="row wrap small" style={{ gap: 6, marginTop: 6, paddingLeft: 28 }}>
                Passe en rouge
                <input className="input" type="number" min={1} max={30} style={{ width: 64, minHeight: 32, padding: '2px 8px', fontSize: 14 }}
                  value={c.redAlertDays ?? 3} onChange={(e) => set('redAlertDays', Math.max(1, Math.min(30, +e.target.value || 3)))} />
                jour(s) avant la publication s’il n’est pas encore tourné et monté.
              </div>
            )}
          </div>

          <div className="field"><label>Accroche</label><textarea className="input" style={{ minHeight: 60 }} placeholder="Les 3 premières secondes…" value={c.hook ?? ''} onChange={(e) => set('hook', e.target.value || undefined)} /></div>
          <div className="field"><label>Corps du script</label><textarea className="input" style={{ minHeight: 180 }} value={c.script ?? ''} onChange={(e) => set('script', e.target.value || undefined)} /></div>
          <div className="field"><label>Call to action (CTA)</label><textarea className="input" style={{ minHeight: 50 }} placeholder="Ex : Dis-moi en commentaire…" value={c.cta ?? ''} onChange={(e) => set('cta', e.target.value || undefined)} /></div>
          <div className="field"><label>Légende <span className="faint">· {(c.caption ?? '').length}/2200</span></label><textarea className="input" style={{ minHeight: 120 }} value={c.caption ?? ''} onChange={(e) => set('caption', e.target.value || undefined)} /></div>
          <div className="field"><label>Notes (plans, matériel, idées de B-roll…)</label><textarea className="input" style={{ minHeight: 60 }} value={c.notes ?? ''} onChange={(e) => set('notes', e.target.value || undefined)} /></div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="field">
            <label>Couverture</label>
            <div style={{ maxWidth: 220 }}>
              <Cover mediaId={c.coverMediaId} crop={c.coverCrop} aspect="3:4" placeholder={<button className="btn small" onClick={upload}><IconCamera size={14} /> Ajouter</button>} />
            </div>
            <div className="row wrap" style={{ marginTop: 6 }}>
              <button className="btn small" onClick={upload}>{c.coverMediaId ? 'Remplacer' : 'Importer une image'}</button>
              {c.coverMediaId && <button className="btn small" onClick={() => setCrop(true)}>Recadrer</button>}
              {c.coverMediaId && <button className="btn small ghost" onClick={() => setC((x) => ({ ...x, coverMediaId: undefined, coverCrop: undefined }))}>Retirer</button>}
            </div>
          </div>
          <div className="field">
            <label>Avancement {prog ? `· ${prog.done}/${prog.total}` : ''}</label>
            <div className="col" style={{ gap: 4 }}>
              {checks.map((k) => (
                <label key={k} className="check" style={{ padding: '4px 0' }}>
                  <input type="checkbox" checked={!!c.checks?.[k]} onChange={() => set('checks', { ...(c.checks ?? {}), [k]: !c.checks?.[k] })} /> {CHECK_LABEL[k]}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
      {crop && c.coverMediaId && <CropEditor mediaId={c.coverMediaId} crop={c.coverCrop} aspect="3:4" onSave={(cr) => set('coverCrop', cr)} onClose={() => setCrop(false)} />}
    </Sheet>
  );
}
