// Generate plan.json assets through a local/LAN ComfyUI server. Node 18+, no npm dependencies.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { args, readJSON, decodePNG, encodePNG, sleep } from './lib.mjs';
import { configuration, validateJob, workflow, resizeNearest } from './comfy-workflow.mjs';

const a = args(), cmd = a._[0], c = configuration(a);
async function api(path, body) {
  const r = await fetch(c.url + path, { method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Error(`ComfyUI ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 500)}`);
  return r.json();
}
async function health() {
  const stats = await api('/system_stats'), info = await api('/object_info');
  for (const [node, field, value] of [['CheckpointLoaderSimple', 'ckpt_name', c.checkpoint], ['LoraLoader', 'lora_name', c.lora], ['VAELoader', 'vae_name', c.vae]]) {
    if (!info[node]?.input?.required?.[field]?.[0]?.includes(value)) throw Error(`ComfyUI is missing ${field}: ${value}`);
  }
  console.log(`ComfyUI: ${c.url}; ${stats.devices?.map(d => d.name).join(', ') || 'device unknown'}`);
  console.log(`${c.checkpoint} + ${c.lora}; ${c.steps} steps, one image at a time`);
}
const atomic = (file, data) => { writeFileSync(file + '.tmp', data); renameSync(file + '.tmp', file); };
const hash = data => createHash('sha256').update(data).digest('hex');

async function main() {
  if (cmd === 'health') return health();
  if (!['run', 'status'].includes(cmd) || !a.trip) throw Error('usage: node comfy.mjs health | status|run --trip TRIP [--only NAME,NAME | --regen NAME,NAME] [--url URL] [--config FILE]');
  if (a.only && a.regen) throw Error('use either --only or --regen');
  const art = join(a.trip, 'art'), raw = join(art, 'raw'), stateDir = join(art, '.comfy');
  const plan = readJSON(join(art, 'plan.json'));
  if (!Array.isArray(plan?.jobs)) throw Error('no art/plan.json: run plan-art.mjs first');
  plan.jobs.forEach(validateJob);
  if (new Set(plan.jobs.map(j => j.name)).size !== plan.jobs.length) throw Error('duplicate asset names in plan');
  const selected = a.only || a.regen, names = selected ? String(selected).split(',') : plan.jobs.map(j => j.name);
  for (const name of names) if (!plan.jobs.some(j => j.name === name)) throw Error(`unknown asset: ${name}`);
  const jobs = plan.jobs.filter(j => names.includes(j.name));
  const lock = join(stateDir, 'lock');
  let fd;
  if (cmd === 'run') {
    mkdirSync(stateDir, { recursive: true }); mkdirSync(raw, { recursive: true });
    try { fd = openSync(lock, 'wx'); } catch { throw Error(`another generator holds ${lock}; if it has exited, remove that lock and rerun`); }
    writeFileSync(fd, String(process.pid));
  }
  try {
    const file = join(stateDir, 'jobs.json'), state = readJSON(file, { attempts: {}, jobs: {} });
    const save = () => atomic(file, JSON.stringify(state, null, 2));
    if (cmd === 'run') await health();
    for (const j of jobs) {
      let attempt = state.attempts[j.name] || 0;
      if (cmd === 'run' && a.regen) attempt++;
      const seed = (j.seed + attempt * 7919) % 2147483647, prompt = workflow(j, c, seed);
      const id = hash(JSON.stringify({ prompt, width: j.width, height: j.height }));
      const cached = join(stateDir, id + '.png'), out = join(raw, j.name + '.png');
      let record = state.jobs[id];
      if (cmd === 'status') { console.log(`${j.name}: ${existsSync(cached) ? 'cached' : record?.prompt_id ? 'submitted' : 'pending'}; seed ${seed}`); continue; }
      state.attempts[j.name] = attempt; save();
      if (existsSync(cached)) { copyFileSync(cached, out); console.log(`reuse ${j.name}`); continue; }
      if (record && record.url !== c.url) throw Error(`${j.name} is pending on ${record.url}; reconnect there or use --regen ${j.name}`);
      if (record?.failed) throw Error(`${j.name} failed: ${record.failed}; use --regen ${j.name} to retry`);
      if (record && !record.prompt_id) {
        // Recover a submission whose HTTP response was lost; never blindly submit it twice.
        const queue = await api('/queue'), history = await api('/history');
        const entries = [...(queue.queue_running || []), ...(queue.queue_pending || []), ...Object.values(history).map(h => h.prompt)];
        record.prompt_id = entries.find(p => p?.[3]?.pixel_path_request === record.request)?.[1];
        if (!record.prompt_id) throw Error(`submission outcome unknown for ${j.name}; inspect the ComfyUI queue, then use --regen ${j.name} if a new job is needed`);
        save();
      }
      if (!record) {
        record = state.jobs[id] = { name: j.name, seed, url: c.url, request: randomUUID(), started: new Date().toISOString() }; save();
        const submitted = await api('/prompt', { prompt, client_id: record.request, extra_data: { pixel_path_request: record.request } });
        if (!submitted.prompt_id || Object.keys(submitted.node_errors || {}).length) throw Error(`invalid ComfyUI workflow: ${JSON.stringify(submitted)}`);
        record.prompt_id = submitted.prompt_id; save();
      }
      console.log(`generate ${j.name}: seed ${seed}, prompt ${record.prompt_id}`);
      const deadline = Date.now() + c.timeout * 1000;
      let result;
      while (Date.now() < deadline) {
        const h = (await api('/history/' + encodeURIComponent(record.prompt_id)))[record.prompt_id];
        if (h?.status?.status_str === 'error') {
          record.failed = JSON.stringify(h.status.messages); save(); throw Error(`${j.name}: ${record.failed}`);
        }
        result = h?.outputs?.['9']?.images?.[0];
        if (result) break;
        await sleep(1000);
      }
      if (!result) throw Error(`timed out waiting for ${j.name}; rerun without --regen to collect the same job`);
      const query = new URLSearchParams({ filename: result.filename, subfolder: result.subfolder || '', type: result.type || 'output' });
      const response = await fetch(`${c.url}/view?${query}`, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw Error(`image download failed: HTTP ${response.status}`);
      const source = Buffer.from(await response.arrayBuffer()), img = decodePNG(source);
      if (img.width < j.width || img.height < j.height) throw Error(`ComfyUI returned an undersized image for ${j.name}`);
      atomic(join(stateDir, id + '-source.png'), source);
      atomic(cached, encodePNG(resizeNearest(img, j.width, j.height)));
      copyFileSync(cached, out);
      record.done = true; record.finished = new Date().toISOString(); save();
      // A successfully replaced picture needs a fresh visual review.
      const drops = join(art, 'drop.txt');
      if (existsSync(drops)) atomic(drops, readFileSync(drops, 'utf8').split(/\r?\n/).filter(n => n.trim() !== j.name).join('\n'));
      console.log(`done ${j.name}: ${j.width}x${j.height}`);
    }
    console.log(`Next: node clean.mjs --trip ${a.trip}`);
  } finally { if (fd !== undefined) { closeSync(fd); unlinkSync(lock); } }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
