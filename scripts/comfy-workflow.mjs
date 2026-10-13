// Standard ComfyUI nodes only: SDXL + Pixel Art XL, one image per prompt.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJSON, newImage } from './lib.mjs';

export function configuration(a = {}) {
  const file = a.config || process.env.PIXEL_PATH_CONFIG || join(homedir(), '.config/pixel-path/comfy.json');
  const c = { url: 'http://127.0.0.1:8188', checkpoint: 'sd_xl_base_1.0.safetensors', lora: 'pixel-art-xl.safetensors',
    vae: 'sdxl.vae.safetensors', steps: 25, cfg: 7, strength: 1, timeout: 900, ...readJSON(file, {}) };
  c.url = a.url || process.env.COMFYUI_URL || c.url;
  for (const k of ['checkpoint', 'lora', 'vae', 'steps', 'cfg', 'strength', 'timeout']) if (a[k] !== undefined) c[k] = a[k];
  for (const k of ['steps', 'cfg', 'strength', 'timeout']) c[k] = Number(c[k]);
  if (!Number.isInteger(c.steps) || c.steps < 1 || c.steps > 150 || !(c.cfg > 0 && c.cfg <= 30) ||
      !(c.strength > 0 && c.strength <= 2) || !(c.timeout > 0 && c.timeout <= 86400)) throw Error('invalid generation settings');
  const u = new URL(c.url);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw Error('ComfyUI URL must be HTTP(S) without embedded credentials');
  c.url = c.url.replace(/\/$/, '');
  return c;
}

export function validateJob(j) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(j.name)) throw Error(`invalid asset name: ${j.name}`);
  if (typeof j.prompt !== 'string' || !j.prompt.trim()) throw Error(`missing prompt: ${j.name}`);
  if (!Number.isSafeInteger(j.seed) || j.seed < 0) throw Error(`invalid seed: ${j.name}`);
  for (const k of ['width', 'height']) if (!Number.isInteger(j[k]) || j[k] < 16 || j[k] > 1024) throw Error(`invalid ${k}: ${j.name}`);
}

export function dimensions(j) {
  // Approximately one megapixel; latent dimensions must be multiples of 64.
  const scale = Math.sqrt(1024 * 1024 / (j.width * j.height));
  return { width: Math.max(512, Math.min(1536, Math.round(j.width * scale / 64) * 64)),
    height: Math.max(512, Math.min(1536, Math.round(j.height * scale / 64) * 64)) };
}

export function workflow(j, c, seed) {
  const size = dimensions(j);
  const surface = j.style === 'surface';
  const natural = j.style === 'natural' || surface || j.style === 'material' || j.style === 'botanical';
  const positive = j.style === 'botanical'
    ? `(photorealistic 3D rendering:1.3), (one entire small tree:1.5), ${j.prompt}, miniature whole botanical specimen, vivid green foliage, fully visible from crown to trunk base, small object centered with vast empty margins, completely solid magenta background, no ground plane`
    : j.style === 'material'
    ? `photorealistic seamless natural material texture, ${j.prompt}, material fills the entire image edge to edge, flat diffuse illumination, detailed surface, no object silhouette`
    : surface
    ? `photorealistic architectural material texture, ${j.prompt}, flat orthographic front elevation, parallel vertical and horizontal lines, soft overcast light, natural muted colors, wall fills the entire rectangular frame edge to edge, detailed weathered materials`
    : natural && j.kind === 'sprite'
    ? `photorealistic cutout, (one single complete tree:1.4), (entire tree visible:1.4), ${j.prompt}, (wide white margins:1.3), natural foliage, diffuse daylight`
    : natural
    ? `architectural reference photograph, natural materials and restrained colors, ${j.prompt}, single isolated subject, pure white background, generous white margin, diffuse daylight, sharp detail`
    : `pixel art, ${j.prompt}, simple flat colors, single isolated subject, pure white background, generous white margin`;
  const negative = natural
    ? `${surface ? 'roof, sky, road, pavement, grass, tree, border, white background, building silhouette, ' : ''}cartoon, illustration, game asset, oversaturated, fantasy, isometric, perspective, angled view, multiple objects, scenery, landscape, sky, ground, grass base, cast shadow, cropped, cut off, frame, text, watermark, logo`
    : 'photograph, realistic, 3d render, isometric, perspective, angled view, multiple objects, scenery, landscape, sky, ground, grass base, cast shadow, cropped, cut off, frame, text, watermark, logo';
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: c.checkpoint } },
    '2': { class_type: 'LoraLoader', inputs: { model: ['1', 0], clip: ['1', 1], lora_name: c.lora, strength_model: natural ? 0 : c.strength, strength_clip: natural ? 0 : c.strength } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 1], text: positive } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 1], text: [negative, j.negative].filter(Boolean).join(', ') } },
    '5': { class_type: 'EmptyLatentImage', inputs: { ...size, batch_size: 1 } },
    '6': { class_type: 'KSampler', inputs: { model: ['2', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0], seed, steps: c.steps, cfg: c.cfg, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
    '7': { class_type: 'VAELoader', inputs: { vae_name: c.vae } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['7', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: `pixel-path/${j.name}` } },
  };
}

export function resizeNearest(img, width, height) {
  const out = newImage(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (Math.min(img.height - 1, Math.floor((y + 0.5) * img.height / height)) * img.width +
      Math.min(img.width - 1, Math.floor((x + 0.5) * img.width / width))) * 4;
    out.data.set(img.data.subarray(src, src + 4), (y * width + x) * 4);
  }
  return out;
}

// Remap only after background removal, so pale palette colors cannot trap the backdrop.
export function remapPalette(img, palette) {
  const colors = [...new Map(Array.from({ length: palette.width * palette.height }, (_, i) => {
    const c = [...palette.data.subarray(i * 4, i * 4 + 4)]; return [c.slice(0, 3).join(','), c];
  }).filter(([, c]) => c[3] > 0)).values()];
  if (!colors.length) throw Error('palette has no opaque colors');
  const cache = new Map();
  for (let i = 0; i < img.data.length; i += 4) {
    if (!img.data[i + 3]) continue;
    const [r, g, b] = img.data.subarray(i, i + 3), key = (r << 16) | (g << 8) | b;
    let best = cache.get(key);
    if (!best) { let distance = Infinity; for (const c of colors) {
      const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
      if (d < distance) { distance = d; best = c; }
    } cache.set(key, best); }
    img.data.set(best.slice(0, 3), i);
  }
}
