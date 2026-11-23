import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useRoute, href } from './lib/router';
import { getStore, useData, useSaveStatus } from './data/store';
import { getSync } from './data/sync';
import { UIProvider, useUI } from './ui/UI';
import { computeAlerts } from './logic/alerts';
import { notifyDue } from './logic/reminders';
import { today } from './lib/date';
import { DayView } from './views/DayView';
import { WeekView } from './views/WeekView';
import { MonthView } from './views/MonthView';
import { YearView } from './views/YearView';
import { ProjectsView, ProjectDetail } from './views/ProjectsView';
import { HabitsView } from './views/HabitsView';
import { StatsView, WeeklyReviewView } from './views/StatsView';
import { SettingsView } from './views/SettingsView';
import { ImportView } from './views/ImportView';
import { AlertsView } from './views/AlertsView';
import { ContentHub } from './views/content/ContentHub';
import {
  IconMonth, IconInsta, IconProjects, IconHabit, IconStats, IconSettings, IconPlus, IconBell, IconCamera, IconMenu,
} from './ui/Icons';
import { useState } from 'react';

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function Page({ route }: { route: string[] }) {
  const [r0, r1, r2] = route;
  switch (r0) {
    case 'jour': return <DayView date={isDate(r1) ? r1 : today()} />;
    case 'semaine': return r2 === 'bilan' ? <WeeklyReviewView date={isDate(r1) ? r1 : today()} /> : <WeekView date={isDate(r1) ? r1 : today()} />;
    case 'mois': return <MonthView date={isDate(r1) ? r1 : today()} />;
    case 'annee': return <YearView year={r1 && /^\d{4}$/.test(r1) ? +r1 : new Date().getFullYear()} />;
    case 'projets': return r1 ? <ProjectDetail id={r1} /> : <ProjectsView />;
    case 'idees': return <ContentHub route={['contenu', 'idees']} />;
    case 'habitudes': return <HabitsView date={isDate(r1) ? r1 : today()} />;
    case 'bilans': return <StatsView />;
    case 'reglages': return <SettingsView />;
    case 'import': return <ImportView />;
    case 'alertes': return <AlertsView />;
    case 'contenu': return <ContentHub route={route} />;
    default: return <DayView date={today()} />;
  }
}

function SaveIndicator() {
  const save = useSaveStatus();
  const sync = useSyncExternalStore(getSync().subscribe, getSync().getStatus);
  const cls = save.lastError ? 'err' : save.pending > 0 || sync.phase === 'syncing' ? 'pending' : sync.phase === 'error' ? 'err' : '';
  const text = save.lastError ? `Erreur d’enregistrement : ${save.lastError}`
    : save.pending > 0 ? 'Enregistrement…'
    : sync.phase === 'syncing' ? 'Synchronisation…'
    : sync.phase === 'idle' ? 'Enregistré · synchronisé'
    : sync.phase === 'offline' ? 'Enregistré sur l’appareil · hors ligne'
    : sync.phase === 'error' ? 'Enregistré sur l’appareil · synchro en erreur'
    : 'Enregistré sur cet appareil';
  return <a href={href('reglages')} className={`save-indicator ${cls}`} style={{ textDecoration: 'none' }} title={text}><span className="d" />{text}</a>;
}

function Shell() {
  const route = useRoute();
  const state = useData();
  const ui = useUI();
  const [moreOpen, setMoreOpen] = useState(false);
  const alerts = useMemo(() => computeAlerts(state, getStore().settings), [state]);
  const t = today();

  // notifications système (si autorisées) pour les rappels arrivés à échéance
  useEffect(() => {
    const tick = () => getStore().settings?.notificationsEnabled !== false && notifyDue(getStore().state);
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => setMoreOpen(false), [route.join('/')]);

  const nav = [
    { key: 'calendrier', path: `jour/${t}`, label: 'Calendrier', icon: IconMonth },
    { key: 'contenu', path: 'contenu/idees', label: 'Instagram & Contenu', icon: IconInsta },
    { key: 'projets', path: 'projets', label: 'Projets & Objectifs', icon: IconProjects },
    { key: 'habitudes', path: `habitudes/${t}`, label: 'Mes habitudes', icon: IconHabit },
    { key: 'bilans', path: 'bilans', label: 'Bilans & Statistiques', icon: IconStats },
  ];
  const rawCur = route[0] || 'jour';
  // Jour / Semaine / Mois / Année = un seul onglet « Calendrier » (sélecteur en haut de page)
  const cur = ['jour', 'semaine', 'mois', 'annee'].includes(rawCur) ? 'calendrier' : rawCur === 'idees' ? 'contenu' : rawCur;
  const mobileMain = ['calendrier', 'contenu', 'projets', 'habitudes'];
  const short: Record<string, string> = { projets: 'Projets', habitudes: 'Habitudes', idees: 'Idées', contenu: 'Contenu' };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">LX</span> Planner</div>
        {nav.map((n) => (
          <a key={n.key} className={`nav-link ${cur === n.key ? 'active' : ''}`} href={href(n.path)}><n.icon size={18} /> {n.label}</a>
        ))}
        <div className="divider" />
        <a className={`nav-link ${cur === 'alertes' ? 'active' : ''}`} href={href('alertes')}><IconBell size={18} /> Alertes {alerts.count > 0 && <span className="badge">{alerts.count}</span>}</a>
        <a className={`nav-link ${cur === 'import' ? 'active' : ''}`} href={href('import')}><IconCamera size={18} /> Importer un RDV</a>
        <a className={`nav-link ${cur === 'reglages' ? 'active' : ''}`} href={href('reglages')}><IconSettings size={18} /> Réglages</a>
        <div className="spacer" />
        <SaveIndicator />
      </aside>

      <main className="main">
        <div className="hide-desktop row between" style={{ marginBottom: 6 }}>
          <SaveIndicator />
          <a className="icon-btn ghost" href={href('alertes')} aria-label="Alertes" style={{ position: 'relative' }}>
            <IconBell size={20} />{alerts.count > 0 && <span className="badge" style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, fontSize: 10 }}>{alerts.count}</span>}
          </a>
        </div>
        <Page route={route} />
      </main>

      <button className="fab" aria-label="Ajouter" onClick={() => ui.newItem(rawCur === 'jour' && isDate(route[1]) ? { date: route[1] } : rawCur === 'jour' ? { date: t } : {})}><IconPlus size={26} /></button>

      <nav className="bottom-nav" aria-label="Navigation">
        {nav.filter((n) => mobileMain.includes(n.key)).map((n) => (
          <a key={n.key} className={cur === n.key ? 'active' : ''} href={href(n.path)}><n.icon size={22} />{short[n.key] ?? n.label}</a>
        ))}
        <button className={!mobileMain.includes(cur) ? 'active' : ''} onClick={() => setMoreOpen((o) => !o)}><IconMenu size={22} />Plus{alerts.count > 0 && <span className="badge dot" style={{ minWidth: 8, height: 8, padding: 0 }} />}</button>
      </nav>
      {moreOpen && (
        <div className="overlay" onClick={() => setMoreOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-body" style={{ paddingTop: 16 }}>
              {[...nav.filter((n) => !mobileMain.includes(n.key)), { key: 'alertes', path: 'alertes', label: `Alertes${alerts.count ? ` (${alerts.count})` : ''}`, icon: IconBell }, { key: 'import', path: 'import', label: 'Importer un RDV', icon: IconCamera }, { key: 'reglages', path: 'reglages', label: 'Réglages & synchronisation', icon: IconSettings }].map((n) => (
                <a key={n.key} className={`nav-link ${cur === n.key ? 'active' : ''}`} style={{ padding: '13px 12px', fontSize: 16 }} href={href(n.path)}><n.icon size={20} /> {n.label}</a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <UIProvider>
      <Shell />
    </UIProvider>
  );
}
