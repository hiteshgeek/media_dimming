/*
 * Media Layer - brightness limiter for YouTube.
 *
 * SELECTIVE MODE (default) - spatially selective, per pixel.
 *   A grey layer with `mix-blend-mode: darken` over the video composites to
 *   min(pixel, ceiling) on every pixel independently. Only pixels brighter
 *   than the ceiling move; everything already darker passes through
 *   untouched. A bright window in one corner gets capped while the rest of
 *   the frame is left exactly as it is. No global brightness change at all.
 *
 *   The ceiling is dynamic, and moves for two reasons:
 *     - AREA. A frame that is 90% white delivers far more light to the eye
 *       than one with a single bright lamp, even though both peak at the
 *       same value. So the ceiling drops as the bright *fraction* of the
 *       frame grows.
 *     - FLASH. A sudden jump in source luminance drops the ceiling hard for
 *       a moment, then releases. Still per pixel - the dark parts of the
 *       frame never change.
 *
 * WHOLE FRAME MODE - the classic global limiter, `filter: brightness()` on
 *   the video element driven by --ml-gain, for when you want everything
 *   brought down evenly.
 *
 * Frame measurement is a 48x27 canvas readback of the *source* video, so it
 * sees the real signal, not the already-limited result.
 */
(() => {
  'use strict';
  if (window.__mediaLayerActive) return;
  window.__mediaLayerActive = true;

  const DEFAULTS = {
    enabled: true,
    mode: 'clip',       // 'clip' = per-pixel ceiling | 'dim' = global brightness
    testMode: false,
    hardCeiling: 0.38,  // no pixel may exceed this
    clipStrength: 1.0,  // 1 = hard clip, lower = softer ratio
    areaComp: 0.45,     // how much to lower the ceiling as bright area grows
    maxContrast: 4,     // cap brightest pixel at N x the scene's own level (0 = off)
    minCeiling: 0.10,   // contrast adaptation never pushes below this
    clipEngine: 'blend',// 'blend' = darken layer | 'filter' = SVG curve on the video
    flashCeil: 0.45,    // ceiling multiplier during a flash
    ceiling: 0.35,      // whole-frame mode: target average level
    maxDim: 0.80,       // whole-frame mode: how far gain may go
    baseDim: 0.00,      // always-on global dim (both modes)
    attackMs: 35,
    releaseMs: 1200,
    flashGuard: true,
    flashDelta: 0.12,   // measured on the SOURCE signal, 0-1
    holdMs: 400,
    peakWeight: 0.45,
    sampleHz: 50
  };

  let cfg = { ...DEFAULTS };
  const state = {
    lum: 0, shown: 0, gain: 1, target: 1,
    ceilMul: 1, ceilTarget: 1, effCeiling: 1, brightArea: 0, ambient: 0,
    blackFrames: 0, hasVideo: false, readable: true, attached: false
  };
  let announced = false;

  chrome.storage.sync.get(DEFAULTS, (v) => { cfg = { ...DEFAULTS, ...v }; applyStatic(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k of Object.keys(changes)) cfg[k] = changes[k].newValue;
    applyStatic();
  });

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const root = document.documentElement;

  function setGain(g) { root.style.setProperty('--ml-gain', g.toFixed(3)); }

  // Second clip engine: an SVG transfer curve applied to the video element
  // itself. Same path as the brightness filter, so it survives cases where a
  // blended overlay does not reach the video (hardware overlay planes,
  // fullscreen compositing, a stacking context we did not anticipate).
  const NT = 17;   // table points; piecewise-linear between them
  let funcs = null;

  function buildFilter() {
    if (funcs) return;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    const f = document.createElementNS(NS, 'filter');
    f.setAttribute('id', 'ml-clip');
    // sRGB, not the linearRGB default, so the curve matches the blend maths
    f.setAttribute('color-interpolation-filters', 'sRGB');
    const ct = document.createElementNS(NS, 'feComponentTransfer');
    funcs = ['feFuncR', 'feFuncG', 'feFuncB'].map(tag => {
      const fn = document.createElementNS(NS, tag);
      fn.setAttribute('type', 'table');
      ct.appendChild(fn);
      return fn;
    });
    f.appendChild(ct); svg.appendChild(f);
    (document.body || document.documentElement).appendChild(svg);
  }

  function filterTable(c, s) {
    const out = [];
    for (let k = 0; k < NT; k++) {
      const x = k / (NT - 1);
      out.push((x * (1 - s) + Math.min(x, c) * s).toFixed(4));
    }
    return out.join(' ');
  }

  let lastCeilByte = -1;
  function setCeiling(c) {
    const b = Math.round(clamp(c, 0.02, 1) * 255);
    if (b === lastCeilByte) return;          // avoid redundant style writes
    lastCeilByte = b;
    if (cfg.clipEngine === 'filter') {
      buildFilter();
      const tv = filterTable(b / 255, clamp(cfg.clipStrength, 0, 1));
      for (const fn of funcs) fn.setAttribute('tableValues', tv);
    } else if (clipLayer) {
      clipLayer.style.backgroundColor = 'rgb(' + b + ',' + b + ',' + b + ')';
    }
  }

  // Everything that depends only on settings, not on the current frame.
  function applyStatic() {
    root.classList.toggle('ml-active', !!cfg.enabled);
    if (!cfg.enabled) setGain(1);
    const onFilter = cfg.enabled && cfg.mode === 'clip' && !cfg.testMode
                     && cfg.clipEngine === 'filter';
    if (onFilter) buildFilter();
    root.classList.toggle('ml-clipfilter', onFilter);
    lastCeilByte = -1;
    if (!clipLayer) return;
    // Test mode always uses the overlay, since proving attachment is its job.
    const useLayer = cfg.enabled && cfg.clipEngine !== 'filter'
                     && (cfg.mode === 'clip' || cfg.testMode) || (cfg.enabled && cfg.testMode);
    clipLayer.classList.toggle('ml-test', !!cfg.testMode);
    clipLayer.style.opacity = useLayer ? clamp(cfg.clipStrength, 0, 1).toFixed(3) : '0';
  }

  // ---- frame sampling -------------------------------------------------
  const SW = 48, SH = 27;
  const canvas = document.createElement('canvas');
  canvas.width = SW; canvas.height = SH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  const hist = new Uint16Array(64);

  function sampleFrame(v) {
    try { ctx.drawImage(v, 0, 0, SW, SH); } catch (e) { return null; }
    let data;
    try { data = ctx.getImageData(0, 0, SW, SH).data; } catch (e) { return null; }

    hist.fill(0);
    const n = SW * SH;
    let sum = 0, lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Rec.709 luma - perceptual brightness, green weighted far above blue
      const y = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      sum += y;
      if (y > 0.01) lit++;
      let b = (y * 63) | 0; if (b > 63) b = 63;
      hist[b]++;
    }
    state.blackFrames = lit === 0 ? state.blackFrames + 1 : 0;

    const want = n * 0.08;      // 92nd percentile: a bright panel on a dark frame
    let acc = 0, bin = 63;
    for (let b = 63; b >= 0; b--) { acc += hist[b]; if (acc >= want) { bin = b; break; } }

    return { raw: sum / n, peak: (bin + 0.5) / 64, n };
  }

  // The scene's own working level. Median, not mean, so a small patch of
  // blazing text cannot drag it upwards and excuse itself.
  function medianLuma(n) {
    let acc = 0; const half = n * 0.5;
    for (let b = 0; b < 64; b++) { acc += hist[b]; if (acc >= half) return (b + 0.5) / 64; }
    return 1;
  }

  // Fraction of the frame above a level, and the mean once clipped to it.
  function clipStats(c, n) {
    let above = 0, sumC = 0;
    for (let b = 0; b < 64; b++) {
      const h = hist[b];
      if (!h) continue;
      const y = (b + 0.5) / 64;
      if (y > c) { above += h; sumC += h * c; } else { sumC += h * y; }
    }
    return { frac: above / n, mean: sumC / n };
  }

  // ---- ceiling layer --------------------------------------------------
  let clipLayer = null, host = null;

  function ensureLayer(v) {
    // Sits below captions and player chrome in the stacking order, so it
    // never touches subtitles or controls.
    const h = v.closest('.html5-video-container') || v.parentElement;
    if (!h) return;
    if (host === h && clipLayer && clipLayer.isConnected) return;
    if (clipLayer) clipLayer.remove();
    clipLayer = document.createElement('div');
    clipLayer.className = 'ml-clip-layer';
    clipLayer.setAttribute('aria-hidden', 'true');
    h.style.isolation = 'isolate';   // confine the blend to this container
    h.appendChild(clipLayer);
    host = h;
    state.attached = true;
    lastCeilByte = -1;
    applyStatic();
  }

  function findVideo() {
    const vids = document.getElementsByTagName('video');
    let fallback = null;
    for (let i = 0; i < vids.length; i++) {
      const v = vids[i];
      if (!v.videoWidth) continue;
      if (!v.paused && !v.ended) return v;
      if (!fallback) fallback = v;
    }
    return fallback;
  }

  // ---- limiter loop ---------------------------------------------------
  let lastTick = 0, holdUntil = 0, prevRaw = null;

  function smooth(cur, target, dt, snap) {
    if (snap && target < cur) return target;          // flash edge: no ramp
    const tau = target < cur ? cfg.attackMs : cfg.releaseMs;
    const next = cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1, tau)));
    // Exponentials only approach their target, so land it rather than crawl.
    return Math.abs(target - next) < 0.004 ? target : next;
  }

  function tick(ts) {
    requestAnimationFrame(tick);

    if (!cfg.enabled) return;
    const interval = 1000 / Math.max(10, Math.min(60, cfg.sampleHz));
    if (ts - lastTick < interval) return;
    const dt = Math.min(250, lastTick ? ts - lastTick : interval);
    lastTick = ts;
    if (document.hidden) return;

    let snap = false;
    const v = findVideo();
    state.hasVideo = !!v;
    if (!v) return;
    ensureLayer(v);

    if (!announced) {
      announced = true;
      console.log('[Media Layer] active -', v.videoWidth + 'x' + v.videoHeight,
        '| layer attached:', state.attached, '| mode:', cfg.mode);
    }

    const selective = cfg.mode === 'clip' && !cfg.testMode;

    // A paused frame is still on screen, so hold rather than release.
    if (!v.paused && !v.ended) {
      const s = sampleFrame(v);
      state.readable = !!s && state.blackFrames < cfg.sampleHz * 6;

      if (s) {
        state.lum = s.raw;

        // Flash detection runs on the SOURCE signal. Measuring the already
        // limited result would squeeze it into a narrow range and make the
        // threshold fire on every ordinary cut.
        const rise = prevRaw === null ? 0 : s.raw - prevRaw;
        prevRaw = s.raw;
        const flash = cfg.flashGuard && rise > cfg.flashDelta && s.raw > cfg.ceiling;
        if (flash) { holdUntil = ts + cfg.holdMs; snap = true; }
        const holding = ts < holdUntil;

        if (selective) {
          // Per-pixel only. The global gain stays at 1 so dark areas of the
          // frame are never touched.
          // Measure the bright fraction against the FIXED nominal ceiling.
          // Measuring against the effective one would feed back on itself:
          // a lower ceiling puts more pixels above it, lowering it further.
          const st = clipStats(cfg.hardCeiling, s.n);
          state.brightArea = st.frac;
          let cm = 1 - clamp(cfg.areaComp, 0, 0.9) * st.frac;

          // Dark-scene adaptation. An absolute cap is the wrong measure on a
          // dark shot: your eyes are adapted to the gloom, so white titles at
          // the ceiling are still a glare. Hold the brightest pixel to a fixed
          // multiple of the scene's own level instead.
          if (cfg.maxContrast > 0) {
            const amb = medianLuma(s.n);
            state.ambient = amb;
            const lim = Math.max(cfg.minCeiling, amb * cfg.maxContrast);
            cm = Math.min(cm, clamp(lim / cfg.hardCeiling, 0.05, 1));
          }

          if (holding) cm = Math.min(cm, clamp(cfg.flashCeil, 0.1, 1));
          state.ceilTarget = cm;
          state.target = 1 - clamp(cfg.baseDim, 0, 0.6);
          state.shown = clipStats(state.effCeiling, s.n).mean;
        } else {
          // Whole-frame mode: classic global limiter off the raw signal.
          const L = s.raw * (1 - cfg.peakWeight) + s.peak * cfg.peakWeight;
          const floor = 1 - clamp(cfg.maxDim, 0, 0.92);
          let target = L > cfg.ceiling ? cfg.ceiling / L : 1;
          if (target < floor) target = floor;
          if (holding) target = Math.min(target, floor);
          state.ceilTarget = 1;
          state.target = target * (1 - clamp(cfg.baseDim, 0, 0.6));
          state.shown = L * state.target;
        }
      } else {
        // DRM stream: pixels unreadable. In selective mode the ceiling still
        // works, since it needs no pixel access; only the analysis goes idle.
        state.ceilTarget = 1;
        state.target = 1 - clamp(cfg.baseDim, 0, 0.6);
      }
    }

    state.gain = smooth(state.gain, state.target, dt, snap);
    state.ceilMul = smooth(state.ceilMul, state.ceilTarget, dt, snap);
    state.effCeiling = clamp(cfg.hardCeiling * state.ceilMul, 0.03, 1);

    setGain(state.gain);
    if (selective) setCeiling(state.effCeiling);
  }

  applyStatic();
  requestAnimationFrame(tick);

  document.addEventListener('yt-navigate-finish', () => {
    prevRaw = null;
    if (clipLayer) clipLayer.remove();
    clipLayer = null; host = null; state.attached = false; lastCeilByte = -1;
  });

  // ---- popup bridge ---------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg && msg.type === 'ml-status') {
      respond({
        hasVideo: state.hasVideo,
        attached: cfg.clipEngine === 'filter' ? !!funcs : state.attached,
        readable: state.readable,
        selective: cfg.mode === 'clip',
        engine: cfg.clipEngine,
        ambient: state.ambient,
        lum: state.lum,
        shown: state.shown,
        ceiling: state.effCeiling,
        brightArea: state.brightArea,
        dim: clamp(1 - state.gain, 0, 1)
      });
    }
  });
})();
