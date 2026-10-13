import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { newImage, fillRect, encodePNG, readPNG, writeJSON } from '../scripts/lib.mjs';
import { configuration, dimensions, resizeNearest, remapPalette } from '../scripts/comfy-workflow.mjs';

const script = resolve('scripts/comfy.mjs');
function run(args, env = {}) {
  return new Promise((ok, reject) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env } });
    let text = ''; child.stdout.on('data', d => text += d); child.stderr.on('data', d => text += d);
    child.on('error', reject); child.on('close', code => ok({ code, text }));
  });
}
async function fixture(t) {
  const trip = mkdtempSync(join(tmpdir(), 'pixel-comfy-')), calls = [], history = {};
  const source = newImage(1024, 1024, [255, 255, 255]); fillRect(source, 220, 180, 600, 670, [90, 60, 40]);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = v => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)); };
    if (url.pathname === '/system_stats') return json({ devices: [{ name: 'test GPU' }] });
    if (url.pathname === '/object_info') return json(Object.fromEntries([
      ['CheckpointLoaderSimple', 'ckpt_name', 'sd_xl_base_1.0.safetensors'], ['LoraLoader', 'lora_name', 'pixel-art-xl.safetensors'], ['VAELoader', 'vae_name', 'sdxl.vae.safetensors'],
    ].map(([node, field, value]) => [node, { input: { required: { [field]: [[value]] } } }])));
    if (url.pathname === '/prompt') {
      let body = ''; for await (const d of req) body += d;
      const job = JSON.parse(body), id = String(calls.length + 1); calls.push(job);
      history[id] = { prompt: [calls.length, id, job.prompt, job.extra_data], status: { status_str: 'success', completed: true },
        outputs: { '9': { images: [{ filename: id + '.png', subfolder: 'pixel-path', type: 'output' }] } } };
      return json({ prompt_id: id, node_errors: {} });
    }
    if (url.pathname === '/queue') return json({ queue_running: [], queue_pending: [] });
    if (url.pathname === '/history') return json(history);
    if (url.pathname.startsWith('/history/')) { const id = url.pathname.split('/').at(-1); return json(history[id] ? { [id]: history[id] } : {}); }
    if (url.pathname === '/view') { res.setHeader('Content-Type', 'image/png'); return res.end(encodePNG(source)); }
    res.writeHead(404); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(trip, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const plan = { themes: [{ id: 'test', from: 0, name: 'test' }], landmarks: {}, jobs: [
    { name: 'house', prompt: 'one house', kind: 'facade', role: 'house', theme: 'test', hm: 8, width: 160, height: 128, seed: 42 },
    { name: 'shop', prompt: 'one shop', kind: 'facade', role: 'shop', theme: 'test', hm: 10, width: 160, height: 160, seed: 43 },
  ] };
  const savePlan = () => writeJSON(join(trip, 'art/plan.json'), plan, true); savePlan();
  const cli = (...args) => run([script, ...args, '--trip', trip, '--url', url, '--config', join(trip, 'config.json')]);
  return { trip, calls, history, plan, savePlan, cli, url };
}

test('generation saves exact RGBA dimensions, reuses outputs, and invalidates changed prompts', async t => {
  const f = await fixture(t);
  let result = await f.cli('run'); assert.equal(result.code, 0, result.text); assert.equal(f.calls.length, 2);
  const img = readPNG(join(f.trip, 'art/raw/house.png'));
  assert.equal(img.width, 160); assert.equal(img.height, 128); assert.equal(img.data.length, 160 * 128 * 4);
  assert.equal(f.calls[0].prompt['5'].inputs.batch_size, 1);
  rmSync(join(f.trip, 'art/raw/house.png'));
  result = await f.cli('run'); assert.equal(result.code, 0, result.text); assert.equal(f.calls.length, 2);
  assert.ok(existsSync(join(f.trip, 'art/raw/house.png')));
  f.plan.jobs[0].prompt = 'one different stone house'; f.savePlan();
  result = await f.cli('run'); assert.equal(result.code, 0, result.text); assert.equal(f.calls.length, 3);
  writeFileSync(join(f.trip, 'art/drop.txt'), 'house\nshop\n');
  result = await f.cli('run', '--regen', 'house'); assert.equal(result.code, 0, result.text);
  assert.equal(f.calls[3].prompt['6'].inputs.seed, 42 + 7919);
  assert.equal(readFileSync(join(f.trip, 'art/drop.txt'), 'utf8'), 'shop\n');
  result = await run([resolve('scripts/clean.mjs'), '--trip', f.trip]); assert.equal(result.code, 0, result.text);
  const kit = JSON.parse(readFileSync(join(f.trip, 'art/kit.json')));
  assert.equal(kit.pictures.house.placeholder, false); assert.equal(kit.pictures.house.drop, false);
  assert.ok(readPNG(join(f.trip, 'art/contact.png')).width > 0);
});

test('resumes a submitted job and recovers a lost submission response without another generation', async t => {
  const f = await fixture(t);
  assert.equal((await f.cli('run', '--only', 'house')).code, 0);
  const path = join(f.trip, 'art/.comfy/jobs.json'), state = JSON.parse(readFileSync(path)), id = Object.keys(state.jobs)[0];
  rmSync(join(f.trip, `art/.comfy/${id}.png`));
  assert.equal((await f.cli('run', '--only', 'house')).code, 0); assert.equal(f.calls.length, 1);
  rmSync(join(f.trip, `art/.comfy/${id}.png`)); delete state.jobs[id].prompt_id; writeJSON(path, state, true);
  const result = await f.cli('run', '--only', 'house'); assert.equal(result.code, 0, result.text); assert.equal(f.calls.length, 1);
});

test('unknown submissions, execution failures and timeouts leave output intact and fail the run', async t => {
  const f = await fixture(t);
  assert.equal((await f.cli('run', '--only', 'house')).code, 0);
  const path = join(f.trip, 'art/.comfy/jobs.json'), state = JSON.parse(readFileSync(path)), id = Object.keys(state.jobs)[0];
  const original = readFileSync(join(f.trip, 'art/raw/house.png'));
  rmSync(join(f.trip, `art/.comfy/${id}.png`)); delete state.jobs[id].prompt_id; state.jobs[id].request = 'not-on-server'; writeJSON(path, state, true);
  let result = await f.cli('run', '--only', 'house'); assert.equal(result.code, 1); assert.match(result.text, /outcome unknown/); assert.equal(f.calls.length, 1);
  state.jobs[id].prompt_id = '1'; writeJSON(path, state, true);
  f.history['1'].outputs = {}; f.history['1'].status = { status_str: 'error', messages: ['out of memory'] };
  result = await f.cli('run', '--only', 'house'); assert.equal(result.code, 1); assert.match(result.text, /out of memory/);
  writeJSON(path, state, true); delete f.history['1'];
  result = await f.cli('run', '--only', 'house', '--timeout', '0.01'); assert.equal(result.code, 1); assert.match(result.text, /timed out/);
  assert.deepEqual(readFileSync(join(f.trip, 'art/raw/house.png')), original); assert.equal(f.calls.length, 1);
});

test('rejects invalid selections and paths before submitting', async t => {
  const f = await fixture(t);
  assert.equal((await f.cli('run', '--only', 'missing')).code, 1);
  f.plan.jobs[0].name = '../escape'; f.savePlan(); assert.equal((await f.cli('run')).code, 1);
  assert.equal(f.calls.length, 0);
});

test('status stays readable during generation while a second writer is rejected', async t => {
  const f = await fixture(t);
  mkdirSync(join(f.trip, 'art/.comfy'));
  writeFileSync(join(f.trip, 'art/.comfy/lock'), '123');
  assert.equal((await f.cli('status')).code, 0);
  const result = await f.cli('run'); assert.equal(result.code, 1); assert.match(result.text, /another generator/);
  assert.equal(f.calls.length, 0);
});

test('pixel resizing and palette mapping preserve alpha and exact palette colors', () => {
  const img = newImage(2, 2); img.data.set([255, 0, 0, 255], 0); img.data.set([0, 255, 0, 0], 4);
  const out = resizeNearest(img, 4, 4); assert.deepEqual([...out.data.slice(0, 8)], [255, 0, 0, 255, 255, 0, 0, 255]);
  const pal = newImage(1, 1, [200, 20, 10]); remapPalette(out, pal);
  assert.deepEqual([...out.data.slice(0, 4)], [200, 20, 10, 255]); assert.equal(out.data[11], 0);
  for (const size of [{ width: 96, height: 96 }, { width: 128, height: 256 }, { width: 256, height: 160 }]) {
    const d = dimensions(size); assert.equal(d.width % 64, 0); assert.equal(d.height % 64, 0);
    assert.ok(Math.abs(d.width / d.height - size.width / size.height) < 0.1);
  }
  assert.throws(() => configuration({ steps: 'bad' }), /settings/);
});
