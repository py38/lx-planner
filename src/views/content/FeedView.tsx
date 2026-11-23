// Aperçu du feed Instagram : grille 3 colonnes, simulations sauvegardées, ordre modifiable, recadrage.
import { useMemo, useState } from 'react';
import { getStore, useData } from '../../data/store';
import { useUI } from '../../ui/UI';
import { Empty, Sheet, Seg } from '../../ui/kit';
import { Cover, CropEditor } from '../../ui/Cover';
import { useDrag } from '../../ui/drag';
import { pickImages, saveMedia } from '../../data/media';
import { datesFromFeedOrder, feedFromContents, moveTile } from '../../logic/contentPlan';
import { fmtShort } from '../../lib/date';
import { uid } from '../../lib/id';
import { IconPlus, IconTrash } from '../../ui/Icons';
import type { ContentPiece, FeedAspect, FeedSim, FeedTile } from '../../data/types';
import type { ContentDraft } from './ContentEditor';

const AUTO = 'auto';

export function FeedView({ onEditContent }: { onEditContent: (c: ContentDraft) => void }) {
  const state = useData();
  const ui = useUI();
  const sims = Object.values(state.feeds).filter((f) => !f.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const contents = useMemo(() => Object.values(state.contents).filter((c) => !c.deleted), [state]);
  const autoTiles = useMemo(() => feedFromContents(contents), [contents]);
  const [currentId, setCurrentId] = useState<string>(sims[0]?.id ?? AUTO);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [autoAspect, setAutoAspect] = useState<FeedAspect>('3:4');
  const [tileMenu, setTileMenu] = useState<{ t: FeedTile; i: number } | null>(null);
  const [applyOrder, setApplyOrder] = useState(false);
  const sim = currentId === AUTO ? undefined : state.feeds[currentId];
  const tiles = sim ? sim.tiles : autoTiles;
  const aspect = sim?.aspect ?? autoAspect;

  const saveTiles = (t: FeedTile[]) => sim && getStore().update('feeds', sim.id, { tiles: t });

  const createSim = async (from: 'auto' | 'empty' | 'copy') => {
    const name = prompt('Nom de la simulation', from === 'copy' && sim ? `${sim.name} (copie)` : `Simulation ${sims.length + 1}`);
    if (!name) return;
    const base = from === 'auto' ? autoTiles : from === 'copy' && sim ? sim.tiles : [];
    const s = getStore().create('feeds', { name, aspect, tiles: base.map((t) => ({ ...t, id: uid() })) } as FeedSim);
    setCurrentId(s.id);
    ui.toast('Simulation créée');
  };

  const addImages = async (where: 'top' | 'bottom') => {
    if (!sim) return;
    const files = await pickImages(true);
    if (!files.length) return;
    const ids = await Promise.all(files.map((f) => saveMedia(f)));
    const newTiles = ids.map((m) => ({ id: uid(), mediaId: m }));
    saveTiles(where === 'top' ? [...newTiles, ...sim.tiles] : [...sim.tiles, ...newTiles]);
    ui.toast(`${ids.length} image${ids.length > 1 ? 's' : ''} ajoutée${ids.length > 1 ? 's' : ''}`);
  };

  return (
    <div>
      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${currentId === AUTO ? 'on' : ''}`} onClick={() => setCurrentId(AUTO)}>Feed prévu (calendrier)</button>
        {sims.map((s) => <button key={s.id} className={`chip ${currentId === s.id ? 'on' : ''}`} onClick={() => setCurrentId(s.id)}>{s.name}</button>)}
        <button className="chip" onClick={() => createSim('auto')}><IconPlus size={13} /> Nouvelle simulation</button>
      </div>

      <div className="feed-layout">
        <div>
          <FeedGrid
            title={sim ? sim.name : 'Feed prévu'}
            tiles={tiles} aspect={aspect} contents={state.contents}
            editable={!!sim}
            onReorder={(from, to) => saveTiles(moveTile(tiles, from, to))}
            onTile={(t, i) => setTileMenu({ t, i })}
          />
        </div>

        <div className="col" style={{ gap: 12 }}>
          <div className="card" style={{ marginTop: 0 }}>
            <div className="card-head"><h3>{sim ? 'Simulation' : 'Feed prévu'}</h3></div>
            {sim ? (
              <div className="col" style={{ gap: 8 }}>
                <Seg value={sim.aspect} onChange={(a) => getStore().update('feeds', sim.id, { aspect: a })} options={[{ value: '3:4', label: '3:4 (profil)' }, { value: '4:5', label: '4:5' }, { value: '1:1', label: '1:1' }]} />
                <button className="btn" onClick={() => addImages('top')}><IconPlus size={15} /> Ajouter mes prochaines publications</button>
                <button className="btn" onClick={() => addImages('bottom')}>Ajouter mes publications déjà en ligne (en bas)</button>
                <div className="kbd-hint">Glissez une vignette pour changer l’ordre (appui long sur iPhone). Touchez-la pour la remplacer, la recadrer ou la retirer.</div>
                <div className="divider" />
                <div className="row wrap">
                  <button className="btn small" onClick={() => createSim('copy')}>Dupliquer</button>
                  <button className="btn small" onClick={() => { const n = prompt('Nouveau nom', sim.name); if (n) getStore().update('feeds', sim.id, { name: n }); }}>Renommer</button>
                  <button className="btn small ghost danger" onClick={async () => {
                    if (!(await ui.confirm(`Supprimer la simulation « ${sim.name} » ?`, { ok: 'Supprimer', danger: true }))) return;
                    getStore().remove('feeds', sim.id); setCurrentId(AUTO);
                  }}><IconTrash size={14} /> Supprimer</button>
                </div>
                {sim.tiles.some((t) => t.contentId) && <button className="btn small" onClick={() => setApplyOrder(true)}>Appliquer cet ordre aux dates de publication…</button>}
              </div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                <p className="small muted" style={{ margin: 0 }}>Construit automatiquement à partir des couvertures de votre calendrier de contenu, de la publication la plus récente (en haut à gauche) à la plus ancienne.</p>
                <Seg value={autoAspect} onChange={setAutoAspect} options={[{ value: '3:4', label: '3:4 (profil)' }, { value: '4:5', label: '4:5' }, { value: '1:1', label: '1:1' }]} />
                <button className="btn primary" onClick={() => createSim('auto')}>Créer une simulation à partir de ce feed</button>
                <button className="btn" onClick={() => createSim('empty')}>Simulation vide</button>
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 0 }}>
            <div className="card-head"><h3>Comparer</h3></div>
            <select className="input" value={compareId ?? ''} onChange={(e) => setCompareId(e.target.value || null)}>
              <option value="">Choisir une autre simulation…</option>
              {currentId !== AUTO && <option value={AUTO}>Feed prévu (calendrier)</option>}
              {sims.filter((s) => s.id !== currentId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {compareId && (
        <div className="section">
          <div className="section-title">Comparaison</div>
          <div className="feed-compare">
            <FeedGrid title={sim ? sim.name : 'Feed prévu'} tiles={tiles} aspect={aspect} contents={state.contents} small />
            {(() => {
              const other = compareId === AUTO ? undefined : state.feeds[compareId];
              return <FeedGrid title={other?.name ?? 'Feed prévu'} tiles={other?.tiles ?? autoTiles} aspect={other?.aspect ?? autoAspect} contents={state.contents} small />;
            })()}
          </div>
        </div>
      )}

      {tileMenu && (
        <TileMenu tile={tileMenu.t} aspect={aspect} content={tileMenu.t.contentId ? state.contents[tileMenu.t.contentId] : undefined}
          onClose={() => setTileMenu(null)}
          onChange={(t) => sim && saveTiles(sim.tiles.map((x, j) => (j === tileMenu.i ? t : x)))}
          onRemove={() => { sim && saveTiles(sim.tiles.filter((_, j) => j !== tileMenu.i)); setTileMenu(null); }}
          onOpenContent={(c) => { setTileMenu(null); onEditContent(c); }}
          editable={!!sim} />
      )}
      {applyOrder && sim && <ApplyOrderSheet sim={sim} onClose={() => setApplyOrder(false)} />}
    </div>
  );

}

/** Grille façon profil Instagram (3 colonnes). */
function FeedGrid({ title, tiles, aspect, contents, editable, small, onReorder, onTile }: {
  title: string; tiles: FeedTile[]; aspect: FeedAspect; contents: Record<string, ContentPiece>; editable?: boolean; small?: boolean;
  onReorder?: (from: number, to: number) => void; onTile?: (t: FeedTile, i: number) => void;
}) {
  const overIdx = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-tile]') as HTMLElement | null;
    return el ? +el.dataset.tile! : null;
  };
  const { drag, start, clickGuard } = useDrag<{ from: number }>((d) => {
    const to = overIdx(d.x, d.y);
    if (to != null && to !== d.payload.from) onReorder?.(d.payload.from, to);
  });
  const target = drag ? overIdx(drag.x, drag.y) : null;
  return (
    <div className={`phone ${small ? 'small' : ''}`}>
      <div className="phone-head">
        <div className="avatar">LX</div>
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{title}</div>
          <div className="tiny faint">{tiles.length} publication{tiles.length > 1 ? 's' : ''}</div>
        </div>
      </div>
      {tiles.length ? (
        <div className="feed-grid">
          {tiles.map((t, i) => {
            const c = t.contentId ? contents[t.contentId] : undefined;
            return (
              <div key={t.id} data-tile={i} className={`feed-tile ${drag?.payload.from === i ? 'dragging' : ''} ${target === i && drag?.payload.from !== i ? 'target' : ''}`}
                onPointerDown={editable ? (e) => start(e, { from: i }) : undefined}
                onClick={() => { if (!clickGuard()) onTile?.(t, i); }}>
                <Cover mediaId={t.mediaId ?? c?.coverMediaId} crop={t.crop ?? c?.coverCrop} aspect={aspect} placeholder={<span className="tiny">{c?.title ?? 'Vide'}</span>}>
                  {c?.publishDate && !small && <span className="tile-date">{fmtShort(c.publishDate)}</span>}
                  {c?.format === 'reel' && <span className="tile-icon">▶</span>}
                  {c?.format === 'carousel' && <span className="tile-icon">❐</span>}
                </Cover>
              </div>
            );
          })}
        </div>
      ) : <Empty>{editable ? 'Ajoutez des images pour simuler votre feed.' : 'Ajoutez des couvertures à vos contenus pour voir votre feed prévu.'}</Empty>}
      {drag && <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>Déplacer</div>}
    </div>
  );
}

function TileMenu({ tile, aspect, content, editable, onClose, onChange, onRemove, onOpenContent }: {
  tile: FeedTile; aspect: FeedAspect; content?: ContentPiece; editable: boolean;
  onClose: () => void; onChange: (t: FeedTile) => void; onRemove: () => void; onOpenContent: (c: ContentPiece) => void;
}) {
  const [crop, setCrop] = useState(false);
  const mediaId = tile.mediaId ?? content?.coverMediaId;
  const replace = async () => {
    const [f] = await pickImages(false);
    if (!f) return;
    const id = await saveMedia(f);
    onChange({ ...tile, mediaId: id, crop: undefined });
    if (content && !tile.mediaId) getStore().update('contents', content.id, { coverMediaId: id, coverCrop: undefined });
    onClose();
  };
  return (
    <Sheet title={content?.title ?? 'Publication'} onClose={onClose}>
      <div style={{ maxWidth: 240, margin: '0 auto 14px' }}><Cover mediaId={mediaId} crop={tile.crop ?? content?.coverCrop} aspect={aspect} /></div>
      {content?.publishDate && <p className="small muted" style={{ textAlign: 'center', marginTop: 0 }}>Publication prévue le {fmtShort(content.publishDate)}</p>}
      <div className="col">
        {editable && <button className="btn" onClick={replace}>Remplacer l’image</button>}
        {editable && mediaId && <button className="btn" onClick={() => setCrop(true)}>Recadrer / ajuster</button>}
        {content && <button className="btn" onClick={() => onOpenContent(content)}>Ouvrir le contenu</button>}
        {editable && <button className="btn ghost danger" onClick={onRemove}>Retirer de la simulation</button>}
        {!editable && <p className="tiny faint">Le feed prévu se modifie depuis le calendrier de contenu. Créez une simulation pour tester un autre ordre.</p>}
      </div>
      {crop && mediaId && <CropEditor mediaId={mediaId} crop={tile.crop ?? content?.coverCrop} aspect={aspect} onSave={(c) => onChange({ ...tile, crop: c })} onClose={() => setCrop(false)} />}
    </Sheet>
  );
}

/** Reporter l'ordre de la simulation sur les dates de publication — seulement après confirmation. */
function ApplyOrderSheet({ sim, onClose }: { sim: FeedSim; onClose: () => void }) {
  const state = useData();
  const ui = useUI();
  const changes = datesFromFeedOrder(sim.tiles, state.contents);
  return (
    <Sheet title="Appliquer l’ordre au calendrier" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Ne rien changer</button>
      <button className="btn primary" disabled={!changes.length} onClick={() => {
        getStore().transact(() => changes.forEach((c) => getStore().update('contents', c.id, { publishDate: c.to })));
        ui.toast('Dates de publication mises à jour');
        onClose();
      }}>Appliquer</button>
    </>}>
      {changes.length ? <>
        <p className="small muted" style={{ marginTop: 0 }}>Les mêmes dates sont redistribuées pour que l’ordre du feed corresponde à cette simulation (la 1re vignette = la publication la plus récente).</p>
        {changes.map((c) => <div key={c.id} className="row small" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}><span className="grow">{c.title}</span><span className="nowrap">{c.from ? fmtShort(c.from) : '—'} → <b>{fmtShort(c.to)}</b></span></div>)}
      </> : <p className="small">Les dates correspondent déjà à cet ordre.</p>}
    </Sheet>
  );
}
