(() => {
  'use strict';
  const ROUTE='censo';
  const SECTORS=[
    {id:'emergencia',label:'Emergência'},
    {id:'infantil',label:'Enfermaria Infantil'},
    {id:'feminina',label:'Enfermaria Feminina'},
    {id:'masculina',label:'Enfermaria Masculina'}
  ];
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  let decorating=false,query='',selectedSector='',restoreTab='';

  function currentRoute(){return (location.hash||'#painel').slice(1);}
  function normalize(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function sectorFromSection(section,index){
    if(section.dataset.censoSector)return section.dataset.censoSector;
    const text=normalize(section.querySelector('.sector-title')?.textContent||'');
    const match=SECTORS.find(s=>text.includes(normalize(s.label)));
    const id=match?.id||SECTORS[index]?.id||'';
    if(id)section.dataset.censoSector=id;
    return id;
  }
  function patientCards(){return $$('.sector .patient-row').filter(row=>row.querySelector('[data-open-patient]'));}
  function countBySector(id){
    const section=$('.sector[data-censo-sector="'+CSS.escape(id)+'"]');
    return section?section.querySelectorAll('.patient-row').length:0;
  }
  function buildTools(){
    const stack=$('.sector-stack');
    if(!stack||$('#censo-simple-tools'))return;
    const total=patientCards().length;
    const wrapper=document.createElement('div');
    wrapper.id='censo-simple-tools';
    wrapper.className='censo-simple-tools';
    const shortcuts=SECTORS.map(s=>
      '<button type="button" class="censo-sector-shortcut" data-censo-filter="'+esc(s.id)+'" aria-pressed="false">'+
      '<span class="censo-sector-name">'+esc(s.label)+'</span>'+
      '<span class="censo-sector-count" data-censo-count="'+esc(s.id)+'">'+countBySector(s.id)+'</span></button>'
    ).join('');
    wrapper.innerHTML=
      '<div class="censo-overview">'+
        '<div class="censo-overview-main"><small>Censo agora</small><strong data-censo-total>'+total+'</strong>'+
        '<span>pacientes internados na unidade</span></div>'+
        '<div class="censo-sector-shortcuts" aria-label="Filtrar pacientes por setor">'+shortcuts+'</div>'+
      '</div>'+
      '<div class="censo-searchbar">'+
        '<div class="censo-search-wrap"><input id="censo-simple-search" type="search" autocomplete="off" aria-label="Buscar paciente no Censo" placeholder="Buscar paciente por nome, resumo ou pendência"></div>'+
        '<button type="button" class="btn censo-back-to-all" data-censo-show-all>Mostrar todos os setores</button>'+
      '</div>'+
      '<div class="censo-filter-status" aria-live="polite"></div>';
    stack.parentElement.insertBefore(wrapper,stack);

    const input=$('#censo-simple-search');
    input.value=query;
    input.addEventListener('input',()=>{query=input.value;applyFilters(false);});
    $$('[data-censo-filter]',wrapper).forEach(btn=>btn.addEventListener('click',()=>{
      const next=btn.dataset.censoFilter||'';
      selectedSector=selectedSector===next?'':next;
      applyFilters(true);
    }));
    $('[data-censo-show-all]',wrapper)?.addEventListener('click',()=>{
      selectedSector='';query='';input.value='';applyFilters(false);
    });
  }
  function decorateSections(){
    $$('.sector').forEach((section,index)=>{
      const id=sectorFromSection(section,index);
      if(!id)return;
      const title=section.querySelector('.sector-title');
      if(title&&!title.dataset.censoAccessible){
        title.dataset.censoAccessible='1';
        title.setAttribute('aria-label',title.textContent.trim()+'. Lista de pacientes do setor.');
      }
    });
  }
  function addFieldLabel(el,label){
    if(!el||el.querySelector(':scope > .censo-field-label'))return;
    const tag=document.createElement('span');
    tag.className='censo-field-label';tag.textContent=label;el.prepend(tag);
  }
  function decoratePatients(){
    patientCards().forEach(row=>{
      if(row.dataset.censoDecorated!=='1'){
        row.classList.add('censo-patient-card');
        const identity=[...row.children].find(el=>el.querySelector?.('.patient-name'));
        if(identity){
          identity.classList.add('censo-patient-identity');
          if(!identity.querySelector('.censo-sector-badge')){
            const sectorId=row.closest('.sector')?.dataset.censoSector||'';
            const sectorLabel=SECTORS.find(s=>s.id===sectorId)?.label||'';
            if(sectorLabel){
              const badge=document.createElement('span');
              badge.className='censo-sector-badge';
              badge.textContent=sectorLabel;
              identity.appendChild(badge);
            }
          }
        }
        addFieldLabel(row.querySelector('.patient-case'),'Resumo');
        addFieldLabel(row.querySelector('.patient-pending'),'Pendências');
        const open=row.querySelector('[data-open-patient]');
        if(open){
          open.textContent='Abrir paciente';
          open.classList.add('primary');
          const name=row.querySelector('.patient-name')?.textContent?.trim()||'';
          open.setAttribute('aria-label',('Abrir paciente '+name).trim());
        }
        const presc=row.querySelector('[data-edit-presc]');
        if(presc){presc.textContent='Prescrição';presc.classList.remove('primary');}
        row.dataset.censoDecorated='1';
      }
      const edit=row.querySelector('[data-edit-patient]');
      if(edit&&edit.textContent!=='Editar dados')edit.textContent='Editar dados';
    });
  }
  function updateTools(){
    const total=patientCards().length;
    const totalEl=$('[data-censo-total]');
    if(totalEl&&totalEl.textContent!==String(total))totalEl.textContent=String(total);
    SECTORS.forEach(s=>{
      const el=$('[data-censo-count="'+CSS.escape(s.id)+'"]');
      if(el){
        const next=String(countBySector(s.id));
        if(el.textContent!==next)el.textContent=next;
      }
    });
  }
  function applyFilters(scrollToSector){
    const q=normalize(query);
    let visible=0,firstVisibleSection=null;
    $$('.sector').forEach((section,index)=>{
      const id=sectorFromSection(section,index);
      const sectorAllowed=!selectedSector||selectedSector===id;
      let sectionVisible=false;
      $$('.patient-row',section).forEach(row=>{
        const matches=!q||normalize(row.textContent).includes(q);
        const show=sectorAllowed&&matches;
        row.classList.toggle('censo-patient-hidden',!show);
        if(show){sectionVisible=true;visible++;}
      });
      const hasRows=section.querySelectorAll('.patient-row').length>0;
      const showSection=sectorAllowed&&(sectionVisible||(!q&&!hasRows));
      section.classList.toggle('censo-sector-hidden',!showSection);
      if(showSection&&!firstVisibleSection)firstVisibleSection=section;
    });

    const tools=$('#censo-simple-tools');
    tools?.classList.toggle('censo-filtered',Boolean(selectedSector||q));
    $$('[data-censo-filter]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.censoFilter===selectedSector)));

    const status=$('.censo-filter-status');
    if(status){
      const sectorName=SECTORS.find(s=>s.id===selectedSector)?.label;
      const pieces=[];
      if(sectorName)pieces.push('setor <strong>'+esc(sectorName)+'</strong>');
      if(q)pieces.push('busca <strong>'+esc(query.trim())+'</strong>');
      const nextStatus=pieces.length
        ? visible+' paciente'+(visible===1?'':'s')+' encontrado'+(visible===1?'':'s')+' em '+pieces.join(' · ')
        : 'Mostrando todos os pacientes do Censo.';
      if(status.innerHTML!==nextStatus)status.innerHTML=nextStatus;
    }

    let empty=$('.censo-no-results');
    if(!visible&&(q||selectedSector)){
      if(!empty){
        empty=document.createElement('div');empty.className='censo-no-results';
        $('.sector-stack')?.insertAdjacentElement('beforebegin',empty);
      }
      empty.innerHTML='<strong>Nenhum paciente encontrado.</strong><br>Revise a busca ou mostre todos os setores.';
    }else empty?.remove();

    if(scrollToSector&&selectedSector&&firstVisibleSection)firstVisibleSection.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function enhanceManualForm(){
    const modal=$('#modal-card');
    if(!modal||!$('#m-name',modal)||$('.censo-form-guide',modal))return;
    const body=$('.modal-body',modal);if(!body)return;
    const guide=document.createElement('div');guide.className='censo-form-guide';
    guide.innerHTML=
      '<div class="censo-form-step"><b>1. Identificação</b><span>Nome e idade</span></div>'+
      '<div class="censo-form-step"><b>2. Localização</b><span>Escolha o setor</span></div>'+
      '<div class="censo-form-step"><b>3. Informações</b><span>Resumo e pendências</span></div>';
    body.prepend(guide);
    const age=$('#m-age',modal);if(age){age.inputMode='numeric';age.placeholder='Ex: 68';}
    const name=$('#m-name',modal);if(name)name.placeholder='Nome completo do paciente';
    const caseEl=$('#m-case',modal);if(caseEl)caseEl.placeholder='Resumo breve do caso';
    const pending=$('#m-pending',modal);if(pending)pending.placeholder='Exames, vaga, reavaliação ou outra pendência';
  }
  function enhancePatientModal(){
    const modal=$('#modal-card'),save=$('#p-save',modal);
    if(!modal||!save||save.dataset.censoAutosaveBound==='1')return;
    save.dataset.censoAutosaveBound='1';
    const close=$('.modal-head .close',modal);
    if(close){
      close.textContent='← Voltar';close.classList.add('censo-back');
      close.setAttribute('aria-label','Voltar para o Censo');close.title='Voltar para o Censo';
    }
    const actions=save.closest('.modal-actions');
    if(actions&&!$('.censo-autosave-note',actions)){
      const note=document.createElement('span');note.className='censo-autosave-note';
      note.textContent='Salva automaticamente ao sair do campo';actions.prepend(note);
    }
    save.textContent='Salvar agora';

    if(restoreTab){
      const tab=$('.tab[data-tab="'+restoreTab+'"]',modal);
      restoreTab='';
      if(tab&&!tab.classList.contains('active'))setTimeout(()=>tab.click(),0);
    }

    let timer=null;
    save.addEventListener('click',()=>clearTimeout(timer),true);
    const autosave=()=>{
      clearTimeout(timer);
      timer=setTimeout(()=>{
        const currentModal=$('#modal-card');
        const currentSave=$('#p-save',currentModal);
        if(currentSave&&!currentSave.disabled){
          restoreTab=$('.tab.active',currentModal)?.dataset.tab||'resumo';
          currentSave.click();
        }
      },220);
    };
    ['#p-case','#p-pending'].forEach(selector=>{
      const field=$(selector,modal);if(field)field.addEventListener('change',autosave);
    });
    const sector=$('#p-sector',modal);if(sector)sector.addEventListener('change',autosave);
  }
  function decorate(){
    if(decorating||currentRoute()!==ROUTE)return;
    const stack=$('.sector-stack');if(!stack)return;
    decorating=true;
    try{
      decorateSections();buildTools();decoratePatients();updateTools();applyFilters(false);
      enhanceManualForm();enhancePatientModal();
    }finally{decorating=false;}
  }

  let decorateFrame=0;
  function scheduleDecorate(){
    if(currentRoute()!==ROUTE)return;
    cancelAnimationFrame(decorateFrame);
    decorateFrame=requestAnimationFrame(decorate);
  }
  function enhanceCurrentModal(){
    if(currentRoute()!==ROUTE)return;
    requestAnimationFrame(()=>{
      enhanceManualForm();
      enhancePatientModal();
    });
  }

  window.addEventListener('hashchange',()=>setTimeout(scheduleDecorate,0));

  const contentRoot=$('#content');
  if(contentRoot){
    new MutationObserver(scheduleDecorate).observe(contentRoot,{childList:true});
  }

  const modalRoot=$('#modal-card');
  if(modalRoot){
    new MutationObserver(enhanceCurrentModal).observe(modalRoot,{childList:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(scheduleDecorate,0));
  else setTimeout(scheduleDecorate,0);
})();
