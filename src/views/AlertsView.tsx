import { useMemo } from 'react';
import { getStore, useData } from '../data/store';
import { useUI } from '../ui/UI';
import { Empty } from '../ui/kit';
import { ItemRow } from '../ui/ItemRow';
import { PendingList } from '../ui/PendingList';
import { computeAlerts } from '../logic/alerts';
import { ackReminder, describeReminder, disableReminder, snoozeReminder } from '../logic/reminders';
import { go, href } from '../lib/router';
import { CHECK_LABEL } from '../logic/contentPlan';
import { fmtShort } from '../lib/date';

export function AlertsView() {
  const state = useData();
  const ui = useUI();
  const a = useMemo(() => computeAlerts(state, getStore().settings), [state]);
  const nothing = !a.reminders.length && !a.overdue.length && !a.content.length && !a.contentPrep.length && !a.projects.length && !a.unvalidated.length;
  return (
    <div>
      <div className="page-head"><div className="title-block"><div className="eyebrow">Alertes</div><h1>Rappels & échéances</h1></div></div>
      {nothing && <Empty>Rien à signaler. Tout est sous contrôle.</Empty>}

      {a.reminders.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Rappels</h3></div>
          {a.reminders.map(({ item, reminder, at }) => (
            <div key={item.id + reminder.id} style={{ marginBottom: 12 }}>
              <ItemRow item={item} showDate />
              <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
                <span className="tiny faint">{describeReminder(reminder)} · {at.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <button className="chip" onClick={() => { ackReminder(item.id, reminder.id); ui.toast('Rappel validé'); }}>Vu</button>
                <button className="chip" onClick={() => { snoozeReminder(item.id, reminder.id, 60); ui.toast('Reporté d’une heure'); }}>+1 h</button>
                <button className="chip" onClick={() => { snoozeReminder(item.id, reminder.id, 24 * 60); ui.toast('Reporté à demain'); }}>+1 jour</button>
                <button className="chip" onClick={() => { disableReminder(item.id, reminder.id); ui.toast('Rappel désactivé'); }}>Désactiver</button>
                <button className="chip" onClick={() => ui.openItem(item.id)}>Modifier l’échéance</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {a.overdue.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Échéances dépassées</h3></div>
          <p className="small muted" style={{ marginTop: 0 }}>Ces tâches devaient être terminées avant leur échéance. Reportez-les, terminez-les ou supprimez-les.</p>
          <PendingList items={a.overdue} />
        </div>
      )}

      {a.content.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Contenus à préparer</h3></div>
          {a.content.map((c) => (
            <div key={c.project.id} style={{ padding: '8px 0', cursor: 'pointer', borderBottom: '1px solid var(--line)' }} onClick={() => go(`projets/${c.project.id}`)}>
              <b>{c.project.title}</b> <span className="tag warn">publication {c.daysLeft === 0 ? "aujourd'hui" : `dans ${c.daysLeft} j`}</span>
              <div className="small muted">Reste : {c.pending.map((s) => `${s.title.split(' — ')[0]}${s.date ? ` (${fmtShort(s.date)})` : ''}`).join(' · ')}</div>
            </div>
          ))}
        </div>
      )}

      {a.contentPrep.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Contenus à préparer</h3></div>
          {a.contentPrep.map(({ piece, daysLeft, missing }) => (
            <a key={piece.id} href={href(piece.shootDate ? `contenu/tournage/${piece.shootDate}` : 'contenu')} style={{ display: 'block', padding: '8px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none' }}>
              <b>{piece.title}</b> <span className="tag warn">publication {daysLeft === 0 ? "aujourd'hui" : `dans ${daysLeft} j`}</span>
              <div className="small muted">Reste : {missing.map((m) => CHECK_LABEL[m].toLowerCase()).join(' · ')}</div>
            </a>
          ))}
        </div>
      )}

      {a.projects.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Projets</h3></div>
          {a.projects.map(({ project, kind, daysLeft }) => (
            <div key={project.id} className="row" style={{ padding: '6px 0', cursor: 'pointer' }} onClick={() => go(`projets/${project.id}`)}>
              <span className="grow">{project.title}</span>
              <span className={`tag ${kind === 'near' ? 'warn' : 'danger'}`}>{kind === 'blocked' ? 'Bloqué' : kind === 'late' ? 'En retard' : `J-${daysLeft}`}</span>
            </div>
          ))}
        </div>
      )}

      {a.unvalidated.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Tâches passées non validées</h3></div>
          <PendingList items={a.unvalidated} />
        </div>
      )}
    </div>
  );
}
