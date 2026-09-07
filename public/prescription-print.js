(() => {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const patientId = qs.get('patientId') || '';
  const prescriptionId = qs.get('prescriptionId') || '';
  const root = document.getElementById('print-root');

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function fmt(v){if(!v)return '—';const d=new Date(v);return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}
  async function getJson(url){const res=await fetch(url,{credentials:'same-origin',cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||`Falha (${res.status})`);return data;}
  function destinationLabel(p){if(p.destination==='alta')return'Alta';if(p.destination==='reavaliacao')return'Reavaliação';if(p.destination==='censo'){const s={emergencia:'Emergência',infantil:'Enfermaria Infantil',feminina:'Enfermaria Feminina',masculina:'Enfermaria Masculina'}[p.sector];return s?`Censo · ${s}`:'Censo';}return'Prévia salva';}
  function readableText(p){const snap=p?.snapshot&&typeof p.snapshot==='object'?p.snapshot:{};let text=String(snap.printText||snap.previewText||p?.previewText||'').trim();if(!text)return'Esta versão não possui uma prévia textual disponível.';if(!/[\r\n]/.test(text)){text=text.replace(/\s+(VIA\s+(?:ORAL|ENDOVENOSA|INTRAMUSCULAR|SUBCUTÂNEA|SUBCUTANEA|INALATÓRIA|INALATORIA|TÓPICA|TOPICA))\s+/gi,'\n\n$1\n').replace(/\s+(ORIENTAÇÕES|ORIENTACOES|OBSERVAÇÕES|OBSERVACOES)\s*:?\s*/gi,'\n\n$1:\n').replace(/\s+(\d{1,2}[.)-])\s+/g,'\n$1 ');}return text;}
  async function boot(){
    try{
      if(!patientId||!prescriptionId)throw new Error('Prescrição não identificada.');
      const [pd,rd]=await Promise.all([getJson(`/api/clinical/patients/${encodeURIComponent(patientId)}`),getJson(`/api/clinical/prescriptions/${encodeURIComponent(prescriptionId)}`)]);
      const patient=pd.patient,p=rd.prescription;
      if(!p||p.patientId!==patientId)throw new Error('A prescrição não pertence a este paciente.');
      const meta=[patient?.age?`${patient.age} anos`:'',patient?.sex||'',fmt(p.createdAt)].filter(Boolean).join(' · ');
      root.innerHTML=`<div class="print-actions"><button type="button" id="close-print">Fechar</button><button type="button" class="primary" id="print-again">Imprimir / PDF</button></div><header class="print-head"><h1>${esc(patient?.name||'Paciente')}</h1><div class="print-meta">${esc(meta)}</div><div class="print-dest">${esc(destinationLabel(p))}</div></header><section class="rx">${esc(readableText(p))}</section><footer class="print-foot">CRS Coophavila · versão registrada em ${esc(fmt(p.createdAt))}</footer>`;
      document.title=`Prescrição · ${patient?.name||'Paciente'}`;
      document.getElementById('close-print').onclick=()=>window.close();
      document.getElementById('print-again').onclick=()=>window.print();
      setTimeout(()=>window.print(),300);
    }catch(error){root.innerHTML=`<div class="error">${esc(error.message||'Não foi possível carregar a prescrição.')}</div>`;}
  }
  boot();
})();
