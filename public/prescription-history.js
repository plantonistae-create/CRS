(() => {
  'use strict';

  const $ = (s, r=document) => r.querySelector(s);
  let lastPatientId = '';
  let loadToken = 0;

  function esc(v){
    return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fmt(v){
    if(!v) return '—';
    const d = new Date(v);
    return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  }
  function toast(msg, err=false){
    const el = $('#toast');
    if(!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.className='toast', 3000);
  }
  async function getJson(url){
    const res = await fetch(url,{credentials:'same-origin',cache:'no-store'});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || `Falha (${res.status})`);
    return data;
  }
  function destinationLabel(p){
    if(p.destination==='alta') return 'Alta';
    if(p.destination==='reavaliacao') return 'Reavaliação';
    if(p.destination==='censo') {
      const sector = {emergencia:'Emergência',infantil:'Enfermaria Infantil',feminina:'Enfermaria Feminina',masculina:'Enfermaria Masculina'}[p.sector];
      return sector ? `Censo · ${sector}` : 'Censo';
    }
    return 'Prévia salva';
  }
  function installStyles(){
    if($('#crs-prescription-history-style')) return;
    const style = document.createElement('style');
    style.id='crs-prescription-history-style';
    style.textContent=`
      #pane-prescricoes.crs-history-pane{min-height:220px}
      .crs-history-toolbar{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 0 12px}
      .crs-history-toolbar .hint{font-size:11px;color:var(--muted,#6b7c8a)}
      .crs-history-list{display:grid;gap:9px}
      .crs-history-card{border:1px solid #d6e2ed;border-radius:11px;background:#fff;padding:11px 12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}
      .crs-history-card.current{border-color:#9bc5e8;background:#f8fcff}
      .crs-history-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:4px}
      .crs-history-head strong{font-size:13px;color:#17314a}
      .crs-history-badge{display:inline-flex;border-radius:999px;padding:3px 7px;font-size:9.5px;font-weight:800;background:#edf6ff;color:#145f9f;border:1px solid #b8d7ef}
      .crs-history-meta{font-size:10.5px;color:#6b7c8a;margin-bottom:5px}
      .crs-history-preview{font-size:11.5px;color:#405465;line-height:1.42;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;word-break:break-word;max-width:100%}
      .crs-history-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
      .crs-history-loading,.crs-history-empty{padding:28px 14px;text-align:center;border:1px dashed #cbd8e4;border-radius:10px;color:#6b7c8a;background:#fafcfe}
      .crs-history-detail{border:1px solid #d6e2ed;border-radius:11px;background:#fff;padding:13px}
      .crs-history-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap}
      .crs-history-text{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#263d50;background:#f8fbfd;border:1px solid #dbe6ef;border-radius:9px;padding:12px;max-height:52vh;overflow:auto}
      @media(max-width:720px){.crs-history-card{grid-template-columns:1fr}.crs-history-actions{justify-content:flex-start}.crs-history-actions .btn{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function openCurrentPrescription(patientId){
    const u = new URL('https://plantonistae-create.github.io/prescricao/crs.html');
    u.searchParams.set('patientId',patientId);
    u.searchParams.set('returnOrigin',location.origin);
    const w = window.open(u.toString(),'crs-prescricao-'+patientId);
    if(!w) toast('O navegador bloqueou a abertura do prescritor.',true);
  }

  function readableText(prescription){
    const snap = prescription?.snapshot && typeof prescription.snapshot==='object' ? prescription.snapshot : {};
    let text = String(snap.printText || snap.previewText || prescription?.previewText || '').trim();
    if(!text) return 'Esta versão não possui uma prévia textual disponível.';
    if(!/[\r\n]/.test(text)) {
      text = text
        .replace(/\s+(VIA\s+(?:ORAL|ENDOVENOSA|INTRAMUSCULAR|SUBCUTÂNEA|SUBCUTANEA|INALATÓRIA|INALATORIA|TÓPICA|TOPICA))\s+/gi,'\n\n$1\n')
        .replace(/\s+(ORIENTAÇÕES|ORIENTACOES|OBSERVAÇÕES|OBSERVACOES)\s*:?\s*/gi,'\n\n$1:\n')
        .replace(/\s+(\d{1,2}[.)-])\s+/g,'\n$1 ');
    }
    return text;
  }

  function printableHtml(patient, prescription){
    const text = readableText(prescription);
    const title = `Prescrição · ${patient?.name || 'Paciente'}`;
    const meta = [patient?.age ? `${patient.age} anos` : '', patient?.sex || '', fmt(prescription.createdAt)].filter(Boolean).join(' · ');
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:12pt}header{border-bottom:1.5px solid #222;padding-bottom:9px;margin-bottom:14px}h1{font-size:16pt;margin:0 0 5px}.meta{font-size:9.5pt;color:#444}.dest{margin-top:5px;font-size:9.5pt;color:#333}.rx{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;line-height:1.5;font-family:Arial,Helvetica,sans-serif}.foot{margin-top:24px;padding-top:8px;border-top:1px solid #bbb;font-size:8.5pt;color:#666}@media print{button{display:none}}
      </style></head><body><header><h1>${esc(patient?.name || 'Paciente')}</h1><div class="meta">${esc(meta)}</div><div class="dest">${esc(destinationLabel(prescription))}</div></header><div class="rx">${esc(text)}</div><div class="foot">CRS Coophavila · versão registrada em ${esc(fmt(prescription.createdAt))}</div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),180));<\/script></body></html>`;
  }

  async function printPrescription(patientId, prescriptionId){
    const popup = window.open('','_blank','noopener');
    if(!popup) return toast('O navegador bloqueou a janela de impressão. Libere pop-ups para a Central.',true);
    try{
      popup.document.write('<!doctype html><title>Carregando prescrição…</title><p style="font-family:sans-serif;padding:24px">Carregando prescrição…</p>');
      const [patientData,prescriptionData] = await Promise.all([
        getJson(`/api/clinical/patients/${encodeURIComponent(patientId)}`),
        getJson(`/api/clinical/prescriptions/${encodeURIComponent(prescriptionId)}`)
      ]);
      const prescription = prescriptionData.prescription;
      if(!prescription || prescription.patientId!==patientId) throw new Error('A prescrição não pertence a este paciente.');
      popup.document.open();
      popup.document.write(printableHtml(patientData.patient,prescription));
      popup.document.close();
    }catch(error){
      try{popup.document.open();popup.document.write(`<p style="font-family:sans-serif;padding:24px;color:#a22">${esc(error.message||'Falha ao carregar a prescrição.')}</p>`);popup.document.close();}catch{}
      toast(error.message||'Falha ao carregar a prescrição.',true);
    }
  }

  async function viewPrescription(patientId, prescriptionId){
    const pane = $('#pane-prescricoes');
    if(!pane) return;
    pane.innerHTML='<div class="crs-history-loading">Carregando versão salva…</div>';
    try{
      const data = await getJson(`/api/clinical/prescriptions/${encodeURIComponent(prescriptionId)}`);
      const p = data.prescription;
      if(!p || p.patientId!==patientId) throw new Error('Prescrição não encontrada para este paciente.');
      pane.innerHTML=`<div class="crs-history-detail"><div class="crs-history-detail-head"><div><strong>Prescrição de ${esc(fmt(p.createdAt))}</strong><div class="crs-history-meta">${esc(destinationLabel(p))}</div></div><div class="crs-history-actions"><button class="btn small" type="button" data-history-back>← Histórico</button><button class="btn small primary" type="button" data-history-print="${esc(p.id)}">Imprimir / PDF</button></div></div><div class="crs-history-text">${esc(readableText(p))}</div></div>`;
      $('[data-history-back]',pane).onclick=()=>loadHistory(true);
      $('[data-history-print]',pane).onclick=()=>printPrescription(patientId,p.id);
    }catch(error){
      pane.innerHTML=`<div class="crs-history-empty">${esc(error.message||'Não foi possível carregar esta prescrição.')}<div style="margin-top:10px"><button class="btn small" type="button" data-history-back>Voltar</button></div></div>`;
      $('[data-history-back]',pane)?.addEventListener('click',()=>loadHistory(true));
    }
  }

  function renderHistory(patientId, data){
    const pane = $('#pane-prescricoes');
    if(!pane) return;
    const list = Array.isArray(data.prescriptions) ? data.prescriptions : [];
    const cards = list.map((p,i)=>`<div class="crs-history-card ${i===0?'current':''}"><div><div class="crs-history-head"><strong>${i===0?'Prescrição vigente':'Prescrição anterior'}</strong>${i===0?'<span class="crs-history-badge">ATUAL</span>':''}</div><div class="crs-history-meta">${esc(fmt(p.createdAt))} · ${esc(destinationLabel(p))}</div><div class="crs-history-preview">${esc((p.previewText||'Versão salva').slice(0,420))}</div></div><div class="crs-history-actions"><button class="btn small" type="button" data-history-view="${esc(p.id)}">Visualizar</button><button class="btn small primary" type="button" data-history-print="${esc(p.id)}">Imprimir / PDF</button></div></div>`).join('');
    pane.classList.add('crs-history-pane');
    pane.innerHTML=`<div class="crs-history-toolbar"><div><button class="btn primary" type="button" data-history-current>${list.length?'Editar prescrição vigente':'Criar prescrição'}</button></div><div class="hint">${list.length} ${list.length===1?'versão salva':'versões salvas'}</div></div>${cards?`<div class="crs-history-list">${cards}</div>`:'<div class="crs-history-empty">Nenhuma prescrição salva para este paciente.</div>'}`;
    $('[data-history-current]',pane).onclick=()=>openCurrentPrescription(patientId);
    pane.querySelectorAll('[data-history-view]').forEach(b=>b.onclick=()=>viewPrescription(patientId,b.dataset.historyView));
    pane.querySelectorAll('[data-history-print]').forEach(b=>b.onclick=()=>printPrescription(patientId,b.dataset.historyPrint));
  }

  async function loadHistory(force=false){
    const pane = $('#pane-prescricoes');
    const card = $('#modal-card');
    const patientId = card?.dataset.patientId || lastPatientId;
    if(!pane || !patientId) return;
    if(!force && pane.dataset.historyPatient===patientId && pane.dataset.historyReady==='1') return;
    const token = ++loadToken;
    pane.dataset.historyPatient=patientId;
    pane.dataset.historyReady='0';
    pane.innerHTML='<div class="crs-history-loading">Carregando histórico de prescrições…</div>';
    try{
      const data = await getJson(`/api/clinical/patients/${encodeURIComponent(patientId)}`);
      if(token!==loadToken || !document.body.contains(pane)) return;
      renderHistory(patientId,data);
      pane.dataset.historyReady='1';
    }catch(error){
      if(token!==loadToken || !document.body.contains(pane)) return;
      pane.innerHTML=`<div class="crs-history-empty">Não foi possível carregar o histórico.<div style="margin-top:5px;font-size:11px">${esc(error.message||'')}</div><div style="margin-top:10px"><button class="btn small" type="button" data-history-retry>Tentar novamente</button></div></div>`;
      $('[data-history-retry]',pane)?.addEventListener('click',()=>loadHistory(true));
    }
  }

  function tagCurrentModal(){
    const card = $('#modal-card');
    if(!card || !$('#pane-prescricoes',card)) return;
    if(lastPatientId) card.dataset.patientId=lastPatientId;
  }

  installStyles();
  document.addEventListener('click',e=>{
    const open = e.target.closest?.('[data-open-patient]');
    if(open?.dataset.openPatient){lastPatientId=open.dataset.openPatient;setTimeout(tagCurrentModal,0);}
    const tab = e.target.closest?.('.tab[data-tab="prescricoes"]');
    if(tab){setTimeout(()=>{tagCurrentModal();loadHistory(true);},0);}
  },true);

  const modalCard = $('#modal-card');
  if(modalCard){
    let scheduled=false;
    new MutationObserver(()=>{
      if(scheduled) return;
      scheduled=true;
      requestAnimationFrame(()=>{scheduled=false;tagCurrentModal();});
    }).observe(modalCard,{childList:true,subtree:false});
  }
})();
