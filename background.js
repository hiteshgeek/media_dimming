// Factory settings. Kept in step with DEFAULTS in content.js / popup.js.
// There is exactly one set of defaults; Reset returns here.
const FACTORY = {
  mode: 'clip',
  hardCeiling: 0.28, clipStrength: 1.0, areaComp: 0.55,
  maxContrast: 3, minCeiling: 0.10, clipEngine: 'blend', flashCeil: 0.45,
  ceiling: 0.30, maxDim: 0.82, baseDim: 0.00,
  attackMs: 35, releaseMs: 1200, flashGuard: true, flashDelta: 0.12,
  holdMs: 400, peakWeight: 0.45, sampleHz: 50
};

// Bump when the factory values change in a way existing users should receive.
// Stored settings otherwise win over code defaults forever, so without this a
// new default reaches nobody who has ever opened the popup.
const CFG_VERSION = 3;

chrome.runtime.onInstalled.addListener(async () => {
  const st = await chrome.storage.sync.get({ cfgVersion: 0, ...FACTORY });
  if (st.cfgVersion < CFG_VERSION) {
    const prev = {};
    for (const k of Object.keys(FACTORY)) prev[k] = st[k];
    await chrome.storage.sync.set({ ...FACTORY, cfgVersion: CFG_VERSION, undoCfg: prev });
  }
  refreshTabs();
});

// Reloading the extension orphans content scripts in open tabs: the old script
// keeps running against a dead context and the new one is never injected. The
// page has to be reloaded, so do it rather than leaving it as a manual step
// that silently makes every change look like it did nothing.
async function refreshTabs() {
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://www.youtube.com/*', 'https://m.youtube.com/*', 'https://www.youtube-nocookie.com/*']
    });
    for (const t of tabs) {
      try { await chrome.tabs.reload(t.id, { bypassCache: false }); } catch (e) { /* tab went away */ }
    }
  } catch (e) { /* no matching tabs, or query not permitted */ }
}

chrome.commands.onCommand.addListener(async (command) => {
  const cfg = await chrome.storage.sync.get({ enabled: true, hardCeiling: FACTORY.hardCeiling });
  if (command === 'toggle-enabled') {
    await chrome.storage.sync.set({ enabled: !cfg.enabled });
  } else if (command === 'nudge-darker') {
    await chrome.storage.sync.set({ hardCeiling: Math.max(0.08, +(cfg.hardCeiling - 0.03).toFixed(3)) });
  } else if (command === 'nudge-lighter') {
    await chrome.storage.sync.set({ hardCeiling: Math.min(1, +(cfg.hardCeiling + 0.03).toFixed(3)) });
  }
});
