// Align the scene's pixel grid with the display's physical pixels.
export function fitPixelCanvas(canvas, requestedScale = 0) {
  const ratio = devicePixelRatio || 1;
  const screenWidth = Math.round(innerWidth * ratio), screenHeight = Math.round(innerHeight * ratio);
  const requested = Number(requestedScale);
  const scale = Math.max(1, Math.round(Number.isFinite(requested) && requested > 0
    ? requested : Math.max(screenWidth / 320, screenHeight / 260)));
  const width = Math.ceil(screenWidth / scale), height = Math.ceil(screenHeight / scale);
  // Any partial block sits beyond the viewport; visible pixels keep equal sizes.
  canvas.style.width = width * scale / ratio + 'px';
  canvas.style.height = height * scale / ratio + 'px';
  canvas.style.left = -Math.floor((width * scale - screenWidth) / 2) / ratio + 'px';
  canvas.style.top = -Math.floor((height * scale - screenHeight) / 2) / ratio + 'px';
  return { width, height };
}

export function watchPixelViewport(resize) {
  addEventListener('resize', resize);
  function watchDensity() {
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => {
      resize();
      watchDensity();
    }, { once: true });
  }
  watchDensity();
  resize();
}
