(() => {
  'use strict';

  let callsState = { active: [] };
  let socket = null;
  let reconnectTimer = null;

  const ordinalWord = n => ({1:'Primeira',2:'Segunda',3:'Terceira',4:'Quarta',5:'Quinta'}[Number(n)] || `${Number(n) || 1}ª`);
  const ordinalShort = n => `${Math.max(1, Number(n) || 1)}ª chamada`;

  function installStyles() {
    if (document.getElementById('crs-call-enhancement-style')) return;
    const style = document.createElement('style');
    style.id = 'crs-call-enhancement-style';
    style.textContent = `
      .call-count-badge{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;border-radius:999px;padding:4px 8px;font-size:10.5px;font-weight:850;letter-spacing:.02em;border:1px solid #9bc5e8;background:#edf6ff;color:#145f9f;margin-left:7px;vertical-align:middle}
      .call-count-badge.call-2{border-color:#efc46f;background:#fff8e9;color:#95600e}
      .call-count-badge.call-3{border-color:#e7a0a5;background:#fff1f2;color:#b32631}
      .now-card .call-count-badge{margin:0 0 12px 0;padding:6px 11px;font-size:12px}
      .voice-hint{font-size:10px;color:var(--muted,#6b7c8a);margin-top:6px;text-align:right}
    `;
    document.head.appendChild(style);
  }

  function badgeClass(count) {
    const n = Number(count) || 1;
    if (n >= 3) return 'call-3';
    if (n === 2) return 'call-2';
    return 'call-1';
  }

  function makeBadge(count) {
    const span = document.createElement('span');
    span.className = `call-count-badge ${badgeClass(count)}`;
    span.textContent = ordinalShort(count);
    return span;
  }

  function decorateCallList() {
    const items = [...document.querySelectorAll('.call-list .call-item')];
    const active = callsState?.active || [];
    items.forEach((item, index) => {
      const call = active[index];
      if (!call) return;
      const top = item.querySelector('.call-item-top > div:first-child') || item.querySelector('.call-item-top');
      if (!top) return;
      let badge = top.querySelector('.call-count-badge');
      if (!badge) { badge = makeBadge(call.callCount); top.appendChild(badge); }
      badge.textContent = ordinalShort(call.callCount);
      badge.className = `call-count-badge ${badgeClass(call.callCount)}`;
    });
  }

  function decorateCurrentCall() {
    const call = callsState?.active?.[0];
    const cards = [...document.querySelectorAll('.now-card')];
    cards.forEach(card => {
      const room = card.querySelector('.now-room');
      if (!room || !call) return;
      let badge = card.querySelector(':scope > .call-count-badge');
      if (!badge) { badge = makeBadge(call.callCount); card.insertBefore(badge, room); }
      badge.textContent = ordinalShort(call.callCount);
      badge.className = `call-count-badge ${badgeClass(call.callCount)}`;
    });
  }

  function decorateVoiceButton() {
    const button = document.getElementById('audio-btn');
    if (!button) return;
    const txt = (button.textContent || '').toLowerCase();
    button.textContent = txt.includes('ativado') ? '🔊 Voz ativa' : '🔊 Ativar voz';
    button.title = 'Ative uma vez neste computador para permitir a locução dos chamados.';
    const actions = button.parentElement;
    if (actions && !actions.querySelector('.voice-hint')) {
      const hint = document.createElement('div');
      hint.className = 'voice-hint';
      hint.textContent = 'A voz precisa ser ativada uma vez neste computador.';
      actions.appendChild(hint);
    }
  }

  function decorate() {
    installStyles();
    decorateCallList();
    decorateCurrentCall();
    decorateVoiceButton();
  }

  function updateState(data) {
    if (!data || typeof data !== 'object') return;
    callsState = data;
    requestAnimationFrame(decorate);
  }

  async function refreshState() {
    try {
      const res = await fetch('/api/state', { credentials:'same-origin', cache:'no-store' });
      if (!res.ok) return;
      updateState(await res.json());
    } catch {}
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    const shell = document.getElementById('app-shell');
    if (!shell || shell.classList.contains('hidden')) {
      reconnectTimer = setTimeout(connect, 2500);
      return;
    }
    try {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${location.host}/api/realtime?scope=internal`);
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'snapshot') updateState(message.data);
        } catch {}
      };
      socket.onclose = () => { socket = null; reconnectTimer = setTimeout(connect, 2500); };
      socket.onerror = () => { try { socket.close(); } catch {} };
    } catch {
      socket = null;
      reconnectTimer = setTimeout(connect, 2500);
    }
  }

  function installSpeechPhrase() {
    if (!window.speechSynthesis || window.__crsCallSpeechPatched) return;
    window.__crsCallSpeechPatched = true;
    const originalSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = utterance => {
      try {
        const text = String(utterance?.text || '');
        const match = text.match(/^Paciente\s+(.+?)\.\s*Dirija-se à sala\s+(.+?)\.\s*Repetindo:\s*sala\s+(.+?)\.?$/i);
        if (match && utterance) {
          const count = Number(callsState?.active?.[0]?.callCount) || 1;
          const name = match[1].trim();
          const room = match[2].trim();
          utterance.text = `${ordinalWord(count)} chamada. Paciente ${name}, compareça ao consultório ${room}. Repetindo: paciente ${name}, consultório ${room}.`;
          utterance.lang = 'pt-BR';
          utterance.rate = 0.92;
        }
      } catch {}
      return originalSpeak(utterance);
    };
  }

  installSpeechPhrase();
  installStyles();
  refreshState();
  connect();
  window.addEventListener('hashchange', () => { refreshState(); setTimeout(decorate, 80); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshState(); connect(); } });
  new MutationObserver(decorate).observe(document.documentElement, { childList:true, subtree:true });
  setInterval(() => { decorate(); connect(); }, 4000);
})();