(() => {
  'use strict';

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const sectors = [
    ['emergencia','Emergência'],
    ['infantil','Enfermaria Infantil'],
    ['feminina','Enfermaria Feminina'],
    ['masculina','Enfermaria Masculina']
  ];

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));}
  function toast(msg,err=false){const el=$('#toast');if(!el)return;el.textContent=msg;el.className='toast show'+(err?' err':'');clearTimeout(toast.t);toast.t=setTimeout(()=>el.className='toast',2800);}
  async function request(url,opts={}){
    const res=await fetch(url,{credentials:'same-origin',...opts});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`Falha (${res.status})`);
    return data;
  }
  function normalizeSex(value){
    const raw=String(value||'').trim();
    const n=raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    if(['m','masc','masculino','homem'].includes(n))return 'Masculino';
    if(['f','fem','feminino','mulher'].includes(n))return 'Feminino';
    return '';
  }

  async function editPatient(id){
    try{
      const data=await request(`/api/clinical/patients/${encodeURIComponent(id)}`);
      const p=data.patient;
      if(!p||!['censo','reavaliacao'].includes(p.status))throw new Error('Este paciente não está mais em uma fila ativa.');
      const modal=$('#modal'),card=$('#modal-card');
      if(!modal||!card)return;
      const sex=normalizeSex(p.sex);
      const sector=p.status==='censo'?`<div class="field"><label>Setor</label><select id="edit-p-sector">${sectors.map(([v,l])=>`<option value="${v}" ${p.sector===v?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`:'';
      card.innerHTML=`<div class="modal-head"><div><h2>Editar dados do paciente</h2><div class="patient-meta">Correções cadastrais preservam prescrições, exames e histórico.</div></div><button class="close" id="edit-p-close">×</button></div><div class="modal-body"><div class="form-grid"><div class="field full"><label>Nome do paciente</label><input id="edit-p-name" value="${esc(p.name||'')}" autocomplete="off"></div><div class="field"><label>Idade</label><input id="edit-p-age" value="${esc(p.age||'')}" inputmode="numeric"></div><div class="field"><label>Sexo</label><select id="edit-p-sex"><option value="" ${!sex?'selected':''}>Não informado</option><option value="Masculino" ${sex==='Masculino'?'selected':''}>Masculino</option><option value="Feminino" ${sex==='Feminino'?'selected':''}>Feminino</option></select></div>${sector}<div class="field full"><label>Caso / resumo</label><textarea id="edit-p-case">${esc(p.caseSummary||'')}</textarea></div><div class="field full"><label>Pendências</label><textarea id="edit-p-pending">${esc(p.pending||'')}</textarea></div></div>${p.sex&&!sex?'<div class="notice" style="margin-top:12px">O valor antigo do campo Sexo estava inválido e foi descartado. Selecione novamente, se necessário.</div>':''}<div class="notice" style="margin-top:12px">A alteração corrige a ficha atual. Prescrições anteriores permanecem registradas como foram salvas.</div><div class="modal-actions"><button class="btn" id="edit-p-cancel">Cancelar</button><button class="btn primary" id="edit-p-save">Salvar correções</button></div></div>`;
      modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
      const close=()=>{modal.classList.add('hidden');modal.setAttribute('aria-hidden','true');};
      $('#edit-p-close').onclick=close;$('#edit-p-cancel').onclick=close;
      $('#edit-p-save').onclick=async()=>{
        const name=$('#edit-p-name').value.trim();
        if(name.length<2)return toast('Informe o nome do paciente.',true);
        const age=$('#edit-p-age').value.trim();
        if(age&&(!/^\d{1,3}$/.test(age)||Number(age)>130))return toast('Revise a idade do paciente.',true);
        const btn=$('#edit-p-save');btn.disabled=true;btn.textContent='Salvando…';
        try{
          await request('/api/clinical/patients',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:p.id,name,age,sex:$('#edit-p-sex').value,caseSummary:$('#edit-p-case').value.trim(),pending:$('#edit-p-pending').value.trim(),status:p.status,sector:p.status==='censo'?$('#edit-p-sector').value:''})});
          close();toast('Dados do paciente corrigidos.');
        }catch(e){toast(e.message,true);btn.disabled=false;btn.textContent='Salvar correções';}
      };
      setTimeout(()=>$('#edit-p-name')?.focus(),50);
    }catch(e){toast(e.message,true);}
  }

  function addCardButtons(root=document){
    $$('[data-open-patient]',root).forEach(open=>{
      const id=open.dataset.openPatient;if(!id)return;
      const actions=open.closest('.row-actions,.review-actions');
      if(!actions||actions.querySelector(`[data-edit-patient="${CSS.escape(id)}"]`))return;
      const b=document.createElement('button');b.type='button';b.className='btn small';b.dataset.editPatient=id;b.textContent='Editar dados';
      b.onclick=e=>{e.preventDefault();e.stopPropagation();editPatient(id);};
      actions.insertBefore(b,open.nextSibling);
    });
  }

  function addModalButton(){
    const card=$('#modal-card');if(!card||card.querySelector('[data-patient-edit-modal]'))return;
    const presc=card.querySelector('#p-presc');if(!presc)return;
    const title=card.querySelector('.modal-head h2')?.textContent?.trim();
    const patient=(title&&$$('[data-open-patient]').find(b=>b.closest('.patient-row,.review-card')?.querySelector('.patient-name,h3')?.textContent?.trim()===title));
    if(!patient?.dataset.openPatient)return;
    const b=document.createElement('button');b.type='button';b.className='btn';b.dataset.patientEditModal='1';b.textContent='Editar dados';b.onclick=()=>editPatient(patient.dataset.openPatient);
    presc.parentElement?.insertBefore(b,presc);
  }

  const observer=new MutationObserver(()=>{addCardButtons();addModalButton();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  addCardButtons();
})();
