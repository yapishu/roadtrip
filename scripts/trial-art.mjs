// Four representative assets for checking a local diffusion setup before a route-sized run.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { args, writeJSON } from './lib.mjs';
import { FACADES, SPRITES, RECIPE } from './kit.mjs';

const a = args();
if (!a.trip) throw Error('usage: node trial-art.mjs --trip TRIP');
const file = join(a.trip, 'art/plan.json');
if (existsSync(file)) throw Error(`${file} exists; use a new trial folder`);
const palette = join(dirname(fileURLToPath(import.meta.url)), '../templates/palette.png');
const subjects = {
  house: 'one two-storey honey-colored stone English house with a red tiled roof, a centered dark front door and four sash windows',
  shop: 'one two-storey red brick English shop building with a dark green wooden shopfront, blank signboard and two upper windows',
  tree: 'one mature English oak tree with a rounded green crown and a single brown trunk',
  church: 'one small English stone parish church with a square bell tower, arched doorway and tall arched windows',
};
writeJSON(file, { detail: 'trial', themes: [{ id: 'trial', from: 0, name: 'English town' }], landmarks: {},
  jobs: Object.entries(subjects).map(([role, subject], i) => {
    const size = FACADES[role] || SPRITES[role], kind = role === 'tree' ? 'sprite' : 'facade';
    return { name: `trial-${role}`, role, theme: 'trial', kind, width: size.w, height: size.h, hm: size.hm,
      seed: 1000 + i, palette, prompt: RECIPE[kind](subject) };
  }) }, true);
console.log(`Wrote ${file}: house, shop, tree, church. Next: node comfy.mjs run --trip ${a.trip}`);
