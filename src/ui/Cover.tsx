// Vignette d'image recadrée (non destructif) + éditeur de recadrage.
import { useRef, useState, type ReactNode } from 'react';
import { useMediaUrl } from '../data/media';
import { Sheet, Seg } from './kit';
import type { Crop, FeedAspect } from '../data/types';

export const DEFAULT_CROP: Crop = { zoom: 1, x: 50, y: 50 };
export const ASPECT_CSS: Record<FeedAspect, string> = { '3:4': '3 / 4', '4:5': '4 / 5', '1:1': '1 / 1' };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** x / y = point de cadrage (0–100 %), zoom ≥ 1 vers ce point. */
export function Cover({ mediaId, crop, aspect = '3:4', children, className, placeholder }: {
  mediaId?: string; crop?: Crop; aspect?: FeedAspect; children?: ReactNode; className?: string; placeholder?: ReactNode;
}) {
  const { url, missing } = useMediaUrl(mediaId);
  const c = crop ?? DEFAULT_CROP;
  return (
    <div className={`cover ${className ?? ''}`} style={{ aspectRatio: ASPECT_CSS[aspect] }}>
      {url ? (
        <img src={url} alt="" draggable={false} style={{ objectPosition: `${c.x}% ${c.y}%`, transform: `scale(${c.zoom})`, transformOrigin: `${c.x}% ${c.y}%` }} />
      ) : (
        <div className="cover-empty">{mediaId && missing ? 'Image enregistrée sur un autre appareil' : placeholder ?? 'Pas de couverture'}</div>
      )}
      {children}
    </div>
  );
}

/** Recadrer : glisser pour déplacer, curseur pour zoomer. */
export function CropEditor({ mediaId, crop, aspect, onSave, onClose }: {
  mediaId: string; crop?: Crop; aspect: FeedAspect; onSave: (c: Crop) => void; onClose: () => void;
}) {
  const [c, setC] = useState<Crop>(crop ?? DEFAULT_CROP);
  const [asp, setAsp] = useState<FeedAspect>(aspect);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; c: Crop } | null>(null);

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, c };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !frame.current) return;
    const r = frame.current.getBoundingClientRect();
    // glisser vers la droite montre la partie gauche de l'image → x diminue
    const dx = ((e.clientX - drag.current.x) / r.width) * 100 / drag.current.c.zoom;
    const dy = ((e.clientY - drag.current.y) / r.height) * 100 / drag.current.c.zoom;
    setC({ ...drag.current.c, x: clamp(drag.current.c.x - dx * 1.6, 0, 100), y: clamp(drag.current.c.y - dy * 1.6, 0, 100) });
  };
  const onUp = () => { drag.current = null; };

  return (
    <Sheet title="Recadrer" onClose={onClose} footer={<>
      <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => setC(DEFAULT_CROP)}>Réinitialiser</button>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn primary" onClick={() => { onSave(c); onClose(); }}>Enregistrer</button>
    </>}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <Seg value={asp} onChange={setAsp} options={[{ value: '3:4', label: 'Grille 3:4' }, { value: '4:5', label: 'Post 4:5' }, { value: '1:1', label: 'Carré' }]} />
      </div>
      <div ref={frame} className="crop-frame" style={{ touchAction: 'none' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <Cover mediaId={mediaId} crop={c} aspect={asp}>
          <div className="crop-grid" />
        </Cover>
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label>Zoom · {c.zoom.toFixed(2)}×</label>
        <input type="range" min={1} max={3} step={0.01} value={c.zoom} onChange={(e) => setC({ ...c, zoom: +e.target.value })} style={{ width: '100%', accentColor: 'var(--ink)' }} />
      </div>
      <p className="tiny faint">Glissez l’image pour choisir la partie visible. L’image d’origine n’est pas modifiée.</p>
    </Sheet>
  );
}
