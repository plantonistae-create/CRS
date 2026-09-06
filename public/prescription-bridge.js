(() => {
  'use strict';
  const PRESC_ORIGIN = 'https://plantonistae-create.github.io';
  const allowedDestinations = new Set(['salvar','alta','reavaliacao','censo']);
  const allowedSectors = new Set(['emergencia','infantil','feminina','masculina']);

  const reply = (source, payload) => {
    try { source?.postMessage(payload, PRESC_ORIGIN); } catch {}
  };

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
        context:{patient:patient ? {name:patient.name,age:patient.age,sex:patient.sex,status:patient.status,sector:patient.sector} : null},
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
      const snapshot = message.snapshot && typeof message.snapshot === 'object' ? message.snapshot : {};

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
      sendResult({ok:true,destination,sector,savedAt:Date.now()});
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
