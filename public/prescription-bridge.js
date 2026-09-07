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

  function sanitizePrintText(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/\t/g, '    ')
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

  function normalizeSex(value) {
    const raw = String(value || '').trim();
    const n = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (['m','masc','masculino','homem'].includes(n)) return 'Masculino';
    if (['f','fem','feminino','mulher'].includes(n)) return 'Feminino';
    return '';
  }

  function normalizeAge(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return /^\d{1,3}$/.test(raw) && Number(raw) <= 130 ? raw : '';
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
        context:{patient:patient ? {name:patient.name,age:normalizeAge(patient.age),sex:normalizeSex(patient.sex),status:patient.status,sector:patient.sector,pending:patient.pending||''} : null},
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
      const rawPatient = message.patient && typeof message.patient === 'object' ? message.patient : {};
      const patient = {
        name: String(rawPatient.name || '').trim().slice(0, 120),
        age: normalizeAge(rawPatient.age),
        sex: normalizeSex(rawPatient.sex)
      };
      const destination = allowedDestinations.has(message.destination) ? message.destination : 'salvar';
      const sector = destination === 'censo' && allowedSectors.has(message.sector) ? message.sector : '';
      const pending = sanitizePending(message.pending);
      const rawSnapshot = message.snapshot && typeof message.snapshot === 'object' ? message.snapshot : {};
      const formattedText = sanitizePrintText(rawSnapshot.printText || rawSnapshot.previewText);
      const snapshot = {...rawSnapshot, printText:formattedText, previewText:sanitizePreview(rawSnapshot.previewText), pending};

      if (!patientId) throw new Error('Paciente não identificado.');
      if (!patient.name) throw new Error('Informe o nome do paciente antes de salvar.');
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
