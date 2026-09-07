(() => {
  'use strict';
  const PRESC_ORIGIN = 'https://plantonistae-create.github.io';
  const allowedDestinations = new Set(['salvar','alta','reavaliacao','censo']);
  const allowedSectors = new Set(['emergencia','infantil','feminina','masculina']);

  const reply = (source, payload) => {
    try { source?.postMessage(payload, PRESC_ORIGIN); } catch {}
  };

  function sanitizePreview(value) {
    return String(value || '')
      .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000);
  }

  function sanitizePending(value) {
    return String(value || '')
      .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
  }

  async function sendContext(message, source) {
    const patientId = String(message.patientId || '').trim();
    if (!patientId) return reply(source, {type:'CRS_PRESCRIPTION_CONTEXT_V2', patientId, context:{patient:null}, snapshot:null});
    try {
      const res = await fetch(`/api/clinical/patients/${encodeURIComponent(patientId)}`, {credentials:'same-origin'});
      if (res.status === 404) {
        return reply(source, {type:'CRS_PRESCRIPTION_CONTEXT_V2', patientId, context:{patient:null}, snapshot:null});
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Falha ao carregar paciente (${res.status}).`);
      const patient = data.patient || null;
      reply(source, {
        type:'CRS_PRESCRIPTION_CONTEXT_V2',
        patientId,
        context:{patient:patient ? {name:patient.name,age:patient.age,sex:patient.sex,status:patient.status,sector:patient.sector,pending:patient.pending||''} : null},
        snapshot:data.latestPrescription?.snapshot || null
      });
    } catch (error) {
      reply(source, {type:'CRS_PRESCRIPTION_CONTEXT_V2', patientId, context:{patient:null}, snapshot:null, error:error?.message || 'Falha ao carregar contexto.'});
    }
  }

  async function savePrescription(message, source) {
    const requestId = String(message.requestId || '');
    const sendResult = payload => reply(source, {type:'CRS_PRESCRIPTION_SAVE_RESULT', requestId, ...payload});
    try {
      const patientId = String(message.patientId || '').trim();
      const patient = message.patient && typeof message.patient === 'object' ? message.patient : {};
      const destination = allowedDestinations.has(message.destination) ? message.destination : 'salvar';
      const sector = destination === 'censo' && allowedSectors.has(message.sector) ? message.sector : '';
      const pending = sanitizePending(message.pending);
      const rawSnapshot = message.snapshot && typeof message.snapshot === 'object' ? message.snapshot : {};
      const snapshot = {...rawSnapshot, previewText:sanitizePreview(rawSnapshot.previewText), pending};

      if (!patientId) throw new Error('Paciente não identificado.');
      if (!String(patient.name || '').trim()) throw new Error('Informe o nome do paciente antes de salvar.');
      if (destination === 'censo' && !sector) throw new Error('Selecione o setor do Censo.');

      const res = await fetch('/api/clinical/prescription', {
        method:'POST',
        credentials:'same-origin',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({patientId,patient,destination,sector,snapshot})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Falha ao salvar (${res.status}).`);

      let warning = '';
      try {
        const update = await fetch(`/api/clinical/patients/${encodeURIComponent(patientId)}/update`, {
          method:'POST',
          credentials:'same-origin',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({pending})
        });
        if (!update.ok) {
          const detail = await update.json().catch(() => ({}));
          warning = detail.error || 'Prescrição salva, mas as pendências não foram atualizadas.';
        }
      } catch {
        warning = 'Prescrição salva, mas as pendências não foram atualizadas.';
      }

      sendResult({ok:true,destination,sector,pending,savedAt:Date.now(),warning});
    } catch (error) {
      sendResult({ok:false,error:error?.message || 'Não foi possível salvar a prescrição.'});
    }
  }

  window.addEventListener('message', event => {
    if (event.origin !== PRESC_ORIGIN || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'CRS_PRESCRIPTION_READY_V2') sendContext(event.data, event.source);
    if (event.data.type === 'CRS_PRESCRIPTION_SAVE_V2') savePrescription(event.data, event.source);
  });
})();
