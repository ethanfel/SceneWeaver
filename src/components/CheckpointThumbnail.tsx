import { useState } from 'react';

// Remount when the revision or server changes, including after a failed image.
export function CheckpointThumbnail({ url, name, filmstrip = false }: { url: string; name: string; filmstrip?: boolean }) {
  return url ? <ThumbnailImage key={url} url={url} name={name} filmstrip={filmstrip}/> : null;
}
function ThumbnailImage({ url, name, filmstrip }: { url: string; name: string; filmstrip: boolean }) {
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
  if (failed) return null;
  return <div className={`checkpoint-thumbnail ${filmstrip ? 'filmstrip' : 'poster'} ${loaded ? 'is-loaded' : ''}`} style={loaded && filmstrip ? { backgroundImage: `url("${url}")` } : undefined}>
    <img src={url} alt={`Saved clip thumbnail: ${name.replaceAll('_', ' ')}`} loading="lazy" decoding="async" draggable={false} onLoad={() => setLoaded(true)} onError={() => setFailed(true)}/>
  </div>;
}
