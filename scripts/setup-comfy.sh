#!/usr/bin/env bash
# Run on the NVIDIA Linux machine. Installs into an isolated directory without changing services.
set -euo pipefail
root="${PIXEL_PATH_COMFY_DIR:-$HOME/pixel-path/ComfyUI}"
revision=b0b743566f65daafc423b4fea8a2fbda94b3384a
command -v nvidia-smi >/dev/null
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
if [[ ! -d "$root" ]]; then
  git clone --depth 1 --branch v0.39.0 https://github.com/Comfy-Org/ComfyUI.git "$root"
fi
if [[ "$(git -C "$root" rev-parse HEAD)" != "$revision" ]]; then
  echo "Expected ComfyUI $revision at $root; use a separate PIXEL_PATH_COMFY_DIR." >&2
  exit 1
fi
python3 -m venv "$root/.venv"
"$root/.venv/bin/pip" install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
"$root/.venv/bin/pip" install -r "$root/requirements.txt"
fetch_model() {
  local url="$1" destination="$2" digest="$3"
  mkdir -p "$(dirname "$destination")"
  if [[ ! -f "$destination" ]]; then
    curl -fL --retry 4 -C - -o "$destination.part" "$url"
    printf '%s  %s\n' "$digest" "$destination.part" | sha256sum --check
    mv "$destination.part" "$destination"
  fi
  printf '%s  %s\n' "$digest" "$destination" | sha256sum --check
}
fetch_model \
  https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/462165984030d82259a11f4367a4eed129e94a7b/sd_xl_base_1.0.safetensors \
  "$root/models/checkpoints/sd_xl_base_1.0.safetensors" \
  31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b
fetch_model \
  https://huggingface.co/nerijs/pixel-art-xl/resolve/8bf4a4d9ea283e00a51fafda8e0539f8248ea037/pixel-art-xl.safetensors \
  "$root/models/loras/pixel-art-xl.safetensors" \
  4234637cb80c998f41e348e6a6cb6bc20d8d038b2b0f256b6129b3b5e353eef7
fetch_model \
  https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/resolve/207b116dae70ace3637169f1ddd2434b91b3a8cd/sdxl.vae.safetensors \
  "$root/models/vae/sdxl.vae.safetensors" \
  235745af8d86bf4a4c1b5b4f529868b37019a10f7c0b2e79ad0abca3a22bc6e1
"$root/.venv/bin/pip" freeze > "$root/pixel-path-environment.txt"
"$root/.venv/bin/python" -c 'import torch; assert torch.cuda.is_available(); print(torch.__version__, torch.cuda.get_device_name())'
printf 'Ready. Run: cd %q && .venv/bin/python main.py --listen 127.0.0.1 --port 8188 --offline\n' "$root"
