(() => {
  'use strict';
  const originalOpen = window.open.bind(window);
  const PRESC_HOST = 'plantonistae-create.github.io';
  const PRESC_PATH = '/prescricao/crs.html';
  let prescriptionDirty = false;

  function isPrescription(url) {
    try {
      const u = new URL(url, location.href);
      return u.hostname === PRESC_HOST && u.pathname === PRESC_PATH;
    } catch { return false; }
  }

  function toast(message, error = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast show' + (error ? ' err' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.className = 'toast', 3200);
  }

  function updateCloseState(overlay) {
    if (!overlay) return;
    const close = overlay.querySelector('.prescription-overlay-close');
    const state = overlay.querySelector('.prescription-overlay-save-state');
    if (close) {
      close.title = prescriptionDirty ? 'Salve a prescrição antes de fechar' : 'Fechar prescrição';
      close.setAttribute('aria-label', close.title);
      close.classList.toggle('unsaved', prescriptionDirty);
    }
    if (state) {
      state.textContent = prescriptionDirty ? '● Alterações não salvas' : '✓ Prescrição salva';
      state.classList.toggle('unsaved', prescriptionDirty);
    }
  }

  function requestClose(overlay) {
    if (!overlay) return;
    if (prescriptionDirty) {
      toast('Salve a prescrição antes de fechar.', true);
      updateCloseState(overlay);
      return;
    }
    overlay.classList.remove('show');
  }

  function openOverlay(url) {
    let u = new URL(url, location.href);
    const duplicateLatest = u.searchParams.get('duplicateLatest') === '1';
    const latestOnly = u.searchParams.get('latestOnly') === '1';
    u.pathname = (duplicateLatest || latestOnly) ? '/prescricao/duplicate-latest.html' : '/prescricao/crs-v5.html';
    let overlay = document.getElementById('crs-prescription-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'crs-prescription-overlay';
      overlay.className = 'prescription-overlay';
      overlay.innerHTML = `<div class="prescription-overlay-card"><div class="prescription-overlay-head"><div><strong>Prescrição</strong><span>CRS Coophavila · Urgência e Emergência</span></div><div style="display:flex;align-items:center;gap:10px"><span class="prescription-overlay-save-state">✓ Prescrição salva</span><button type="button" class="prescription-overlay-close" aria-label="Fechar prescrição">×</button></div></div><iframe id="crs-prescription-frame" title="Prescrição CRS"></iframe></div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('.prescription-overlay-close').onclick = () => requestClose(overlay);
    }
    prescriptionDirty = false;
    overlay.querySelector('.prescription-overlay-head strong').textContent = duplicateLatest ? 'Duplicar última prescrição' : latestOnly ? 'Última prescrição salva' : 'Prescrição';
    overlay.querySelector('#crs-prescription-frame').src = u.toString();
    updateCloseState(overlay);
    overlay.classList.add('show');
    return { closed:false, focus(){}, close(){ requestClose(overlay); } };
  }

  window.addEventListener('message', event => {
    if (event.origin !== 'https://plantonistae-create.github.io') return;
    const data = event.data;
    if (!data || data.type !== 'CRS_PRESCRIPTION_DIRTY_STATE') return;
    prescriptionDirty = !!data.dirty;
    updateCloseState(document.getElementById('crs-prescription-overlay'));
  });

  window.open = function(url, target, features) {
    if (isPrescription(url)) return openOverlay(url);
    return originalOpen(url, target, features);
  };
})();