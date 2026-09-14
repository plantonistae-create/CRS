(function(){
  const originalTopbar=topbar;
  const originalBind=bind;

  function activeDoctors(){
    const list=state.data?.doctorsList||Object.values(state.data?.doctors||{});
    return (list||[]).filter(d=>d.active!==false).sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR'));
  }
  function doctorOptions(selected='',allowNone=true){
    return `${allowNone?'<option value="">Sem substituição definida</option>':''}${activeDoctors().map(d=>`<option value="${d.id}" ${d.id===selected?'selected':''}>${esc(d.name)}${d.doctorType==='extra'?' · Extra':d.doctorType==='folha'?' · Folha':''}</option>`).join('')}`;
  }
  function periodFor(start){
    const h=Number(String(start||'00:00').split(':')[0]);
    if(h<6)return 'Madrugada';
    if(h<12)return 'Manhã';
    if(h<18)return 'Tarde';
    return 'Noite';
  }
  function periodOrder(p){return ({Madrugada:0,'Manhã':1,'Tarde':2,'Noite':3})[p]??9;}

  window.setEscalaTheme=function(theme){
    const next=theme==='light'?'light':'dark';
    document.documentElement.dataset.theme=next;
    localStorage.setItem('crs-escala-theme',next);
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=next==='light'?'#f4f7fb':'#07111d';
    document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.textContent=next==='light'?'🌙 Escuro':'☀️ Claro');
  };
  setEscalaTheme(localStorage.getItem('crs-escala-theme')||'dark');

  topbar=function(){
    const html=originalTopbar();
    return html;
  };

  calendar=function(admin=false){
    const [y,m]=state.month.split('-').map(Number),days=new Date(y,m,0).getDate(),list=state.data?.shifts||[];
    let html='';
    for(let d=1;d<=days;d++){
      const date=`${state.month}-${String(d).padStart(2,'0')}`,dateObj=new Date(`${date}T00:00:00Z`),shifts=list.filter(s=>s.date===date).sort((a,b)=>String(a.start).localeCompare(String(b.start))||String(a.end).localeCompare(String(b.end))),used=shifts.filter(s=>s.category!=='fixo').reduce((a,s)=>a+Number(s.hours),0),avail=Math.max(0,96-used);
      const groups={};shifts.forEach(s=>{const p=periodFor(s.start);(groups[p]||(groups[p]=[])).push(s)});
      const periodSummary=Object.keys(groups).sort((a,b)=>periodOrder(a)-periodOrder(b)).map(p=>`${p}: ${groups[p].length}`).join(' · ');
      const inside=Object.keys(groups).sort((a,b)=>periodOrder(a)-periodOrder(b)).map(p=>`<div class="period-group"><div class="period-title">${p}</div>${groups[p].map(s=>shiftCard(s,admin)).join('')}</div>`).join('');
      html+=`<details class="day-card compact-day ${shifts.length?'':'empty'}"><summary class="day-summary"><div><div class="date-num">${d}</div><div class="muted day-week">${DAYS[dateObj.getUTCDay()]}</div></div><div class="day-summary-main"><b>${shifts.length?`${shifts.length} plantão${shifts.length>1?'ões':''}`:'Sem plantonistas'}</b><small>${periodSummary||'Clique para visualizar'}</small></div><div class="extra-meter"><strong>${avail}h livres</strong>${used}h / 96h extras</div></summary><div class="day-expanded">${inside||'<div class="muted">Sem plantonistas lançados</div>'}</div></details>`;
    }
    return `<div class="calendar-grid compact-calendar">${html}</div>`;
  };

  newRequestForm=function(){
    const d=state.requestDraft;if(!d)return '';
    const s=(state.data.shifts||[]).find(x=>x.id===d.shiftId);if(!s)return '';
    const canReplace=['troca','atestado','ausencia'].includes(d.type);
    const required=d.type==='troca';
    const target=canReplace?`<div class="field span2"><label>Médico substituto${required?'':' (se já estiver definido)'}</label><select name="targetDoctorId" ${required?'required':''}>${doctorOptions('',!required)}</select><small>Selecione entre médicos de folha e plantonistas extras cadastrados.</small></div>`:'';
    const file=d.type==='atestado'?'<div class="field span2"><label>Documento</label><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp"></div>':'';
    return `<section class="card"><h2>${esc(TYPE[d.type])}</h2><p><b>${fmtDate(s.date)} · ${s.start}–${s.end} · ${s.hours}h</b></p><form id="request-form" class="form-grid"><input type="hidden" name="type" value="${d.type}"><input type="hidden" name="shiftId" value="${s.id}"><input type="hidden" name="eventDate" value="${s.date}"><input type="hidden" name="hours" value="${s.hours}">${target}<div class="field span2"><label>Observação (opcional)</label><textarea name="notes" placeholder="Somente se houver alguma informação adicional"></textarea></div>${file}<div class="actions span2"><button class="btn primary" type="submit">Enviar solicitação</button><button class="btn" type="button" data-action="cancel-request">Cancelar</button></div></form></section>`;
  };

  requestAdminCard=function(r){
    const d=state.data.doctorsList.find(x=>x.id===r.doctorId),target=state.data.doctorsList.find(x=>x.id===r.targetDoctorId);
    const canReplace=['troca','atestado','ausencia'].includes(r.type);
    const replacement=canReplace?`<div class="admin-request-adjust"><label>Substituto efetivo</label><select data-request-target="${r.id}">${doctorOptions(r.targetDoctorId||'',r.type!=='troca')}</select><label>Tipo do substituto</label><select data-request-category="${r.id}"><option value="eventual" ${r.category==='eventual'?'selected':''}>Eventual</option><option value="pagamento" ${r.category==='pagamento'?'selected':''}>Pagamento de horas</option><option value="fixo" ${r.category==='fixo'?'selected':''}>Fixo</option></select></div>`:'';
    return `<div class="request-card"><div><h3>${esc(TYPE[r.type])} · ${esc(r.protocol)}</h3><p><b>${esc(d?.name||'Médico')}</b> · fato em ${fmtDate(r.eventDate)} · ${r.hours}h ${r.retroactive?'· RETROATIVO':''}</p>${target?`<p>Substituto indicado: <b>${esc(target.name)}</b></p>`:''}<p>Enviado: ${fmtTs(r.submittedAt)} · <span class="status ${r.status}">${esc(r.status)}</span></p>${r.notes?`<p>${esc(r.notes)}</p>`:''}${r.attachment?`<p><a class="btn small" href="/api/requests/${r.id}/attachment" target="_blank">Abrir documento</a></p>`:''}${['pending','pending_admin'].includes(r.status)?replacement:''}</div><div class="actions">${['pending','pending_admin'].includes(r.status)?`${r.type==='ausencia'?`<button class="btn good small" data-decide="${r.id}" data-debt="1">Aprovar + horas pendentes</button><button class="btn small" data-decide="${r.id}" data-debt="0">Aprovar sem horas pendentes</button>`:`<button class="btn good small" data-decide="${r.id}" data-approve="1">Aprovar</button>`}<button class="btn danger small" data-decide="${r.id}" data-approve="0">Recusar</button>`:''}</div></div>`;
  };

  decide=async function(btn){
    const id=btn.dataset.decide;let approve=btn.dataset.approve!=='0';
    const body={approve,note:''};
    if(approve){
      const target=document.querySelector(`[data-request-target="${id}"]`);const cat=document.querySelector(`[data-request-category="${id}"]`);
      if(target?.value)body.targetDoctorId=target.value;
      if(cat?.value)body.category=cat.value;
    }
    if(btn.dataset.debt!==undefined){approve=true;body.approve=true;body.generatesDebt=btn.dataset.debt==='1';if(body.generatesDebt){const r=(state.data.requests||[]).find(x=>x.id===id);body.debtHours=Number(r?.hours||12);}}
    try{await post(`/api/admin/requests/${id}/decide`,body);toast('Decisão registrada.');await load();}catch(e){toast(e.message,true)}
  };

  replaceShift=async function(id){
    const shift=(state.data.shifts||[]).find(s=>s.id===id);if(!shift)return;
    const current=state.data.doctorsList?.find(d=>d.id===shift.doctorId);
    const dialog=document.createElement('dialog');dialog.className='replace-dialog';
    dialog.innerHTML=`<form method="dialog" class="replace-form"><div class="dialog-head"><div><div class="eyebrow">Alteração administrativa</div><h2>Substituir plantonista</h2><p>${esc(current?.name||'Médico')} · ${fmtDate(shift.date)} · ${shift.start}–${shift.end}</p></div><button class="btn small" value="cancel">✕</button></div><div class="field"><label>Novo médico</label><select id="replacement-doctor" required>${doctorOptions('',false)}</select></div><div class="field"><label>Motivo</label><select id="replacement-reason"><option value="troca">Troca / ajuste de escala</option><option value="atestado">Atestado</option><option value="ausencia">Ausência / passou o plantão</option><option value="pagamento">Pagamento de horas</option></select></div><div class="field"><label>Tipo do substituto</label><select id="replacement-category"><option value="eventual">Eventual</option><option value="pagamento">Pagamento de horas</option><option value="fixo">Fixo</option></select></div><label class="check-row" id="debt-row"><input id="replacement-debt" type="checkbox"> Gerar horas pendentes para o médico original</label><div class="actions"><button class="btn primary" type="button" id="confirm-replacement">Confirmar substituição</button><button class="btn" value="cancel">Cancelar</button></div></form>`;
    document.body.appendChild(dialog);
    const reason=dialog.querySelector('#replacement-reason'),debtRow=dialog.querySelector('#debt-row'),cat=dialog.querySelector('#replacement-category');
    function syncReason(){debtRow.style.display=reason.value==='ausencia'?'flex':'none';if(reason.value==='pagamento')cat.value='pagamento';}
    reason.onchange=syncReason;syncReason();
    dialog.querySelector('#confirm-replacement').onclick=async()=>{const doctorId=dialog.querySelector('#replacement-doctor').value;if(!doctorId)return toast('Selecione o médico substituto.',true);const body={doctorId,reasonType:reason.value,category:cat.value,function:shift.function,generatesDebt:dialog.querySelector('#replacement-debt').checked,debtHours:shift.hours};try{await post(`/api/admin/shifts/${id}/replace`,body);dialog.close();dialog.remove();toast('Substituição registrada.');await load();}catch(e){toast(e.message,true)}};
    dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
  };

  bind=function(){
    originalBind();
    document.querySelector('[data-action="cancel-request"]')?.addEventListener('click',()=>{state.requestDraft=null;state.route='mine';render()});
    const topActions=document.querySelector('.top-actions');
    if(topActions&&!topActions.querySelector('[data-theme-toggle]')){const b=document.createElement('button');b.className='btn small ghost';b.dataset.themeToggle='1';b.textContent=document.documentElement.dataset.theme==='light'?'🌙 Escuro':'☀️ Claro';b.onclick=()=>setEscalaTheme(document.documentElement.dataset.theme==='light'?'dark':'light');topActions.prepend(b);}
  };

  try{render();}catch(e){console.error('ux-v11-render',e)}
})();
