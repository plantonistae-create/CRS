(() => {
  'use strict';

  const originalFetch = window.fetch.bind(window);
  const encoder = new TextEncoder();
  const SNAPSHOT_SOFT_LIMIT = 1_250_000;
  const STORAGE_BUDGET = 700_000;
  const SESSION_BUDGET = 420_000;
  const APP_DRAFT_KEY = 'prescricao_draft_session_v2';

  function bytes(value) {
    try { return encoder.encode(JSON.stringify(value ?? null)).byteLength; }
    catch { return Number.POSITIVE_INFINITY; }
  }

  function trimControl(control) {
    if (!control || typeof control !== 'object') return null;
    return {
      i: Number.isInteger(control.i) ? control.i : 0,
      id: String(control.id || '').slice(0, 180),
      name: String(control.name || '').slice(0, 180),
      tag: String(control.tag || '').slice(0, 24),
      type: String(control.type || '').slice(0, 40),
      value: String(control.value ?? '').slice(0, 20000),
      checked: !!control.checked,
      selected: Array.isArray(control.selected) ? control.selected.filter(Number.isInteger).slice(0, 500) : []
    };
  }

  function storagePriority(key) {
    const k = String(key || '').toLowerCase();
    if (/medic|receit|presc|rascun|draft|form|item/.test(k)) return 0;
    if (/pacient/.test(k)) return 1;
    return 2;
  }

  function compactSessionStorage(raw) {
    const result = {};
    const store = raw && typeof raw === 'object' ? raw : {};
    const value = store[APP_DRAFT_KEY];
    if (typeof value !== 'string' || !value) return result;
    const size = encoder.encode(value).byteLength;
    if (size <= SESSION_BUDGET) result[APP_DRAFT_KEY] = value;
    return result;
  }

  function compactSnapshot(snapshot) {
    const raw = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const controls = Array.isArray(raw.controls)
      ? raw.controls.slice(0, 1600).map(trimControl).filter(Boolean)
      : [];
    const compact = {
      version: raw.version || 8,
      savedAt: Number(raw.savedAt || Date.now()),
      controls,
      localStorage: {},
      sessionStorage: compactSessionStorage(raw.sessionStorage),
      stateCaptureVersion: Number(raw.stateCaptureVersion || 0),
      previewText: String(raw.previewText || '').slice(0, 10000),
      printText: String(raw.printText || '').slice(0, 10000),
      pending: String(raw.pending || '').slice(0, 4000),
      storageTruncated: true
    };
    if (raw.restoredFromPrescriptionId) compact.restoredFromPrescriptionId = String(raw.restoredFromPrescriptionId).slice(0, 100);
    if (raw.restoredAsCopy) compact.restoredAsCopy = true;

    const store = raw.localStorage && typeof raw.localStorage === 'object' ? raw.localStorage : {};
    const entries = Object.entries(store)
      .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
      .sort((a, b) => storagePriority(a[0]) - storagePriority(b[0]));

    let used = 0;
    for (const [key, value] of entries) {
      const entryBytes = encoder.encode(key).byteLength + encoder.encode(value).byteLength;
      if (entryBytes > 240_000 || used + entryBytes > STORAGE_BUDGET) continue;
      compact.localStorage[key] = value;
      used += entryBytes;
      if (bytes(compact) > 1_100_000) {
        delete compact.localStorage[key];
        used -= entryBytes;
        break;
      }
    }
    return compact;
  }

  function shouldGuard(input, init) {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      return method === 'POST' && url.origin === location.origin && url.pathname === '/api/clinical/prescription';
    } catch { return false; }
  }

  window.fetch = function(input, init) {
    if (!shouldGuard(input, init) || !init || typeof init.body !== 'string') return originalFetch(input, init);
    try {
      const payload = JSON.parse(init.body);
      if (payload?.snapshot && bytes(payload.snapshot) > SNAPSHOT_SOFT_LIMIT) {
        payload.snapshot = compactSnapshot(payload.snapshot);
        payload.snapshotCompacted = true;
        return originalFetch(input, { ...init, body: JSON.stringify(payload) });
      }
    } catch {}
    return originalFetch(input, init);
  };
})();
