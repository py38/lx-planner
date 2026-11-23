import { useMemo, useState } from 'react';
import { useData } from '../data/store';
import { useUI } from '../ui/UI';
import { Empty } from '../ui/kit';
import { createItem } from '../data/actions';
import { parseBookingText, type ParsedBooking } from '../logic/ocrParse';
import { findDuplicates } from '../logic/duplicates';
import { fmtDuration, fmtLong, fmtTime } from '../lib/date';
import { go } from '../lib/router';
import { IconCamera, IconCheck } from '../ui/Icons';
import type { Item } from '../data/types';

interface Job {
  key: string;
  name: string;
  url?: string;
  status: 'reading' | 'ready' | 'added' | 'error' | 'skipped';
  progress: number;
  text?: string;
  parsed?: ParsedBooking;
  form: { date: string; start: string; duration: number; client: string; service: string; notes: string; confirmed: boolean };
  error?: string;
}

const emptyForm = (p?: ParsedBooking): Job['form'] => ({
  date: p?.date ?? '', start: p?.start ?? '', duration: p?.duration ?? 90, client: p?.client ?? '', service: p?.service ?? '', notes: p?.extra ?? '', confirmed: true,
});

/** Lecture de texte d'une image, entièrement dans le navigateur (Tesseract.js, gratuit). */
async function ocr(file: Blob, onProgress: (p: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('fra', 1, { logger: (m: any) => m.status === 'recognizing text' && onProgress(m.progress) });
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

export function ImportView() {
  const state = useData();
  const ui = useUI();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pasted, setPasted] = useState('');
  const clientCat = Object.values(state.categories).find((c) => c.name === 'Rendez-vous clientes' && !c.deleted);

  const patch = (key: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...p } : j)));
  const patchForm = (key: string, f: Partial<Job['form']>) => setJobs((js) => js.map((j) => (j.key === key ? { ...j, form: { ...j.form, ...f } } : j)));

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      const url = URL.createObjectURL(file);
      setJobs((js) => [{ key, name: file.name, url, status: 'reading', progress: 0, form: emptyForm() }, ...js]);
      try {
        const text = await ocr(file, (p) => patch(key, { progress: p }));
        const parsed = parseBookingText(text);
        patch(key, { status: 'ready', text, parsed, form: emptyForm(parsed) });
      } catch (e: any) {
        patch(key, { status: 'error', error: `Lecture impossible (${e?.message ?? e}). Vérifiez la connexion internet au premier usage, ou collez le texte ci-dessous.` });
      }
    }
  };

  const fromText = () => {
    if (!pasted.trim()) return;
    const parsed = parseBookingText(pasted);
    setJobs((js) => [{ key: `txt-${Date.now()}`, name: 'Texte collé', status: 'ready', progress: 1, text: pasted, parsed, form: emptyForm(parsed) }, ...js]);
    setPasted('');
  };

  const add = async (j: Job) => {
    const f = j.form;
    if (!f.date) { ui.toast('Indiquez la date du rendez-vous'); return; }
    if (!(await ui.checkSunday(f.date, clientCat?.id))) return;
    const title = [f.service || 'Rendez-vous', f.client].filter(Boolean).join(' — ');
    const it = createItem({
      kind: 'appointment', title, date: f.date, start: f.start || undefined, duration: f.duration || undefined, client: f.client || undefined,
      service: f.service || undefined, notes: f.notes || undefined, confirmed: f.confirmed, categoryId: clientCat?.id, priority: 'must',
    }) as Item;
    patch(j.key, { status: 'added' });
    ui.toast('Rendez-vous ajouté', { label: 'Voir', run: () => go(`jour/${it.date}`) });
  };

  return (
    <div>
      <div className="page-head">
        <div className="title-block"><div className="eyebrow">Rendez-vous clientes</div><h1>Importer une capture</h1></div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <label className="btn primary" style={{ cursor: 'pointer' }}>
          <IconCamera size={18} /> Choisir une ou plusieurs captures
          <input type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
        </label>
        <p className="small muted" style={{ marginBottom: 0 }}>
          La lecture se fait sur votre appareil (gratuit, aucune image envoyée à un service tiers). Au premier usage, le module de lecture (~10 Mo) est téléchargé.
          Les informations détectées sont toujours affichées pour vérification : rien n’est ajouté sans votre confirmation.
        </p>
        <div className="divider" />
        <div className="field">
          <label>Ou collez le texte d’une confirmation (SMS, mail, Planity…)</label>
          <textarea className="input" style={{ minHeight: 70 }} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Ex : Sarah Martin — Pose gel, samedi 28 novembre à 9h30 (1h30)" />
        </div>
        <button className="btn" style={{ marginTop: 8 }} onClick={fromText} disabled={!pasted.trim()}>Analyser le texte</button>
      </div>

      {!jobs.length && <Empty>Aucune capture en cours.</Empty>}
      {jobs.map((j) => <JobCard key={j.key} job={j} onForm={(f) => patchForm(j.key, f)} onAdd={() => add(j)} onSkip={() => patch(j.key, { status: 'skipped' })} />)}
    </div>
  );
}

function JobCard({ job: j, onForm, onAdd, onSkip }: { job: Job; onForm: (f: Partial<Job['form']>) => void; onAdd: () => void; onSkip: () => void }) {
  const state = useData();
  const ui = useUI();
  const dups = useMemo(() => (j.status === 'ready' ? findDuplicates(state, { date: j.form.date, start: j.form.start, client: j.form.client }) : []), [state, j.status, j.form.date, j.form.start, j.form.client]);
  const [showText, setShowText] = useState(false);
  const c = j.parsed?.confidence;
  const flag = (ok?: boolean) => (j.parsed ? (ok ? <span className="tag ok">détecté</span> : <span className="tag warn">à vérifier</span>) : null);

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <b className="small">{j.name}</b>
        {j.status === 'reading' && <span className="small muted">Lecture… {Math.round(j.progress * 100)} %</span>}
        {j.status === 'added' && <span className="tag ok"><IconCheck size={12} /> Ajouté</span>}
        {j.status === 'skipped' && <span className="tag">Ignoré</span>}
      </div>
      {j.status === 'error' && <div className="banner danger">{j.error}</div>}
      {j.status === 'ready' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          {j.url && <img src={j.url} alt="Capture importée" className="img-preview" />}
          <div className="col" style={{ gap: 10 }}>
            <div className="form-grid">
              <div className="field"><label>Date {flag(c?.date)}</label><input className="input" type="date" value={j.form.date} onChange={(e) => onForm({ date: e.target.value })} /></div>
              <div className="field"><label>Heure {flag(c?.start)}</label><input className="input" type="time" step={300} value={j.form.start} onChange={(e) => onForm({ start: e.target.value })} /></div>
              <div className="field"><label>Durée (min) {flag(c?.duration)}</label><input className="input" type="number" min={0} step={15} value={j.form.duration} onChange={(e) => onForm({ duration: +e.target.value })} /></div>
              <div className="field"><label>Cliente {flag(c?.client)}</label><input className="input" value={j.form.client} onChange={(e) => onForm({ client: e.target.value })} /></div>
              <div className="field full"><label>Prestation {flag(c?.service)}</label><input className="input" value={j.form.service} onChange={(e) => onForm({ service: e.target.value })} /></div>
              <div className="field full"><label>Informations complémentaires</label><input className="input" value={j.form.notes} onChange={(e) => onForm({ notes: e.target.value })} /></div>
              <label className="check full"><input type="checkbox" checked={j.form.confirmed} onChange={(e) => onForm({ confirmed: e.target.checked })} /> Rendez-vous confirmé</label>
            </div>
            {j.form.date && <div className="small muted">{fmtLong(j.form.date)}{j.form.start ? ` à ${fmtTime(j.form.start)}` : ''}{j.form.duration ? ` · ${fmtDuration(j.form.duration)}` : ''}</div>}
            {dups.length > 0 && (
              <div className="banner danger" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <b>Doublon possible</b>
                {dups.map((d) => <span key={d.item.id} className="small" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => ui.openItem(d.item.id)}>{d.reason} : « {d.item.title} »{d.item.start ? ` à ${fmtTime(d.item.start)}` : ''}</span>)}
              </div>
            )}
            <div className="row wrap">
              <button className="btn primary" onClick={onAdd}>{dups.length ? 'Ajouter quand même' : 'Confirmer et ajouter'}</button>
              <button className="btn" onClick={onSkip}>Ignorer</button>
              {j.text && <button className="btn ghost small" onClick={() => setShowText((s) => !s)}>{showText ? 'Masquer' : 'Voir'} le texte lu</button>}
            </div>
            {showText && <div className="pre">{j.text}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

