(() => {
  'use strict';
  const PRINT_URL='https://plantonistae-create.github.io/prescricao/history-print.html';
  function showToast(message){
    const toast=document.getElementById('toast');
    if(!toast)return;
    toast.textContent=message;
    toast.className='toast show err';
    setTimeout(()=>toast.className='toast',3000);
  }
  document.addEventListener('click',e=>{
    const button=e.target.closest?.('[data-history-print]');
    if(!button)return;
    const patientId=document.getElementById('modal-card')?.dataset.patientId||'';
    const prescriptionId=button.dataset.historyPrint||'';
    if(!patientId||!prescriptionId)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const u=new URL(PRINT_URL);
    u.searchParams.set('patientId',patientId);
    u.searchParams.set('prescriptionId',prescriptionId);
    u.searchParams.set('returnOrigin',location.origin);
    u.searchParams.set('v','2');
    const w=window.open(u.toString(),`crs-print-${prescriptionId}`);
    if(!w)showToast('O navegador bloqueou a janela de impressão. Libere pop-ups para a Central.');
  },true);
})();