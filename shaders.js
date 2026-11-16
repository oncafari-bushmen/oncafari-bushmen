// Paper Shaders: the paper grain behind the page. The photographs are dithered
// in the source files themselves, so nothing filters them at runtime. The
// background is static (speed 0); project bullets use animated dithering effects.
const paper = window.PaperShaders;

// ShaderMount inserts its canvas before it tries to create the WebGL context, so
// a mount that throws leaves a stray canvas behind. Take the container back to
// exactly how we found it, otherwise that canvas sits in flow and shifts the page.
function unmount(container) {
  container.removeAttribute("data-paper-shader");
  container.querySelectorAll(":scope > canvas").forEach((canvas) => {
    canvas.remove();
  });
}

// Resolves once an image is usable as a WebGL texture. This waits on `load`
// rather than `decode()` on purpose: Chrome leaves decode() pending while the
// document is hidden, which would leave a backgrounded tab untextured forever.
function whenLoaded(image) {
  if (image.complete && image.naturalWidth) return Promise.resolve(image);
  return new Promise((resolve, reject) => {
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", reject, { once: true });
  });
}

// Small source images are upscaled before becoming textures, matching what the
// library's own React wrapper does so the shaders sample at their intended scale.
function loadTexture(src) {
  const image = new Image();
  image.src = src;
  return whenLoaded(image).then(() => {
    if (
      image.naturalWidth >= 1 &&
      image.naturalHeight >= 1 &&
      image.naturalWidth < 1024 &&
      image.naturalHeight < 1024
    ) {
      const aspect = image.naturalWidth / image.naturalHeight;
      image.width = Math.round(aspect > 1 ? 1024 * aspect : 1024);
      image.height = Math.round(aspect > 1 ? 1024 : 1024 / aspect);
    }
    return image;
  });
}

// The library's sizing defaults, under the uniform names the shaders declare.
const sizing = {
  u_fit: paper?.ShaderFitOptions.cover,
  u_scale: 1,
  u_rotation: 0,
  u_offsetX: 0,
  u_offsetY: 0,
  u_originX: 0.5,
  u_originY: 0.5,
  u_worldWidth: 0,
  u_worldHeight: 0,
};

function mountPaperTexture() {
  const container = document.querySelector("#paper-bg");
  if (!container) return;

  // No image filter here, just the bare texture: a transparent pixel keeps the
  // shader's image layer out of the way.
  Promise.all([
    loadTexture(paper.emptyPixel),
    loadTexture(paper.getShaderNoiseTexture().src),
  ])
    .then(([empty, noise]) => {
      new paper.ShaderMount(container, paper.paperTextureFragmentShader, {
        ...sizing,
        u_image: empty,
        u_noiseTexture: noise,
        u_colorBack: paper.getShaderColorFromString("#0a0a0a"),
        u_colorFront: paper.getShaderColorFromString("#222222"),
        u_contrast: 0.18,
        u_roughness: 0.34,
        u_fiber: 0.22,
        u_fiberSize: 0.2,
        u_crumples: 0.13,
        u_crumpleSize: 0.35,
        u_folds: 0.14,
        u_foldCount: 3,
        u_fade: 0,
        u_drops: 0.06,
        u_seed: 5.8,
        u_scale: 0.6,
      });
      container.classList.add("is-textured");
    })
    .catch((error) => {
      unmount(container);
      console.warn("Paper texture shader unavailable:", error);
    });
}

function mountProjectBullets() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mounts = [];

  document.querySelectorAll(".project-bullet").forEach((container, index) => {
    try {
      const mount = new paper.ShaderMount(
        container,
        paper.ditheringFragmentShader,
        {
          ...sizing,
          u_colorBack: paper.getShaderColorFromString("#000000"),
          u_colorFront: paper.getShaderColorFromString("#006f9e"),
          u_shape: paper.DitheringShapes.sphere,
          u_type: paper.DitheringTypes["8x8"],
          u_pxSize: 2.8,
          u_scale: 0.6,
        },
        undefined,
        reducedMotion.matches ? 0 : 1,
        // Start each sphere at a different time so their lighting is staggered.
        index * 1000,
      );
      mounts.push(mount);
      // ShaderMount draws its first correctly sized frame in a ResizeObserver.
      // Reveal on the following frame, keeping the reserved space empty until then.
      const readyObserver = new ResizeObserver(([entry]) => {
        if (!entry.contentRect.width || !entry.contentRect.height) return;
        readyObserver.disconnect();
        requestAnimationFrame(() => container.classList.add("is-textured"));
      });
      readyObserver.observe(container);
    } catch (error) {
      unmount(container);
      console.warn("Project bullet shader unavailable:", error);
    }
  });

  // ShaderMount already pauses offscreen and in hidden tabs.
  reducedMotion.addEventListener("change", () => {
    mounts.forEach((mount) => mount.setSpeed(reducedMotion.matches ? 0 : 1));
  });
}

if (paper) {
  mountPaperTexture();
  mountProjectBullets();
}
