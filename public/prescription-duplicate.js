(() => {
  'use strict';

  let scheduled = false;

  function patientId(){
    return document.getElementById('modal-card')?.dataset.patientId || '';
  }

  function showBlocked(){
    const toast = document.getElementById('toast');
    if(toast){
      toast.textContent = 'O navegador bloqueou a abertura da prescrição.';
      toast.className = 'toast show err';
      setTimeout(() => toast.className = 'toast', 3000);
    }
  }

  function openLatest(id, duplicate=false){
    if(!id) return;
    const u = new URL('https://plantonistae-create.github.io/prescricao/crs.html');
    u.searchParams.set('patientId', id);
    u.searchParams.set('returnOrigin', location.origin);
    u.searchParams.set(duplicate ? 'duplicateLatest' : 'latestOnly', '1');
    const w = window.open(u.toString(), (duplicate ? 'crs-prescricao-duplicada-' : 'crs-prescricao-ultima-') + id);
    if(!w) showBlocked();
  }

  function makeDuplicateButton(id, compact=false){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = compact ? 'btn small amber' : 'btn amber';
    b.dataset.duplicateLatest = id;
    b.textContent = 'Duplicar última';
    b.title = 'Abre uma cópia da última versão realmente salva na Central para editar e salvar como nova versão.';
    b.onclick = () => openLatest(id, true);
    return b;
  }

  function enhance(){
    const pane = document.getElementById('pane-prescricoes');
    const id = patientId();
    if(!pane || !id) return;
    const currentCard = pane.querySelector('.crs-history-card.current');
    const currentButton = pane.querySelector('[data-history-current]');
    const hasPrescription = !!currentCard || /editar|última|ultima/i.test(currentButton?.textContent || '');
    if(!hasPrescription) return;

    if(currentButton && currentButton.dataset.latestExact !== '1'){
      currentButton.dataset.latestExact = '1';
      currentButton.textContent = 'Abrir última';
      currentButton.title = 'Abre a última versão salva na Central, ignorando rascunhos locais antigos.';
      currentButton.onclick = () => openLatest(id, false);
    }

    const toolbarGroup = currentButton?.parentElement;
    if(toolbarGroup && !toolbarGroup.querySelector('[data-duplicate-latest]')){
      toolbarGroup.style.display = 'flex';
      toolbarGroup.style.gap = '7px';
      toolbarGroup.style.flexWrap = 'wrap';
      toolbarGroup.appendChild(makeDuplicateButton(id, false));
    }

    if(currentCard){
      const actions = currentCard.querySelector('.crs-history-actions');
      if(actions && !actions.querySelector('[data-duplicate-latest]')){
        const firstPrint = actions.querySelector('[data-history-print]');
        const b = makeDuplicateButton(id, true);
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