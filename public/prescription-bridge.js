(() => {
  'use strict';
  const PRESC_ORIGIN = 'https://plantonistae-create.github.io';
  const allowedDestinations = new Set(['salvar','alta','reavaliacao','censo']);
  const allowedSectors = new Set(['emergencia','infantil','feminina','masculina']);

  async function savePrescription(message) {
    const requestId = String(message.requestId || '');
    const source = message.__source;
    const reply = payload => {
      try { source?.postMessage({type:'CRS_PRESCRIPTION_SAVE_RESULT', requestId, ...payload}, PRESC_ORIGIN); } catch {}
    };

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
        method: 'POST',
        credentials: 'same-origin',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({patientId, patient, destination, sector, snapshot})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Falha ao salvar (${res.status}).`);

      reply({ok:true, destination, sector, savedAt:Date.now()});
    } catch (error) {
      reply({ok:false, error:error?.message || 'Não foi possível salvar a prescrição.'});
    }
  }

  window.addEventListener('message', event => {
    if (event.origin !== PRESC_ORIGIN || !event.data || typeof event.data !== 'object') return;
    if (event.data.type !== 'CRS_PRESCRIPTION_SAVE_V2') return;
    savePrescription({...event.data, __source:event.source});
  });
})();
