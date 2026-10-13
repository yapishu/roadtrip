# Local diffusion

## GPU server

Run `scripts/setup-comfy.sh` on an NVIDIA Linux machine with a CUDA 13 compatible driver, Python 3.12+ with
venv support, Git, curl and sha256sum. The script uses `~/pixel-path/ComfyUI` (override with
`PIXEL_PATH_COMFY_DIR`), an isolated Python environment, ComfyUI v0.39.0, and checksum-verified model downloads.
Allow about 20 GB for the environment, models and installation caches. It does not alter other services.

The tested workflow uses standard ComfyUI nodes: SDXL base, Pixel Art XL LoRA, a fixed FP16 VAE, Euler sampler,
25 steps, CFG 7, LoRA strength 1, batch size 1, no refiner. Model sources:

- [SDXL base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0), CreativeML Open RAIL++-M.
- [Pixel Art XL](https://huggingface.co/nerijs/pixel-art-xl), CreativeML Open RAIL-M.
- [FP16 VAE fix](https://huggingface.co/madebyollin/sdxl-vae-fp16-fix), MIT.
- [ComfyUI manual installation](https://docs.comfy.org/installation/manual_install).

The adapter downloads nothing at generation time. The setup needs Internet access to fetch dependencies and
weights; image generation stays on the configured server. No custom or paid API nodes are used.

Start the server from its directory:

```sh
.venv/bin/python main.py --listen 127.0.0.1 --port 8188 --offline
```

For direct LAN access, replace `127.0.0.1` with the GPU machine's LAN address. ComfyUI's API has no authentication;
keep it on the trusted LAN or use an SSH tunnel rather than exposing port 8188 to the Internet. For a tunnel:

```sh
ssh -N -L 8188:127.0.0.1:8188 USER@GPU_HOST
```

A systemd service can keep ComfyUI running after SSH disconnects. Set its working directory to the checkout and
its executable to `.venv/bin/python main.py` with the chosen listen address. Run it as the GPU machine's regular
user. Ensure other model services do not occupy the VRAM when starting a batch.

## Client configuration

Create `~/.config/pixel-path/comfy.json` on the machine running Pixel Path:

```json
{
  "url": "http://GPU_LAN_IP:8188",
  "checkpoint": "sd_xl_base_1.0.safetensors",
  "lora": "pixel-art-xl.safetensors",
  "vae": "sdxl.vae.safetensors",
  "steps": 25,
  "cfg": 7,
  "strength": 1,
  "timeout": 900
}
```

Without a file the endpoint is `http://127.0.0.1:8188`. `--config FILE` or `PIXEL_PATH_CONFIG` selects another
config. Endpoint precedence is `--url`, then `COMFYUI_URL`, then config. Model names and numeric settings can also
be passed as CLI flags. `check.mjs --fix` inherits the environment and accepts `--config` and `--url`.

```sh
node scripts/comfy.mjs health
node scripts/trial-art.mjs --trip trips/local-trial
node scripts/comfy.mjs run --trip trips/local-trial
node scripts/clean.mjs --trip trips/local-trial
```

Open the contact sheet before starting a whole kit. Raw RGB/RGBA PNGs have the exact planned dimensions. Sampling
runs near one megapixel at the same aspect ratio (rounded to latent-compatible multiples of 64), then uses
nearest-neighbor downsampling. The model author suggests roughly 8× downsampling; this workflow uses the scale
needed for each planned sprite. Cleanup applies the planned palette to opaque pixels after cutout and validation.
Use `plan-art.mjs --palette none` to retain the model's colors.

## Resuming and tuning

`comfy.mjs status --trip TRIP` lists pending/cached jobs without contacting the GPU. `run` uses a workflow hash
including seed and output size, so changed prompts/settings regenerate only affected pictures. Finished PNGs and
source images are stored in `art/.comfy/`; current raw sprites are copied to `art/raw/`. Keep `.comfy` to preserve
cache and job recovery. Do not publish it.

A submission and its server address are recorded before calling ComfyUI. If the response is lost, the runner
looks up its request marker in the server's queue/history. If history is gone, it reports an uncertain submission
instead of silently duplicating it. Inspect the queue, then explicitly use `--regen NAME` for a fresh attempt.
After a timeout or interrupted download, rerun without `--regen`; the saved prompt ID collects the same result.
`--regen` changes the seed and removes the asset from `drop.txt` only when its replacement is saved successfully.

A per-trip lock prevents concurrent generators. After a killed process, verify its recorded PID is no longer
running before removing `art/.comfy/lock`. Do not delete the job records to recover a lock.

If generation runs out of VRAM, inspect `nvidia-smi` and stop competing workloads only with authorization.
ComfyUI can be launched with `--lowvram` for offloading. For poor art, simplify subjects and emphasize a single
flat front elevation; inspect the full source PNG to distinguish generation problems from cleanup. Do not
silently weaken cleanup to accept cropped or scenic images. Limit automatic retries to two rounds, then adjust
prompts or report the limitation.
