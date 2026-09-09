// Synthetic helper contract, matching H3's default single-track behavior.
export function projectAudioTrackBindings(asset) {
  const saved = asset.options?.audio_tracks;
  return Object.fromEntries(['full_mix', 'vocals', 'instrumental'].map(role => [role, String(saved ? saved[role] || '' : role === 'full_mix' ? asset.id : '')]));
}
