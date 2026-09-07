(() => {
  'use strict';
  const originalOpen = window.open.bind(window);
  const PRESC_HOST = 'plantonistae-create.github.io';
  const PRESC_PATH = '/prescricao/crs.html';

  function isPrescription(url) {
    try {
      const u = new URL(url, location.href);
      return u.hostname === PRESC_HOST && u.pathname === PRESC_PATH;
    } catch { return false; }
  }

  function openOverlay(url) {
    let u = new URL(url, location.href);
    u.pathname = '/prescricao/crs-v4.html';
    let overlay = document.getElementById('crs-prescription-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'crs-prescription-overlay';
      overlay.className = 'prescription-overlay';
      overlay.innerHTML = `<div class="prescription-overlay-card"><div class="prescription-overlay-head"><div><strong>Prescrição</strong><span>CRS Coophavila · Urgência e Emergência</span></div><button type="button" class="prescription-overlay-close" aria-label="Fechar">×</button></div><iframe id="crs-prescription-frame" title="Prescrição CRS"></iframe></div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('.prescription-overlay-close').onclick = () => overlay.classList.remove('show');
    }
    overlay.querySelector('#crs-prescription-frame').src = u.toString();
    overlay.classList.add('show');
    return { closed:false, focus(){}, close(){ overlay.classList.remove('show'); } };
  }

  window.open = function(url, target, features) {
    if (isPrescription(url)) return openOverlay(url);
    return originalOpen(url, target, features);
  };
})();