const DEFAULTS = {
  enabled: true, mode: 'clip', testMode: false,
  hardCeiling: 0.28, clipStrength: 1.0, areaComp: 0.55, flashCeil: 0.45,
  maxContrast: 3, minCeiling: 0.10, clipEngine: 'filter',
  whiteStrict: 10, dimThumbs: true, thumbMatch: false, thumbCeiling: 0.45, thumbStrength: 1.0,
  ceiling: 0.35, maxDim: 0.80, baseDim: 0.00,
  attackMs: 35, releaseMs: 1200, flashGuard: true, flashDelta: 0.12,
  holdMs: 400, peakWeight: 0.45, sampleHz: 50
};

// Everything that makes up a "setting". Leaves out enabled and testMode,
// which are operational switches rather than tuning.
const TUNABLE = Object.keys(DEFAULTS).filter(k => k !== 'enabled' && k !== 'testMode');
const META = { slots: [], undoCfg: null };
const MAX_SLOTS = 5;

const PRESETS = {
  gentle: { hardCeiling: 0.45, clipStrength: 0.90, areaComp: 0.40, maxContrast: 5, ceiling: 0.42, maxDim: 0.65, baseDim: 0.00 },
  night:  { hardCeiling: 0.28, clipStrength: 1.00, areaComp: 0.55, maxContrast: 3, ceiling: 0.30, maxDim: 0.82, baseDim: 0.00 },
  strict: { hardCeiling: 0.18, clipStrength: 1.00, areaComp: 0.65, maxContrast: 2, ceiling: 0.20, maxDim: 0.90, baseDim: 0.08 }
};

// id -> [slider value to stored, stored to slider value, label text]
const SLIDERS = {
  hardCeiling:  [v => v / 100, v => Math.round(v * 100), v => Math.round(v * 100) + '%'],
  clipStrength: [v => v / 100, v => Math.round(v * 100), v => v >= 0.98 ? 'hard clip' : (1 / (1 - v)).toFixed(1) + ':1'],
  maxContrast:  [v => v / 10,  v => Math.round(v * 10),  v => v <= 0.05 ? 'off' : v.toFixed(1) + '× scene'],
  areaComp:     [v => v / 100, v => Math.round(v * 100), v => v <= 0.01 ? 'off' : Math.round(v * 100) + '%'],
  thumbCeiling: [v => v / 100, v => Math.round(v * 100), v => Math.round(v * 100) + '%'],
  whiteStrict:  [v => v / 100, v => Math.round(v * 100), v => v <= 0.05 ? 'any bright pixel' : '×' + v.toFixed(1) + ' chroma'],
  ceiling:      [v => v / 100, v => Math.round(v * 100), v => Math.round(v * 100) + '%'],
  maxDim:       [v => v / 100, v => Math.round(v * 100), v => Math.round(v * 100) + '%'],
  baseDim:      [v => v / 100, v => Math.round(v * 100), v => v <= 0.005 ? 'off' : Math.round(v * 100) + '%'],
  releaseMs:    [v => v,       v => v,                   v => (v / 1000).toFixed(2) + 's'],
  flashDelta:   [v => v / 100, v => Math.round(v * 100), v => '+' + Math.round(v * 100) + '%']
};

const $ = id => document.getElementById(id);
const snap = c => Object.fromEntries(TUNABLE.map(k => [k, c[k]]));

function sameCfg(a, b) {
  if (!a || !b) return false;
  return TUNABLE.every(k => {
    const x = a[k], y = b[k];
    return (typeof x === 'number' && typeof y === 'number') ? Math.abs(x - y) < 0.005 : x === y;
  });
}
// A built-in preset only names some keys, so compare just those.
const matchesPreset = (cfg, p) =>
  Object.entries(p).every(([k, v]) => Math.abs(cfg[k] - v) < 0.005);

function fill(el) {
  const min = +el.min, max = +el.max;
  el.style.setProperty('--p', ((+el.value - min) / (max - min) * 100).toFixed(1) + '%');
}

// ---------- state ----------
let CFG = { ...DEFAULTS }, MET = { ...META };

async function load() {
  CFG = await chrome.storage.sync.get(DEFAULTS);
  MET = await chrome.storage.sync.get(META);
  render();
}

// Every action that replaces settings wholesale stashes the old ones first,
// so a reset or preset can always be walked back.
async function applyWithUndo(patch) {
  await chrome.storage.sync.set({ undoCfg: snap(CFG), ...patch });
  await load();
  flash('');
}

function flash(msg) {
  const n = $('savednote');
  n.textContent = msg;
  n.hidden = !msg;
  if (msg) setTimeout(() => { n.hidden = true; }, 2200);
}

// ---------- render ----------
function render() {
  const cfg = CFG;
  $('enabled').checked = cfg.enabled;
  $('flashGuard').checked = cfg.flashGuard;
  $('testMode').checked = cfg.testMode;
  $('dimThumbs').checked = cfg.dimThumbs;
  $('thumbMatch').checked = cfg.thumbMatch;
  $('thumbMatch').disabled = !cfg.dimThumbs;
  $('thumbCeiling').disabled = !cfg.dimThumbs || cfg.thumbMatch;

  document.body.dataset.mode = cfg.mode;
  $('seg').dataset.sel = cfg.mode === 'dim' ? '1' : '0';
  $('m-clip').classList.toggle('sel', cfg.mode === 'clip');
  $('m-dim').classList.toggle('sel', cfg.mode === 'dim');

  $('e-blend').classList.toggle('sel', cfg.clipEngine !== 'filter');
  $('e-filter').classList.toggle('sel', cfg.clipEngine === 'filter');
  $('seg2').dataset.sel = cfg.clipEngine === 'filter' ? '0' : '1';

  const hitPreset = Object.keys(PRESETS).find(n => matchesPreset(cfg, PRESETS[n])) || null;
  for (const n of Object.keys(PRESETS)) $('p-' + n).classList.toggle('sel', n === hitPreset);

  for (const id of Object.keys(SLIDERS)) {
    const [, toSlider, fmt] = SLIDERS[id];
    const el = $(id);
    el.value = toSlider(cfg[id]);
    fill(el);
    $(id + 'v').textContent = fmt(cfg[id]);
  }
  // after the slider loop, which would otherwise overwrite this label
  if (cfg.thumbMatch) {
    $('thumbCeiling').value = Math.round(cfg.hardCeiling * 100);
    fill($('thumbCeiling'));
    $('thumbCeilingv').textContent = Math.round(cfg.hardCeiling * 100) + '% from video';
  }

  $('panel').classList.toggle('off', !cfg.enabled);

  renderSlots();

  const hitSlot = MET.slots.findIndex(s => sameCfg(cfg, s.cfg));
  const isDefault = sameCfg(cfg, DEFAULTS);
  const saved = hitSlot >= 0 || isDefault || !!hitPreset;

  // The save row only appears when the current settings are not already
  // the default, a built-in preset, or one of the saved slots.
  const full = MET.slots.length >= MAX_SLOTS;
  $('saverow').hidden = saved;
  $('whysave').hidden = saved;
  $('save').disabled = full;
  $('slotname').disabled = full;
  $('slotname').placeholder = full
    ? 'All ' + MAX_SLOTS + ' slots full — delete one'
    : 'Name these settings';
  $('undo').hidden = !MET.undoCfg || sameCfg(cfg, MET.undoCfg);
  $('minirow').hidden = $('undo').hidden;
}

function renderSlots() {
  const box = $('slots');
  box.textContent = '';
  MET.slots.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'slot' + (sameCfg(CFG, s.cfg) ? ' sel' : '');
    el.title = 'Load "' + s.name + '"';

    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = s.name;
    nm.addEventListener('click', () => applyWithUndo(s.cfg));

    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '×';
    x.title = 'Delete "' + s.name + '"';
    x.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const slots = MET.slots.slice();
      slots.splice(i, 1);
      await chrome.storage.sync.set({ slots });
      await load();
    });

    el.append(nm, x);
    box.appendChild(el);
  });
}

// ---------- wiring ----------
for (const id of Object.keys(SLIDERS)) {
  $(id).addEventListener('input', async (e) => {
    const [toStore, , fmt] = SLIDERS[id];
    const stored = toStore(+e.target.value);
    fill(e.target);
    $(id + 'v').textContent = fmt(stored);
    CFG[id] = stored;
    await chrome.storage.sync.set({ [id]: stored });
    render();
  });
}

$('enabled').addEventListener('change', async (e) => {
  CFG.enabled = e.target.checked;
  await chrome.storage.sync.set({ enabled: e.target.checked });
  $('panel').classList.toggle('off', !e.target.checked);
});
$('flashGuard').addEventListener('change', async (e) => {
  CFG.flashGuard = e.target.checked;
  await chrome.storage.sync.set({ flashGuard: e.target.checked });
  render();
});
$('dimThumbs').addEventListener('change', async (e) => {
  CFG.dimThumbs = e.target.checked;
  await chrome.storage.sync.set({ dimThumbs: e.target.checked });
  render();
});
$('thumbMatch').addEventListener('change', async (e) => {
  CFG.thumbMatch = e.target.checked;
  await chrome.storage.sync.set({ thumbMatch: e.target.checked });
  render();
});
$('testMode').addEventListener('change', async (e) => {
  CFG.testMode = e.target.checked;
  await chrome.storage.sync.set({ testMode: e.target.checked });
});

const setKey = async (k, v) => { CFG[k] = v; await chrome.storage.sync.set({ [k]: v }); render(); };
$('m-clip').addEventListener('click', () => setKey('mode', 'clip'));
$('m-dim').addEventListener('click', () => setKey('mode', 'dim'));
$('e-blend').addEventListener('click', () => setKey('clipEngine', 'blend'));
$('e-filter').addEventListener('click', () => setKey('clipEngine', 'filter'));

for (const name of Object.keys(PRESETS)) {
  $('p-' + name).addEventListener('click', () => applyWithUndo(PRESETS[name]));
}

$('save').addEventListener('click', async () => {
  if (MET.slots.length >= MAX_SLOTS) return;
  const typed = $('slotname').value.trim();
  const name = typed || 'Preset ' + (MET.slots.length + 1);
  const slots = MET.slots.concat([{ name, cfg: snap(CFG) }]);
  await chrome.storage.sync.set({ slots });
  $('slotname').value = '';
  await load();
  flash('Saved as "' + name + '".');
});
$('slotname').addEventListener('keydown', e => { if (e.key === 'Enter') $('save').click(); });

$('undo').addEventListener('click', async () => {
  if (!MET.undoCfg) return;
  // the undo is itself undoable, so a mis-click costs nothing
  await chrome.storage.sync.set({ ...MET.undoCfg, undoCfg: snap(CFG) });
  await load();
  flash('Reverted.');
});

$('reset').addEventListener('click', () => applyWithUndo(snap(DEFAULTS)));

// ---------- live meter ----------
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

load();
poll();
setInterval(poll, 160);
