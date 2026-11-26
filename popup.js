const DEFAULTS = {
  enabled: true, mode: 'clip', testMode: false,
  hardCeiling: 0.38, clipStrength: 1.0, areaComp: 0.45, flashCeil: 0.45,
  maxContrast: 4, minCeiling: 0.10, clipEngine: 'blend',
  ceiling: 0.35, maxDim: 0.80, baseDim: 0.00,
  attackMs: 35, releaseMs: 1200, flashGuard: true, flashDelta: 0.12,
  holdMs: 400, peakWeight: 0.45, sampleHz: 50
};

const PRESETS = {
  gentle: { hardCeiling: 0.60, clipStrength: 0.85, areaComp: 0.30, maxContrast: 7, ceiling: 0.50, maxDim: 0.55, baseDim: 0.00 },
  night:  { hardCeiling: 0.38, clipStrength: 1.00, areaComp: 0.45, maxContrast: 4, ceiling: 0.35, maxDim: 0.80, baseDim: 0.00 },
  strict: { hardCeiling: 0.24, clipStrength: 1.00, areaComp: 0.60, maxContrast: 2.5, ceiling: 0.22, maxDim: 0.88, baseDim: 0.10 }
};

// id -> [slider value to stored, stored to slider value, label text]
const SLIDERS = {
  hardCeiling:  [v => v / 100, v => Math.round(v * 100), v => Math.round(v * 100) + '%'],
  clipStrength: [v => v / 100, v => Math.round(v * 100), v => v >= 0.98 ? 'hard clip' : (1 / (1 - v)).toFixed(1) + ':1'],
  areaComp:     [v => v / 100, v => Math.round(v * 100), v => v <= 0.01 ? 'off' : Math.round(v * 100) + '%'],
  maxContrast:  [v => v / 10,  v => Math.round(v * 10),  v => v <= 0.05 ? 'off' : v.toFixed(1) + '× scene'],
  ceiling:      [v => v / 100, v => Math.round(v * 100), v => Math.round(v * 100) + '%'],
  maxDim:       [v => v / 100, v => Math.round(v * 100), v => Math.round(v * 100) + '%'],
  baseDim:      [v => v / 100, v => Math.round(v * 100), v => v <= 0.005 ? 'off' : Math.round(v * 100) + '%'],
  releaseMs:    [v => v,       v => v,                   v => (v / 1000).toFixed(2) + 's'],
  flashDelta:   [v => v / 100, v => Math.round(v * 100), v => '+' + Math.round(v * 100) + '%']
};

const $ = id => document.getElementById(id);

// Paint the filled portion of a range input via the --p custom property.
function fill(el) {
  const min = +el.min, max = +el.max;
  el.style.setProperty('--p', ((+el.value - min) / (max - min) * 100).toFixed(1) + '%');
}

function matchingPreset(cfg) {
  return Object.keys(PRESETS).find(name =>
    Object.entries(PRESETS[name]).every(([k, v]) => Math.abs(cfg[k] - v) < 0.005)) || null;
}

function render(cfg) {
  $('enabled').checked = cfg.enabled;
  $('flashGuard').checked = cfg.flashGuard;
  $('testMode').checked = cfg.testMode;
  $('e-blend').classList.toggle('sel', cfg.clipEngine !== 'filter');
  $('e-filter').classList.toggle('sel', cfg.clipEngine === 'filter');
  $('seg2').dataset.sel = cfg.clipEngine === 'filter' ? '1' : '0';

  document.body.dataset.mode = cfg.mode;
  $('seg').dataset.sel = cfg.mode === 'dim' ? '1' : '0';
  $('m-clip').classList.toggle('sel', cfg.mode === 'clip');
  $('m-dim').classList.toggle('sel', cfg.mode === 'dim');

  const hit = matchingPreset(cfg);
  for (const name of Object.keys(PRESETS)) $('p-' + name).classList.toggle('sel', name === hit);

  for (const id of Object.keys(SLIDERS)) {
    const [, toSlider, fmt] = SLIDERS[id];
    const el = $(id);
    el.value = toSlider(cfg[id]);
    fill(el);
    $(id + 'v').textContent = fmt(cfg[id]);
  }
  $('panel').classList.toggle('off', !cfg.enabled);
}

const reload = () => chrome.storage.sync.get(DEFAULTS, render);
reload();

for (const id of Object.keys(SLIDERS)) {
  $(id).addEventListener('input', (e) => {
    const [toStore, , fmt] = SLIDERS[id];
    const stored = toStore(+e.target.value);
    fill(e.target);
    $(id + 'v').textContent = fmt(stored);
    chrome.storage.sync.set({ [id]: stored });
    // a manual tweak means it is no longer exactly a preset
    chrome.storage.sync.get(DEFAULTS, (c) => {
      const hit = matchingPreset(c);
      for (const n of Object.keys(PRESETS)) $('p-' + n).classList.toggle('sel', n === hit);
    });
  });
}

$('enabled').addEventListener('change', (e) => {
  chrome.storage.sync.set({ enabled: e.target.checked });
  $('panel').classList.toggle('off', !e.target.checked);
});
$('flashGuard').addEventListener('change', e => chrome.storage.sync.set({ flashGuard: e.target.checked }));
$('testMode').addEventListener('change', e => chrome.storage.sync.set({ testMode: e.target.checked }));

const setMode = async (mode) => { await chrome.storage.sync.set({ mode }); reload(); };
$('m-clip').addEventListener('click', () => setMode('clip'));
$('m-dim').addEventListener('click', () => setMode('dim'));

const setEngine = async (clipEngine) => { await chrome.storage.sync.set({ clipEngine }); reload(); };
$('e-blend').addEventListener('click', () => setEngine('blend'));
$('e-filter').addEventListener('click', () => setEngine('filter'));

for (const name of Object.keys(PRESETS)) {
  $('p-' + name).addEventListener('click', async () => { await chrome.storage.sync.set(PRESETS[name]); reload(); });
}
$('reset').addEventListener('click', async () => { await chrome.storage.sync.set(DEFAULTS); reload(); });

// ---- live meter ----
function setStatus(cls, text) {
  $('status').innerHTML = '<span class="dot ' + cls + '"></span>' + text;
}

async function poll() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'ml-status' });
    if (!r) return;

    const pct = x => Math.round(Math.max(0, Math.min(1, x || 0)) * 100);
    $('lumbar').style.width = pct(r.lum) + '%';
    $('showbar').style.width = pct(r.shown) + '%';
    $('lumv').textContent = pct(r.lum) + '%';
    $('showv').textContent = pct(r.shown) + '%';

    // tick on the source meter showing where the ceiling currently sits
    const mark = $('ceilmark');
    if (r.selective && r.hasVideo) {
      mark.style.left = pct(r.ceiling) + '%';
      mark.style.opacity = '.85';
    } else {
      mark.style.opacity = '0';
    }

    $('areav').textContent = !r.hasVideo ? ''
      : r.selective
        ? pct(r.brightArea) + '% over ceiling · scene level ' + pct(r.ambient) + '% · capped at ' + pct(r.ceiling) + '%'
        : 'Whole frame dimmed by ' + pct(r.dim) + '%';

    if (!r.hasVideo) setStatus('', 'No video on this tab');
    else if (!r.attached) setStatus('bad', 'Layer not attached to the player');
    else if (!r.readable) setStatus('warn', 'Pixels unreadable (DRM) — ceiling still applies');
    else setStatus('ok', 'Active');
  } catch (e) {
    $('areav').textContent = '';
    $('ceilmark').style.opacity = '0';
    setStatus('', 'Not connected — open or reload a YouTube tab');
  }
}
poll();
setInterval(poll, 160);
