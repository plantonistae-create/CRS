(() => {
  'use strict';

  const HISTORY_EDIT_URL = 'https://plantonistae-create.github.io/prescricao/history-open.html';
  let scheduled = false;

  function patientId() {
    return document.getElementById('modal-card')?.dataset.patientId || '';
  }

  function toast(message, error = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast show' + (error ? ' err' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.className = 'toast', 3000);
  }

  function openHistoricalCopy(id, prescriptionId) {
    if (!id || !prescriptionId) return;
    const u = new URL(HISTORY_EDIT_URL);
    u.searchParams.set('patientId', id);
    u.searchParams.set('prescriptionId', prescriptionId);
    u.searchParams.set('returnOrigin', location.origin);
    u.searchParams.set('v', '1');
    const w = window.open(u.toString(), 'crs-history-edit-' + prescriptionId);
    if (!w) toast('O navegador bloqueou a abertura da prescrição histórica.', true);
  }

  function makeButton(prescriptionId, compact = true) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = compact ? 'btn small amber' : 'btn amber';
    button.dataset.historyEdit = prescriptionId;
    button.textContent = 'Abrir como cópia';
    button.title = 'Restaura esta versão salva para edição. Ao salvar, será criada uma nova versão sem alterar o histórico.';
    button.onclick = () => openHistoricalCopy(patientId(), prescriptionId);
    return button;
  }

  function enhance() {
    const pane = document.getElementById('pane-prescricoes');
    const id = patientId();
    if (!pane || !id) return;

    const current = pane.querySelector('[data-history-current]');
    if (current && /abrir última|abrir ultima|editar prescrição vigente/i.test(current.textContent || '')) {
      current.textContent = 'Editar última';
      current.title = 'Abre a última versão salva na Central para editar e salvar como uma nova versão.';
    }

    pane.querySelectorAll('.crs-history-card').forEach(card => {
      if (card.classList.contains('current')) return;
      const view = card.querySelector('[data-history-view]');
      const prescriptionId = view?.dataset.historyView || '';
      const actions = card.querySelector('.crs-history-actions');
      if (!prescriptionId || !actions || actions.querySelector('[data-history-edit]')) return;
      const print = actions.querySelector('[data-history-print]');
      const button = makeButton(prescriptionId, true);
      if (print) actions.insertBefore(button, print);
      else actions.appendChild(button);
    });

    const detail = pane.querySelector('.crs-history-detail');
    if (detail) {
      const actions = detail.querySelector('.crs-history-actions');
      const print = actions?.querySelector('[data-history-print]');
      const prescriptionId = print?.dataset.historyPrint || '';
      if (actions && prescriptionId && !actions.querySelector('[data-history-edit]')) {
        actions.insertBefore(makeButton(prescriptionId, true), print || null);
      }
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('.tab[data-tab="prescricoes"]')) setTimeout(schedule, 30);
  }, true);

  const modalCard = document.getElementById('modal-card');
  if (modalCard) new MutationObserver(schedule).observe(modalCard, { childList: true, subtree: true });
})();
