(() => {
  'use strict';

  let scheduled = false;

  function patientId(){
    return document.getElementById('modal-card')?.dataset.patientId || '';
  }

  function openDuplicate(id){
    if(!id) return;
    const u = new URL('https://plantonistae-create.github.io/prescricao/crs.html');
    u.searchParams.set('patientId', id);
    u.searchParams.set('returnOrigin', location.origin);
    u.searchParams.set('duplicateLatest', '1');
    const w = window.open(u.toString(), 'crs-prescricao-duplicada-' + id);
    if(!w){
      const toast = document.getElementById('toast');
      if(toast){
        toast.textContent = 'O navegador bloqueou a abertura da prescrição.';
        toast.className = 'toast show err';
        setTimeout(() => toast.className = 'toast', 3000);
      }
    }
  }

  function makeButton(id, compact=false){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = compact ? 'btn small amber' : 'btn amber';
    b.dataset.duplicateLatest = id;
    b.textContent = 'Duplicar última';
    b.title = 'Cria uma nova prescrição usando exatamente a última versão salva como base.';
    b.onclick = () => openDuplicate(id);
    return b;
  }

  function enhance(){
    const pane = document.getElementById('pane-prescricoes');
    const id = patientId();
    if(!pane || !id) return;
    const currentCard = pane.querySelector('.crs-history-card.current');
    const currentButton = pane.querySelector('[data-history-current]');
    const hasPrescription = !!currentCard || /editar/i.test(currentButton?.textContent || '');
    if(!hasPrescription) return;

    const toolbarGroup = currentButton?.parentElement;
    if(toolbarGroup && !toolbarGroup.querySelector('[data-duplicate-latest]')){
      toolbarGroup.style.display = 'flex';
      toolbarGroup.style.gap = '7px';
      toolbarGroup.style.flexWrap = 'wrap';
      toolbarGroup.appendChild(makeButton(id, false));
    }

    if(currentCard){
      const actions = currentCard.querySelector('.crs-history-actions');
      if(actions && !actions.querySelector('[data-duplicate-latest]')){
        const firstPrint = actions.querySelector('[data-history-print]');
        const b = makeButton(id, true);
        if(firstPrint) actions.insertBefore(b, firstPrint);
        else actions.appendChild(b);
      }
    }
  }

  function schedule(){
    if(scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; enhance(); });
  }

  document.addEventListener('click', e => {
    if(e.target.closest?.('.tab[data-tab="prescricoes"]')) setTimeout(schedule, 30);
  }, true);

  const modalCard = document.getElementById('modal-card');
  if(modalCard){
    new MutationObserver(schedule).observe(modalCard, { childList:true, subtree:true });
  }
})();