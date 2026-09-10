// Synthetic browser fixture only. Native Python tests exercise the real H3
// trim, dependency, ownership and persistence implementations separately.
import { createHash, randomUUID } from 'node:crypto';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => structuredClone(value);
export function installEditorialFixture(app, getData, getAssets, record) {
  app.post('/minimax_h3_context_loop/editorial/command', (req, res) => {
    const body = req.body, branch = body.branch_id || 'main', data = getData(branch);
    if (!data) return res.status(400).json({ error: 'No saved sequence' });
    const identity = { version: 1, run_name: body.run_name, branch_id: branch };
    const stamp = digest([data.editorial, data.checkpoints, getAssets()]);
    const scenes = data.checkpoints.map(item => ({ scene: item.scene, scene_id: item.scene_id, revision: item.revision, raw_frames: 124, delivered_frames: 108,
      out_frame: data.editorial.trims?.find(v => v.scene_id === item.scene_id)?.out_frame ?? 108,
      start_frame: data.editorial.placements?.find(v => v.scene_id === item.scene_id)?.start_frame ?? null,
      locked: data.editorial.locked_scene_ids?.includes(item.scene_id) || false,
      safe_out_frames: [6, 9, 18, 27, 39, 48, 57, 60, 69, 78, 90, 99, 108] }));
    const describe = document => {
      let natural = 0, cursor = 0;
      const records = [];
      const clips = scenes.map(item => {
        const frames = document.trims?.find(v => v.scene_id === item.scene_id)?.out_frame ?? 108;
        const place = document.placements?.find(v => v.scene_id === item.scene_id);
        const next = { kind: 'scene', scene: item.scene, scene_id: item.scene_id, start_frame: place?.start_frame ?? natural, frame_count: frames, explicit: !!place };
        natural += frames; return next;
      }).sort((a, b) => a.start_frame - b.start_frame || Number(b.explicit) - Number(a.explicit) || a.scene - b.scene);
      for (const clip of clips) {
        const start = Math.max(cursor, clip.start_frame);
        if (start > cursor) records.push({ kind: 'gap', start_frame: cursor, frame_count: start - cursor });
        records.push({ ...clip, start_frame: start }); cursor = start + clip.frame_count;
      }
      const firstOut = document.trims?.find(v => v.scene_id === scenes[0]?.scene_id)?.out_frame ?? 108;
      return { frames: cursor, fps: 24, subtitle_count: document.subtitles?.mode === 'preview_srt' ? 2 : 0, records,
        stale_scenes: scenes.length > 1 && firstOut !== 48 ? [{ scene: 2, reasons: [`previous scene endpoint changed from 48f to ${firstOut}f`] }, { scene: 3, reasons: ['depends on stale scene 2'] }] : [] };
    };
    if (body.action === 'inspect') return res.json({ ...identity, stamp, scenes, subtitles: data.editorial.subtitles, timeline: describe(data.editorial),
      subtitle_assets: getAssets().filter(v => v.kind === 'audio').map(v => ({ id: v.id, tag: v.tag, timed: !!v.lyrics })) });
    if (body.stamp !== stamp) return res.status(409).json({ error: 'The saved cut, checkpoints or assets changed. Review the edit again.' });
    const document = clone(data.editorial), edit = body.patch?.scene;
    if (edit) {
      const scene = scenes.find(v => v.scene === edit.scene && v.scene_id === edit.scene_id && v.revision === edit.revision);
      if (!scene) return res.status(409).json({ error: 'Saved scene changed' });
      if (scene.locked && ('out_frame' in edit || 'start_frame' in edit)) return res.status(400).json({ error: 'Unlock this saved scene first' });
      for (const [field, list] of [['out_frame', 'trims'], ['start_frame', 'placements']]) if (field in edit) {
        document[list] = (document[list] || []).filter(v => v.scene_id !== edit.scene_id);
        if (edit[field] !== null && !(field === 'out_frame' && edit[field] === 108)) document[list].push({ scene_id: edit.scene_id, [field]: edit[field] });
      }
      if ('locked' in edit) document.locked_scene_ids = [...(document.locked_scene_ids || []).filter(v => v !== edit.scene_id), ...(edit.locked ? [edit.scene_id] : [])];
    } else document.subtitles = { ...document.subtitles, ...body.patch.subtitles };
    const token = digest([stamp, body.patch]), timeline = describe(document);
    if (body.action === 'preview') return res.json({ ...identity, stamp, preview_token: token, patch: body.patch, timeline });
    if (body.preview_token !== token) return res.status(409).json({ error: 'Reviewed edit changed' });
    if (req.headers['x-h3-workflow-owner'] !== 'test-native-owner') return res.status(423).json({ error: 'Native ownership required' });
    document.revision = randomUUID().replaceAll('-', ''); data.editorial = document;
    record({ action: 'saved-cut', body, branch });
    return res.json({ ...identity, editorial: document, timeline });
  });
}
