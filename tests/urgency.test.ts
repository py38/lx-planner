import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { freshStore } from './helpers';
import { contentUrgency, itemUrgency } from '../src/logic/urgency';
import { expandRange } from '../src/logic/recurrence';
import { createItem } from '../src/data/actions';
import type { ContentPiece, Item } from '../src/data/types';
import type { Store } from '../src/data/store';

let store: Store;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T10:00:00'));
  ({ store } = await freshStore());
});
afterEach(() => vi.useRealTimers());
const piece = (p: Partial<ContentPiece>) => store.create('contents', { title: 'x', format: 'reel', platforms: ['instagram'], checks: {}, ...p } as ContentPiece);

describe('Alerte rouge (contenus cochés uniquement)', () => {
  it('Collab Ongle24 : publication le 24, alerte cochée → rouge à J-3 si pas tourné et monté', () => {
    const c = piece({ title: 'Collab Ongle24', shootDate: '2026-11-23', publishDate: '2026-11-24', redAlert: true });
    expect(contentUrgency(c, '2026-11-20').any).toBeUndefined(); // J-4 : pas encore
    expect(contentUrgency(c, '2026-11-21')).toMatchObject({ publish: 'soon', shoot: 'soon', daysLeft: 3 }); // J-3
    expect(contentUrgency({ ...c, checks: { shot: true } }, '2026-11-22').publish).toBe('soon'); // tourné mais pas monté
    expect(contentUrgency({ ...c, checks: { shot: true, edited: true } }, '2026-11-22').any).toBeUndefined(); // tourné ET monté
    expect(contentUrgency(c, '2026-11-25').publish).toBe('late'); // date dépassée, pas publié
    expect(contentUrgency({ ...c, checks: { posted_instagram: true } }, '2026-11-25').any).toBeUndefined(); // publié
  });
  it('sans la case cochée, jamais de rouge', () => {
    const c = piece({ shootDate: '2026-11-21', publishDate: '2026-11-22' });
    expect(contentUrgency(c, '2026-11-22').any).toBeUndefined();
    expect(contentUrgency(c, '2026-11-30').any).toBeUndefined();
  });
  it('délai réglable par contenu ou dans les réglages', () => {
    const c = piece({ publishDate: '2026-11-29', redAlert: true, redAlertDays: 7 });
    expect(contentUrgency(c, '2026-11-22').publish).toBe('soon'); // J-7 avec un délai de 7 jours
    store.update('settings', 'settings', { urgencyDays: 1 });
    const d = piece({ publishDate: '2026-11-24', redAlert: true });
    expect(itemUrgency(store.state, expandRange(store.state, '2026-11-24', '2026-11-24').find((i) => i.contentRef?.kind === 'publish' && i.contentRef.contentId === d.id)!)).toBeUndefined(); // J-2 > 1 jour
  });
  it('dans le planning : seules les publications / tournages en alerte sont rouges — jamais les tâches, RDV ou repas', () => {
    piece({ title: 'Collab', shootDate: '2026-11-23', publishDate: '2026-11-24', publishTime: '18:00', redAlert: true });
    piece({ title: 'Normal', shootDate: '2026-11-23', publishDate: '2026-11-24' });
    const items = expandRange(store.state, '2026-11-23', '2026-11-24');
    expect(itemUrgency(store.state, items.find((i) => i.title.includes('Publier · Collab'))!)).toBe('soon');
    expect(itemUrgency(store.state, items.find((i) => i.title.includes('Publier · Normal'))!)).toBeUndefined();
    expect(itemUrgency(store.state, items.find((i) => i.contentRef?.kind === 'shoot')!)).toBe('soon'); // le tournage contient un contenu en alerte
    const repas = createItem({ title: 'Repas', date: '2026-11-23', deadline: '2026-11-23' }) as Item;
    const old = createItem({ title: 'Tâche en retard', deadline: '2026-11-10' }) as Item;
    expect(itemUrgency(store.state, repas)).toBeUndefined();
    expect(itemUrgency(store.state, old)).toBeUndefined();
  });
});
