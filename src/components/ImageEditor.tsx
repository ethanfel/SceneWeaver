import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Controls';
import { foldersFor, type LibraryMutation } from './LibraryOrganizer';
import { H3 } from '../lib/api';
import type { LiveResult, ProjectAsset, ProjectCatalog } from '../types';

type Size = { width: number; height: number };
type Crop = Size & { x: number; y: number };
type Edit = { crop: Crop; target: Size; resample: string; tag: string; folder_id: string };
type Info = { project: string; asset_id: string; base_revision: string; source: Size; max_pixels: number; resampling: string[] };
type Review = Info & Edit & { preview_revision: string; copyable: boolean; issue: string };
type Draft = Edit & { locked: boolean; ratio: number; multiple: number; megapixels: number };
type Command = (action: string, options?: Record<string, unknown>) => Promise<LiveResult>;
const mp = (size: Size) => size.width * size.height / 1e6;
const editOf = ({ crop, target, resample, tag, folder_id }: Draft): Edit => ({ crop, target, resample, tag, folder_id });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));
function bounded(crop: Crop, source: Size, ratio?: number): Crop {
  const x = clamp(crop.x, 0, source.width - 1), y = clamp(crop.y, 0, source.height - 1);
  let width = Math.max(1, crop.width), height = ratio ? width / ratio : Math.max(1, crop.height);
  const fit = Math.min(1, (source.width - x) / width, (source.height - y) / height);
  if (ratio) { width *= fit; height *= fit; }
  return { x, y, width: clamp(width, 1, source.width - x), height: clamp(height, 1, source.height - y) };
}

export function ImageEditor({ asset, catalog, editable, command, mutate, close }: {
  asset: ProjectAsset; catalog: ProjectCatalog; editable: boolean; command: Command; mutate: LibraryMutation; close: () => void;
}) {
  const [info, setInfo] = useState<Info | null>(null), [draft, setDraft] = useState<Draft | null>(null), [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [sizing, setSizing] = useState(false), [reading, setReading] = useState(false), [refresh, setRefresh] = useState(0), [drawMode, setDrawMode] = useState(false), [imageFailed, setImageFailed] = useState(false);
  const commandRef = useRef(command), draftRef = useRef(draft), serial = useRef(0), svg = useRef<SVGSVGElement | null>(null);
  commandRef.current = command; draftRef.current = draft;
  const closeState = useRef({ close, busy }); closeState.current = { close, busy };
  const closeModal = useCallback(() => { if (!closeState.current.busy) closeState.current.close(); }, []);
  const drag = useRef<{ start: { x: number; y: number }; crop: Crop; mode: string } | null>(null);
  const url = `/comfy${H3}/project-assets/media?${new URLSearchParams({ project: catalog.project, asset: asset.id, variant: 'original' })}`;
  const patch = (values: Partial<Draft>) => {
    serial.current++; setSizing(false); setReview(null); setMessage(''); setError('');
    setDraft(previous => previous ? { ...previous, ...values } : previous);
  };
  useEffect(() => {
    let current = true; setError(''); setInfo(null); setDraft(null); setReview(null); setImageFailed(false); setReading(true);
    void (async () => {
      const result = (await commandRef.current('asset-image-inspect', { asset_id: asset.id })).data as Info;
      const megapixels = mp(result.source), ratio = result.source.width / result.source.height;
      const target = (await commandRef.current('asset-image-dimensions', { size: { mode: 'megapixels', megapixels, ratio, multiple: 8 } })).data as Size;
      if (current) { setInfo(result); setDraft({ crop: { x: 0, y: 0, ...result.source }, target, resample: 'lanczos', tag: `${asset.tag}_variant`, folder_id: String(asset.folder_id || ''), locked: true, ratio, multiple: 8, megapixels }); }
    })().catch(reason => { if (current) setError(String(reason)); }).finally(() => { if (current) setReading(false); });
    return () => { current = false; serial.current++; };
  }, [catalog.project, asset.id, refresh]);
  async function size(change: Record<string, unknown>, additional: Partial<Draft> = {}) {
    const current = draftRef.current; if (!current) return;
    const started = ++serial.current; setSizing(true); setReview(null); setError('');
    try {
      const target = (await commandRef.current('asset-image-dimensions', { size: { ...current.target, ratio: current.ratio, locked: current.locked, multiple: current.multiple, ...change } })).data as Size;
      if (started === serial.current) setDraft(previous => previous ? { ...previous, ...additional, target, megapixels: change.mode === 'megapixels' ? Number(change.megapixels) : mp(target), ...(!previous.locked ? { ratio: target.width / target.height } : {}) } : previous);
    } catch (reason) { if (started === serial.current) setError(String(reason)); }
    finally { if (started === serial.current) setSizing(false); }
  }
  const changeCrop = (key: keyof Crop, value: number) => {
    if (!draft || !info || !Number.isFinite(value)) return;
    const next = { ...draft.crop, [key]: value };
    if (draft.locked && key === 'height') next.width = value * draft.ratio;
    patch({ crop: bounded(next, info.source, draft.locked ? draft.ratio : undefined) });
  };
  const point = (event: React.PointerEvent<SVGSVGElement>) => {
    const transform = event.currentTarget.getScreenCTM();
    return transform ? new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse()) : new DOMPoint();
  };
  const pointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = drag.current; if (!active || !draft || !info) return;
    const raw = point(event), p = { x: clamp(raw.x, 0, info.source.width), y: clamp(raw.y, 0, info.source.height) }, base = active.crop;
    if (active.mode === 'move') {
      patch({ crop: { ...base, x: clamp(base.x + p.x - active.start.x, 0, info.source.width - base.width), y: clamp(base.y + p.y - active.start.y, 0, info.source.height - base.height) } }); return;
    }
    const anchor = active.mode === 'draw' ? active.start : { x: active.mode.includes('w') ? base.x + base.width : base.x, y: active.mode.includes('n') ? base.y + base.height : base.y };
    let width = Math.max(1, Math.abs(p.x - anchor.x)), height = Math.max(1, Math.abs(p.y - anchor.y));
    if (draft.locked) height = width / draft.ratio;
    const west = p.x < anchor.x, north = p.y < anchor.y;
    const fit = Math.min(1, (west ? anchor.x : info.source.width - anchor.x) / width, (north ? anchor.y : info.source.height - anchor.y) / height);
    width *= fit; height *= fit;
    patch({ crop: bounded({ x: west ? anchor.x - width : anchor.x, y: north ? anchor.y - height : anchor.y, width, height }, info.source) });
  };
  const shape = draft?.crop, stale = Boolean(review && review.base_revision !== catalog.library_revision);
  const valid = Boolean(info && draft && [draft.target.width, draft.target.height].every(value => Number.isInteger(value) && value > 0) && draft.target.width * draft.target.height <= info.max_pixels);
  async function inspect() {
    if (!draft || !valid) return; const started = serial.current; setReading(true); setReview(null); setError('');
    try { const result = await command('asset-image-inspect', { asset_id: asset.id, edit: editOf(draft) }); if (started === serial.current) setReview(result.data as Review); }
    catch (reason) { if (started === serial.current) setError(String(reason)); } finally { setReading(false); }
  }
  async function save() {
    if (!draft || !review || stale || !editable || busy || sizing) return; setBusy(true); setError('');
    try {
      const ok = await mutate('asset-library-mutate', { library_action: 'asset_derive', asset_id: asset.id, base_revision: review.base_revision, preview_revision: review.preview_revision, ...editOf(draft) });
      if (ok) { setMessage('Variant saved to the project library. The source image is unchanged.'); setReview(null); }
      else setError('Variant was not confirmed. Review the reported error, or close the editor to check a pending library operation.');
    } finally { setBusy(false); }
  }
  return <Modal title={`Image variant · ${asset.tag}`} wide onClose={closeModal}><div className="modal-body image-editor">
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!draft || !info ? <div><p>{reading ? 'Reading the oriented source image…' : 'The source image is unavailable.'}</p><button disabled={reading} onClick={() => setRefresh(value => value + 1)}>Reload image</button></div> : <>
      <div className="image-editor-view"><div className="image-crop-stage"><svg ref={svg} viewBox={`0 0 ${info.source.width} ${info.source.height}`} role="group" aria-label="Crop selector" tabIndex={0}
        onPointerDown={event => { if (busy) return; const p = point(event), hit = (event.target as SVGElement).dataset.handle; drag.current = { start: { x: clamp(p.x, 0, info.source.width), y: clamp(p.y, 0, info.source.height) }, crop: { ...draft.crop }, mode: drawMode || event.altKey ? 'draw' : hit || 'draw' }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); event.currentTarget.focus(); }}
        onPointerMove={pointerMove} onPointerUp={event => { drag.current = null; setDrawMode(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }}
        onKeyDown={event => { if (busy || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 10 : 1; patch({ crop: { ...draft.crop, x: clamp(draft.crop.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), 0, info.source.width - draft.crop.width), y: clamp(draft.crop.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), 0, info.source.height - draft.crop.height) } }); }}>
        <image href={url} width={info.source.width} height={info.source.height} onError={() => setImageFailed(true)}/>
        <path d={`M0 0H${info.source.width}V${info.source.height}H0Z M${shape!.x} ${shape!.y}v${shape!.height}h${shape!.width}v-${shape!.height}Z`} fill="#0009" fillRule="evenodd" pointerEvents="none"/>
        <rect data-handle="move" {...shape} fill="transparent" stroke="#efbb8c" strokeWidth={Math.max(info.source.width, info.source.height) / 350}/>
        {['nw', 'ne', 'sw', 'se'].map(corner => { const size = Math.max(info.source.width, info.source.height) / 65; return <rect key={corner} data-handle={corner} x={(corner.includes('w') ? shape!.x : shape!.x + shape!.width) - size / 2} y={(corner.includes('n') ? shape!.y : shape!.y + shape!.height) - size / 2} width={size} height={size} fill="#efbb8c"/>; })}
      </svg></div><p>{info.source.width} × {info.source.height} source · {draft.crop.width} × {draft.crop.height} crop</p>
      {imageFailed && <p role="alert">Original image preview is unavailable.</p>}<p className="hint">Draw a crop, drag inside to move, or drag a corner to resize. Arrow keys nudge 1 pixel; Shift nudges 10.</p>
      <div className="project-actions"><button disabled={busy} aria-pressed={drawMode} onClick={() => setDrawMode(value => !value)}>Draw crop</button><button disabled={busy} onClick={() => { const width = Math.round(info.source.width * .8), height = draft.locked ? width / draft.ratio : Math.round(info.source.height * .8); patch({ crop: bounded({ x: (info.source.width - width) / 2, y: (info.source.height - height) / 2, width, height }, info.source, draft.locked ? draft.ratio : undefined) }); }}>Centered crop</button><button disabled={busy} onClick={() => { const crop = { x: 0, y: 0, ...info.source }, ratio = info.source.width / info.source.height; if (draft.locked) void size({ mode: 'megapixels', megapixels: draft.megapixels, ratio }, { crop, ratio }); else patch({ crop }); }}>Use full image</button></div>
      <h3>Framing preview</h3><div className="image-result-preview" style={{ aspectRatio: `${draft.target.width} / ${draft.target.height}` }}><svg viewBox={`${draft.crop.x} ${draft.crop.y} ${draft.crop.width} ${draft.crop.height}`} preserveAspectRatio="none"><image href={url} width={info.source.width} height={info.source.height}/></svg></div><p className="hint">Final resampling is performed by H3.</p></div>
      <div className="image-editor-inspector"><fieldset disabled={busy}><legend>Crop and placement</legend><div className="image-fields">{(['x', 'y', 'width', 'height'] as const).map(key => <label className="field" key={key}><span>Crop {key}</span><input aria-label={`Crop ${key}`} type="number" step="1" min={key === 'x' || key === 'y' ? 0 : 1} value={draft.crop[key]} onChange={event => changeCrop(key, Number(event.target.value))}/></label>)}</div></fieldset>
      <fieldset disabled={busy}><legend>Output size</legend><div className="image-fields">{(['width', 'height'] as const).map(key => <label className="field" key={key}><span>Output {key}</span><input aria-label={`Output ${key}`} type="number" step="1" min="1" value={draft.target[key]} onChange={event => patch({ target: { ...draft.target, [key]: Number(event.target.value) } })} onBlur={() => void size({ mode: 'dimensions', changed: key })}/></label>)}</div>
      <label><input type="checkbox" checked={draft.locked} onChange={event => { const ratio = draft.target.width / draft.target.height; patch({ locked: event.target.checked, ratio, crop: event.target.checked ? bounded(draft.crop, info.source, ratio) : draft.crop }); }}/>Lock aspect ratio</label>
      <label className="field"><span>Target megapixels</span><input aria-label="Target megapixels" type="number" min="0.000001" step="0.05" value={draft.megapixels} onChange={event => patch({ megapixels: Number(event.target.value) })} onBlur={() => void size({ mode: 'megapixels', megapixels: draft.megapixels })}/></label>
      <div className="project-actions">{[.25, .5, 1, 2, 4, 8].map(value => <button key={value} onClick={() => void size({ mode: 'megapixels', megapixels: value })}>{value} MP</button>)}</div>
      <label className="field"><span>Output multiple</span><select aria-label="Output multiple" value={draft.multiple} onChange={event => { const multiple = Number(event.target.value); void size({ mode: 'megapixels', megapixels: draft.megapixels, multiple }, { multiple }); }}>{[1, 8, 16, 32, 64].map(value => <option key={value} value={value}>{value === 1 ? 'Off' : value}</option>)}</select></label><p>{draft.target.width} × {draft.target.height} · {mp(draft.target).toFixed(3)} MP{draft.multiple > 1 ? ` · nearest multiple of ${draft.multiple}` : ''}</p>{!valid && <p role="alert">Choose positive whole-pixel dimensions up to {info.max_pixels.toLocaleString()} pixels.</p>}</fieldset>
      <fieldset disabled={busy}><legend>New variant</legend><label className="field"><span>Resampling</span><select aria-label="Resampling" value={draft.resample} onChange={event => patch({ resample: event.target.value })}>{info.resampling.map(value => <option key={value}>{value}</option>)}</select></label><label className="field"><span>Variant tag</span><input aria-label="Variant tag" value={draft.tag} onChange={event => patch({ tag: event.target.value })}/></label><label className="field"><span>Variant folder</span><select aria-label="Variant folder" value={draft.folder_id} onChange={event => patch({ folder_id: event.target.value })}><option value="">Unfiled</option>{foldersFor(catalog).map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><p>Creates an enabled {asset.role} variant linked to this source. H3 chooses a unique tag.</p></fieldset>
      {review && <p role="status">Reviewed {review.crop.width} × {review.crop.height} crop → {review.target.width} × {review.target.height} · {review.resample}</p>}{review?.issue && <p role="alert">{review.issue}</p>}{stale && <p role="alert">The library changed. Review this variant again before saving.</p>}
      <div className="image-editor-actions"><button disabled={busy || reading || sizing || !valid} onClick={() => void inspect()}>{reading ? 'Reviewing…' : 'Review variant'}</button><button disabled={!editable || busy || reading || sizing || !review?.copyable || stale || !valid} onClick={() => void save()}>{busy ? 'Saving…' : 'Save variant'}</button></div>
      <button disabled={busy || reading} onClick={() => setRefresh(value => value + 1)}>Reset all</button>
      </div></>}
  </div></Modal>;
}
