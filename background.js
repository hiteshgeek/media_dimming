const DEFAULTS = { enabled: true, baseDim: 0.0, maxDim: 0.60 };

chrome.commands.onCommand.addListener(async (command) => {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  if (command === 'toggle-enabled') {
    await chrome.storage.sync.set({ enabled: !cfg.enabled });
  } else if (command === 'nudge-darker') {
    await chrome.storage.sync.set({ baseDim: Math.min(0.6, +(cfg.baseDim + 0.05).toFixed(2)) });
  } else if (command === 'nudge-lighter') {
    await chrome.storage.sync.set({ baseDim: Math.max(0, +(cfg.baseDim - 0.05).toFixed(2)) });
  }
});
