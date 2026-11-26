import { describe, expect, it } from 'vitest';
import { freshStore } from './helpers';
import { produceExport, runExport, type ExportEnv } from '../src/data/exportFlow';
import { validateExport } from '../src/data/sync';

const abort = () => Object.assign(new Error('Share canceled'), { name: 'AbortError' });

function env(over: Partial<ExportEnv> = {}) {
  const calls = { shared: [] as File[], downloaded: [] as string[] };
  const e: ExportEnv = {
    touch: false,
    canShare: () => true,
    share: async (d) => { calls.shared.push(...d.files); },
    download: (_b, name) => { calls.downloaded.push(name); },
    ...over,
  };
  return { e, calls };
}
function fakeUI(answer: boolean) {
  const log = { confirms: [] as { text: string; opts?: any }[], toasts: [] as string[] };
  return { log, ui: { confirm: async (text: string, opts?: any) => { log.confirms.push({ text, opts }); return answer; }, toast: (t: string) => { log.toasts.push(t); } } };
}

describe('export : fenêtre de partage, échec, confirmation', () => {
  it('iPhone : passe par la fenêtre de partage, avec un fichier complet et restaurable', async () => {
    const { store } = await freshStore();
    const { e, calls } = env({ touch: true });
    const r = await produceExport(e, store);
    expect(r.kind).toBe('shared');
    expect(calls.downloaded).toEqual([]);
    const f = calls.shared[0];
    expect(f.name).toMatch(/^lx-planner-sauvegarde-\d{4}-\d{2}-\d{2}\.json$/);
    const json = JSON.parse(await f.text());
    expect(validateExport(json)).toBe(true);
    expect(json.data).toEqual(JSON.parse(JSON.stringify(store.state))); // tout le contenu, rien de plus, rien de moins
  });

  it('iPhone : « Annuler » dans la fenêtre de partage → annulé, rien n’est noté', async () => {
    const { store } = await freshStore();
    const { e } = env({ touch: true, share: async () => { throw abort(); } });
    const { ui, log } = fakeUI(true);
    const r = await runExport(ui, e, store);
    expect(r.kind).toBe('cancelled');
    expect(r.recorded).toBe(false);
    expect(log.confirms).toEqual([]);
    expect(store.settings.lastExportAt).toBeUndefined();
  });

  it('partage refusé par le navigateur → téléchargement classique à la place', async () => {
    const { store } = await freshStore();
    const { e, calls } = env({ touch: true, share: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } });
    expect((await produceExport(e, store)).kind).toBe('downloaded');
    expect(calls.downloaded.length).toBe(1);
  });

  it('ordinateur : téléchargement, pas de fenêtre de partage', async () => {
    const { store } = await freshStore();
    const { e, calls } = env({ touch: false });
    expect((await produceExport(e, store)).kind).toBe('downloaded');
    expect(calls.shared).toEqual([]);
  });

  it('la date n’est notée que si l’utilisatrice confirme « Oui, il est enregistré »', async () => {
    const { store } = await freshStore();
    const no = fakeUI(false);
    expect((await runExport(no.ui, env({ touch: true }).e, store)).recorded).toBe(false);
    expect(store.settings.lastExportAt).toBeUndefined();
    const yes = fakeUI(true);
    const r = await runExport(yes.ui, env({ touch: true }).e, store);
    expect(r.recorded).toBe(true);
    expect(store.settings.lastExportAt).toBe((r as any).exportedAt);
  });

  it('échec du téléchargement → message clair, date inchangée, données intactes', async () => {
    const { store } = await freshStore();
    const before = JSON.stringify(store.state);
    const { e } = env({ download: () => { throw new Error('disque plein'); } });
    const { ui, log } = fakeUI(true);
    const r = await runExport(ui, e, store);
    expect(r.kind).toBe('failed');
    expect(r.recorded).toBe(false);
    expect(log.confirms[0].opts.title).toBe('Export impossible');
    expect(log.confirms[0].text).toContain('disque plein');
    expect(log.confirms[0].opts.cancel).toBe('');
    expect(store.settings.lastExportAt).toBeUndefined();
    expect(JSON.stringify(store.state)).toBe(before);
  });

  it('« Plus tard » effacé par un export confirmé', async () => {
    const { store } = await freshStore();
    store.update('settings', store.settings.id, { exportReminderSnoozedUntil: '2099-01-01T00:00:00.000Z' });
    await runExport(fakeUI(true).ui, env().e, store);
    expect(store.settings.exportReminderSnoozedUntil).toBeUndefined();
  });
});
