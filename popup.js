const DEFAULTS = {
  enabled: true, mode: 'clip', testMode: false,
  hardCeiling: 0.38, clipStrength: 1.0, areaComp: 0.45, flashCeil: 0.45,
  ceiling: 0.35, maxDim: 0.80, baseDim: 0.00,
  attackMs: 35, releaseMs: 1200, flashGuard: true, flashDelta: 0.12,
  holdMs: 400, peakWeight: 0.45, sampleHz: 50
};

const PRESETS = {
  gentle: { hardCeiling: 0.60, clipStrength: 0.85, areaComp: 0.30, ceiling: 0.50, maxDim: 0.55, baseDim: 0.00 },
  night:  { hardCeiling: 0.38, clipStrength: 1.00, areaComp: 0.45, ceiling: 0.35, maxDim: 0.80, baseDim: 0.00 },
  strict: { hardCeiling: 0.24, clipStrength: 1.00, areaComp: 0.60, ceiling: 0.22, maxDim: 0.88, baseDim: 0.10 }
};

// slider id -> [value stored, slider position, label]
const SLIDERS = {
  hardCeiling:  [v => v / 100, v => Math.round(v * 100), v => Math.round(v * 100) + '%'],
  clipStrength: [v => v / 100, v => Math.round(v * 100), v => v >= 0.98 ? 'hard clip' : 'ratio ' + (1 / (1 - v)).toFixed(1) + ':1'],
  areaComp:     [v => v / 100, v => Math.round(v * 100), v => v <= 0.01 ? 'off' : Math.round(v * 100) + '%'],
  ceiling:      [v => v / 100, v => Math.round(v * 100), v => Math.round(v * 100) + '%'],
  maxDim:       [v => v / 100, v => Math.round(v * 100), v => Math.round(v * 100) + '%'],
  baseDim:      [v => v / 100, v => Math.round(v * 100), v => Math.round(v * 100) + '%'],
  releaseMs:    [v => v,       v => v,                   v => (v / 1000).toFixed(2) + 's'],
  flashDelta:   [v => v / 100, v => Math.round(v * 100), v => 'trigger at +' + Math.round(v * 100) + '%']
};
const $ = id => document.getElementById(id);

function render(cfg) {
  $('enabled').checked = cfg.enabled;
  $('flashGuard').checked = cfg.flashGuard;
  $('testMode').checked = cfg.testMode;
  $('m-clip').classList.toggle('sel', cfg.mode === 'clip');
  $('m-dim').classList.toggle('sel', cfg.mode === 'dim');
  for (const id of Object.keys(SLIDERS)) {
    const [, toSlider, fmt] = SLIDERS[id];
    $(id).value = toSlider(cfg[id]);
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
    $(id + 'v').textContent = fmt(stored);
    chrome.storage.sync.set({ [id]: stored });
  });
}

$('enabled').addEventListener('change', (e) => {
  chrome.storage.sync.set({ enabled: e.target.checked });
  $('panel').classList.toggle('off', !e.target.checked);
});
$('flashGuard').addEventListener('change', e => chrome.storage.sync.set({ flashGuard: e.target.checked }));
$('testMode').addEventListener('change', e => chrome.storage.sync.set({ testMode: e.target.checked }));

$('m-clip').addEventListener('click', async () => { await chrome.storage.sync.set({ mode: 'clip' }); reload(); });
$('m-dim').addEventListener('click', async () => { await chrome.storage.sync.set({ mode: 'dim' }); reload(); });

for (const name of Object.keys(PRESETS)) {
  $('p-' + name).addEventListener('click', async () => { await chrome.storage.sync.set(PRESETS[name]); reload(); });
}
$('reset').addEventListener('click', async () => { await chrome.storage.sync.set(DEFAULTS); reload(); });

// Live meter
async function poll() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'ml-status' });
    if (!r) return;
    $('lumbar').style.width = Math.round(r.lum * 100) + '%';
    $('showbar').style.width = Math.round(r.shown * 100) + '%';
    $('lumv').textContent = Math.round(r.lum * 100) + '%';
    $('showv').textContent = Math.round(r.shown * 100) + '%';
    $('areav').textContent = r.selective
      ? Math.round(r.brightArea * 100) + '% of frame over ceiling, capped at ' + Math.round(r.ceiling * 100) + '%'
      : 'whole frame dimmed ' + Math.round(r.dim * 100) + '%';
    $('status').textContent =
      !r.hasVideo ? 'No video found on this tab'
      : !r.attached ? 'Ceiling layer NOT attached'
      : !r.readable ? 'Pixels unreadable (DRM) - ceiling still applies'
      : 'Active';
  } catch (e) {
    $('status').textContent = 'Not connected - reload the YouTube tab';
  }
}
poll();
setInterval(poll, 160);
