(() => {
  'use strict';
  document.addEventListener('click', e => {
    const button = e.target.closest?.('[data-history-print]');
    if(!button) return;
    const patientId = document.getElementById('modal-card')?.dataset.patientId || '';
    const prescriptionId = button.dataset.historyPrint || '';
    if(!patientId || !prescriptionId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const url = `/prescription-print.html?patientId=${encodeURIComponent(patientId)}&prescriptionId=${encodeURIComponent(prescriptionId)}`;
    const w = window.open(url, `crs-print-${prescriptionId}`);
    if(!w){
      const toast = document.getElementById('toast');
      if(toast){toast.textContent='O navegador bloqueou a janela de impressão. Libere pop-ups para a Central.';toast.className='toast show err';setTimeout(()=>toast.className='toast',3000);}
    }
  }, true);
})();
