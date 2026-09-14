(() => {
  'use strict';

  const ORDER_PREFIX = 'crs-patient-order:v1:';
  let decorating = false;
  let dragged = null;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function route() {
    return (location.hash || '#painel').slice(1);
  }

  function patientIdFromCard(card) {
    return card?.querySelector('[data-open-patient]')?.dataset.openPatient ||
      card?.querySelector('[data-edit-presc]')?.dataset.editPresc ||
      '';
  }

  function orderKey(container) {
    if (route() === 'reavaliacoes') return ORDER_PREFIX + 'reavaliacoes';
    const sector = container.closest('.sector');
    const title = sector?.querySelector('.sector-title')?.childNodes?.[0]?.textContent?.trim() || 'internacao';
    return ORDER_PREFIX + 'censo:' + title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
  }

  function readOrder(container) {
    try {
      const raw = localStorage.getItem(orderKey(container));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function saveOrder(container) {
    const ids = [...container.children].map(patientIdFromCard).filter(Boolean);
    try { localStorage.setItem(orderKey(container), JSON.stringify(ids)); } catch {}
  }

  function applySavedOrder(container) {
    const saved = readOrder(container);
    if (!saved.length) return;
    const cards = [...container.children].filter(el => patientIdFromCard(el));
    if (!cards.length) return;

    const current = cards.map(patientIdFromCard);
    const currentSet = new Set(current);
    const desired = saved.filter(id => currentSet.has(id));
    current.forEach(id => { if (!desired.includes(id)) desired.push(id); });
    if (current.length === desired.length && current.every((id, index) => id === desired[index])) return;

    const byId = new Map(cards.map(card => [patientIdFromCard(card), card]));
    desired.forEach(id => {
      const card = byId.get(id);
      if (card) container.appendChild(card);
    });
  }

  async function discharge(patientId) {
    if (!patientId) return;
    if (!confirm('Dar alta e retirar este paciente das filas ativas?')) return;
    try {
      const res = await fetch(`/api/clinical/patients/${encodeURIComponent(patientId)}/destination`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destination: 'alta', sector: '' })
      });
      let data = null;
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error(data?.error || `Falha (${res.status})`);
      const toast = $('#toast');
      if (toast) {
        toast.textContent = 'Alta registrada. Paciente retirado das filas ativas.';
        toast.className = 'toast show';
        clearTimeout(discharge.toastTimer);
        discharge.toastTimer = setTimeout(() => toast.className = 'toast', 2600);
      }
    } catch (error) {
      const toast = $('#toast');
      if (toast) {
        toast.textContent = error?.message || 'Não foi possível registrar a alta.';
        toast.className = 'toast show err';
        clearTimeout(discharge.toastTimer);
        discharge.toastTimer = setTimeout(() => toast.className = 'toast', 3200);
      }
    }
  }

  function prominentDischarge(card) {
    const id = patientIdFromCard(card);
    if (!id || card.querySelector('[data-prominent-discharge]')) return;

    const top = document.createElement('div');
    top.className = 'patient-priority-top';

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'patient-drag-handle';
    handle.draggable = true;
    handle.setAttribute('aria-label', 'Arrastar para reordenar paciente');
    handle.title = 'Arraste para mudar a ordem';
    handle.innerHTML = '<span aria-hidden="true">⠿</span><span>Ordenar</span>';

    const alta = document.createElement('button');
    alta.type = 'button';
    alta.className = 'btn patient-discharge-prominent';
    alta.dataset.prominentDischarge = id;
    alta.innerHTML = '<span aria-hidden="true">✓</span> Dar alta';
    alta.title = 'Finalizar atendimento e retirar paciente das filas ativas';
    alta.addEventListener('click', () => discharge(id));

    top.append(handle, alta);
    card.prepend(top);
    card.dataset.patientPriorityId = id;
  }

  function bindDrag(container, card) {
    if (card.dataset.dragBound === '1') return;
    const handle = card.querySelector('.patient-drag-handle');
    if (!handle) return;
    card.dataset.dragBound = '1';

    handle.addEventListener('dragstart', event => {
      dragged = card;
      card.classList.add('patient-dragging');
      event.dataTransfer.effectAllowed = 'move';
      try { event.dataTransfer.setData('text/plain', patientIdFromCard(card)); } catch {}
    });

    handle.addEventListener('dragend', () => {
      card.classList.remove('patient-dragging');
      dragged = null;
      saveOrder(container);
    });

    card.addEventListener('dragover', event => {
      if (!dragged || dragged === card || dragged.parentElement !== container) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      const anchor = before ? card : card.nextSibling;
      if (anchor !== dragged) container.insertBefore(dragged, anchor);
    });

    card.addEventListener('drop', event => {
      if (!dragged) return;
      event.preventDefault();
      saveOrder(container);
    });
  }

  function decorateContainer(container, selector) {
    if (!container) return;
    applySavedOrder(container);
    $$(selector, container).forEach(card => {
      prominentDischarge(card);
      bindDrag(container, card);
    });
  }

  function addHint() {
    const currentRoute = route();
    if (!['censo', 'reavaliacoes'].includes(currentRoute)) return;
    const head = $('.page-head');
    if (!head || $('.patient-order-hint')) return;
    const hint = document.createElement('div');
    hint.className = 'patient-order-hint';
    hint.innerHTML = '<span>⠿</span> Arraste os pacientes para organizar sua sequência de atendimento.';
    head.insertAdjacentElement('afterend', hint);
  }

  function decorate() {
    if (decorating) return;
    const currentRoute = route();
    if (!['censo', 'reavaliacoes'].includes(currentRoute)) return;
    decorating = true;
    try {
      addHint();
      if (currentRoute === 'censo') {
        $$('.patient-list').forEach(container => decorateContainer(container, ':scope > .patient-row'));
      } else {
        decorateContainer($('.review-grid'), ':scope > .review-card');
      }
    } finally {
      decorating = false;
    }
  }

  window.addEventListener('hashchange', () => setTimeout(decorate, 0));
  new MutationObserver(() => {
    if (!decorating) requestAnimationFrame(decorate);
  }).observe($('#content') || document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(decorate, 0));
  } else {
    setTimeout(decorate, 0);
  }
})();
