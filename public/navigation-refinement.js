(()=>{
  'use strict';

  const callQueue=[];
  let queuedRoom='';
  let queueStatus='';
  let clockTimer=null;

  function ensureReceptionNav(){
    const nav=document.getElementById('nav');
    if(!nav||nav.querySelector('[data-route="recepcao"]')) return;
    const caller=nav.querySelector('[data-route="chamador"]');
    const link=document.createElement('a');
    link.href='#recepcao';
    link.dataset.route='recepcao';
    link.textContent='Recepção';
    if(caller) caller.insertAdjacentElement('afterend',link); else nav.appendChild(link);
  }

  function syncActiveNav(){
    const route=(location.hash||'#painel').slice(1);
    document.querySelectorAll('#nav a').forEach(a=>a.classList.toggle('active',a.dataset.route===route));
  }

  function refineInternacaoLabel(){
    const nav=document.getElementById('nav');
    const censo=nav?.querySelector('[data-route="censo"]');
    if(censo) censo.textContent='Internação';
  }

  function todayClock(){
    const now=new Date();
    return {
      date:now.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}),
      time:now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
    };
  }

  function updateCallerClock(){
    const box=document.querySelector('.caller-clock');
    if(!box) return;
    const value=todayClock();
    const date=box.querySelector('[data-clock-date]');
    const time=box.querySelector('[data-clock-time]');
    if(date) date.textContent=value.date;
    if(time) time.textContent=value.time;
  }

  function ensureCallerClock(pageHead){
    const actions=pageHead?.querySelector('.actions');
    if(!actions) return;
    if(!actions.querySelector('.caller-clock')){
      const box=document.createElement('div');
      box.className='caller-clock';
      box.innerHTML='<span class="caller-clock-icon">◷</span><div><small data-clock-date></small><strong data-clock-time></strong></div>';
      actions.appendChild(box);
    }
    updateCallerClock();
    if(!clockTimer) clockTimer=setInterval(updateCallerClock,30000);
  }

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,(character)=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[character]));
  }

  function queueSummaryText(){
    if(!callQueue.length) return 'Adicione pacientes para chamá-los juntos para a mesma sala.';
    return `${callQueue.length} ${callQueue.length===1?'paciente na fila':'pacientes na fila'} · sala ${queuedRoom}`;
  }

  function renderQueuePanel(panel){
    if(!panel) return;
    panel.classList.toggle('has-items',callQueue.length>0);
    const summary=panel.querySelector('[data-queue-summary]');
    const list=panel.querySelector('[data-queue-list]');
    const callButton=panel.querySelector('[data-call-queue]');
    const clearButton=panel.querySelector('[data-clear-queue]');
    const status=panel.querySelector('[data-queue-status]');
    if(summary) summary.textContent=queueSummaryText();
    if(list){
      list.innerHTML=callQueue.length?callQueue.map((name,index)=>`<div class="queue-person"><span class="queue-index">${index+1}</span><span>${escapeHtml(name)}</span><button type="button" class="queue-remove" data-remove-queue="${index}" aria-label="Remover ${escapeHtml(name)}">×</button></div>`).join(''):'<div class="queue-empty">A fila está vazia.</div>';
      list.querySelectorAll('[data-remove-queue]').forEach(button=>{
        button.onclick=()=>{
          const index=Number(button.dataset.removeQueue);
          if(Number.isInteger(index)&&index>=0&&index<callQueue.length) callQueue.splice(index,1);
          if(!callQueue.length) queuedRoom='';
          queueStatus='';
          renderQueuePanel(panel);
        };
      });
    }
    if(callButton){
      callButton.disabled=!callQueue.length;
      callButton.textContent=callQueue.length?`🔊 Chamar fila (${callQueue.length})`:'🔊 Chamar fila';
    }
    if(clearButton) clearButton.disabled=!callQueue.length;
    if(status){
      status.textContent=queueStatus;
      status.classList.toggle('show',!!queueStatus);
    }
  }

  function addCurrentPatientToQueue(panel){
    const room=document.getElementById('call-room');
    const name=document.getElementById('call-name');
    const cleanRoom=(room?.value||'').trim();
    const cleanName=(name?.value||'').trim().replace(/\s+/g,' ');
    if(!cleanRoom||!cleanName){
      queueStatus='Informe a sala e o nome do paciente antes de adicionar à fila.';
      renderQueuePanel(panel);
      return;
    }
    if(callQueue.length&&queuedRoom!==cleanRoom){
      queueStatus=`A fila atual está vinculada à sala ${queuedRoom}. Limpe a fila para usar outra sala.`;
      renderQueuePanel(panel);
      return;
    }
    if(callQueue.length>=8){
      queueStatus='A fila permite até 8 pacientes por chamada conjunta.';
      renderQueuePanel(panel);
      return;
    }
    if(callQueue.some(item=>item.toLocaleLowerCase('pt-BR')===cleanName.toLocaleLowerCase('pt-BR'))){
      queueStatus='Este paciente já está na fila.';
      renderQueuePanel(panel);
      return;
    }
    queuedRoom=cleanRoom;
    callQueue.push(cleanName);
    queueStatus='Paciente adicionado à fila.';
    if(name){name.value='';name.focus();}
    renderQueuePanel(panel);
  }

  async function postQueuedCall(room,patientName){
    const response=await fetch('/api/calls',{
      method:'POST',
      headers:{'content-type':'application/json'},
      credentials:'same-origin',
      body:JSON.stringify({room,patientName})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error||`Falha (${response.status})`);
    return data;
  }

  async function callQueuedPatients(panel){
    if(!callQueue.length||!queuedRoom) return;
    const callButton=panel.querySelector('[data-call-queue]');
    const snapshot=[...callQueue];
    const room=queuedRoom;
    if(callButton){callButton.disabled=true;callButton.textContent='Chamando…';}
    queueStatus='';
    renderQueuePanel(panel);
    try{
      const results=await Promise.allSettled(snapshot.map(name=>postQueuedCall(room,name)));
      const failed=results.filter(result=>result.status==='rejected');
      if(failed.length){
        const successCount=snapshot.length-failed.length;
        if(successCount){
          const failedNames=snapshot.filter((_,index)=>results[index].status==='rejected');
          callQueue.splice(0,callQueue.length,...failedNames);
          queueStatus=`${successCount} chamado(s). ${failed.length} permaneceram na fila para tentar novamente.`;
        }else{
          queueStatus=failed[0]?.reason?.message||'Não foi possível chamar a fila.';
        }
      }else{
        callQueue.length=0;
        queuedRoom='';
        queueStatus=`${snapshot.length} ${snapshot.length===1?'paciente chamado':'pacientes chamados'} para a sala ${room}.`;
      }
    }catch(error){
      queueStatus=error?.message||'Não foi possível chamar a fila.';
    }
    renderQueuePanel(panel);
    document.getElementById('call-name')?.focus();
  }

  function ensureQueueControls(callCard){
    if(!callCard) return;
    const title=callCard.querySelector(':scope > h3');
    if(title){
      title.textContent='Chamar paciente';
      title.classList.add('caller-card-title');
      if(!title.nextElementSibling?.classList.contains('caller-card-subtitle')){
        const subtitle=document.createElement('p');
        subtitle.className='caller-card-subtitle';
        subtitle.textContent='Informe a sala e o nome do paciente para realizar a chamada.';
        title.insertAdjacentElement('afterend',subtitle);
      }
    }

    const roomField=document.getElementById('call-room')?.closest('.field');
    const nameField=document.getElementById('call-name')?.closest('.field');
    if(roomField){
      const label=roomField.querySelector('label');
      if(label) label.textContent='Sala / consultório';
      document.getElementById('call-room')?.setAttribute('placeholder','Ex.: 5');
    }
    if(nameField){
      const label=nameField.querySelector('label');
      if(label) label.textContent='Paciente';
      document.getElementById('call-name')?.setAttribute('placeholder','Nome completo do paciente');
    }

    const callButton=document.getElementById('call-btn');
    if(callButton&&!callButton.closest('.caller-action-row')){
      callButton.classList.remove('full');
      const row=document.createElement('div');
      row.className='caller-action-row';
      callButton.parentNode.insertBefore(row,callButton);
      row.appendChild(callButton);
      const add=document.createElement('button');
      add.type='button';
      add.className='btn queue-add-btn';
      add.id='queue-add-btn';
      add.textContent='＋ Adicionar à fila';
      row.appendChild(add);
    }
    const addButton=document.getElementById('queue-add-btn');

    let panel=callCard.querySelector('.caller-queue-panel');
    if(!panel){
      panel=document.createElement('section');
      panel.className='caller-queue-panel';
      panel.innerHTML=`
        <div class="queue-head">
          <div><span class="queue-kicker">CHAMADA EM GRUPO</span><h4>Fila de pacientes</h4><p data-queue-summary></p></div>
          <button type="button" class="btn small queue-clear" data-clear-queue>Limpar fila</button>
        </div>
        <div class="queue-list" data-queue-list></div>
        <div class="queue-footer">
          <div class="queue-status" data-queue-status role="status"></div>
          <button type="button" class="btn primary queue-call-btn" data-call-queue>🔊 Chamar fila</button>
        </div>`;
      const actionRow=callCard.querySelector('.caller-action-row');
      if(actionRow) actionRow.insertAdjacentElement('afterend',panel); else callCard.appendChild(panel);
    }
    if(addButton) addButton.onclick=()=>addCurrentPatientToQueue(panel);
    panel.querySelector('[data-clear-queue]').onclick=()=>{
      callQueue.length=0;
      queuedRoom='';
      queueStatus='Fila limpa.';
      renderQueuePanel(panel);
    };
    panel.querySelector('[data-call-queue]').onclick=()=>callQueuedPatients(panel);
    renderQueuePanel(panel);
  }

  function ensureCallsSection(grid,callCard){
    if(!grid||!callCard) return;
    const list=callCard.querySelector('.call-list');
    if(!list) return;
    let section=grid.parentElement?.querySelector('.caller-active-section');
    if(!section){
      section=document.createElement('section');
      section.className='caller-active-section';
      section.innerHTML=`
        <div class="caller-active-head">
          <div><span class="active-list-icon">☷</span><div><h3>Chamadas em andamento</h3><p>Pacientes que já foram chamados e aguardam atendimento.</p></div></div>
          <span class="active-count" data-active-count></span>
        </div>`;
      grid.insertAdjacentElement('afterend',section);
    }
    if(list.parentElement!==section) section.appendChild(list);
    const count=list.querySelectorAll('.call-item').length;
    const badge=section.querySelector('[data-active-count]');
    if(badge) badge.textContent=`${count} ${count===1?'aguardando':'aguardando'}`;
  }

  function refineCaller(){
    if((location.hash||'#painel')!=='#chamador') return;
    const content=document.getElementById('content');
    if(!content) return;
    content.classList.add('caller-only-view');
    content.classList.remove('reception-view');

    const pageHead=content.querySelector('.page-head');
    if(pageHead){
      const actions=pageHead.querySelector('.actions');
      if(actions) [...actions.querySelectorAll('a')].forEach(a=>{
        if((a.getAttribute('href')||'')==='#recepcao') a.remove();
      });
      const eyebrow=pageHead.querySelector('.eyebrow');
      const title=pageHead.querySelector('h1');
      const subtitle=pageHead.querySelector('p');
      if(eyebrow) eyebrow.textContent='CHAMADOR';
      if(title) title.textContent='Chamador';
      if(subtitle) subtitle.textContent='Chamada e controle dos pacientes da unidade.';
      ensureCallerClock(pageHead);
    }

    const grid=content.querySelector('.call-grid');
    if(grid){
      grid.classList.add('caller-control-grid');
      const preview=grid.querySelector(':scope > .now-card');
      if(preview) preview.remove();
      const callCard=grid.querySelector(':scope > .call-card');
      if(callCard){
        callCard.classList.add('caller-entry-card');
        ensureQueueControls(callCard);
        ensureCallsSection(grid,callCard);
      }
    }
  }

  function joinNames(names){
    if(names.length<=1) return names[0]||'';
    if(names.length===2) return `${names[0]} e ${names[1]}`;
    return `${names.slice(0,-1).join(', ')} e ${names[names.length-1]}`;
  }

  function installGroupedSpeech(){
    const synth=window.speechSynthesis;
    if(!synth||synth.__crsGroupedSpeechInstalled) return;
    synth.__crsGroupedSpeechInstalled=true;
    const originalSpeak=synth.speak.bind(synth);
    let pending=[];
    let timer=null;

    function flush(){
      if(timer){clearTimeout(timer);timer=null;}
      if(!pending.length) return;
      const batch=pending;
      pending=[];
      if(batch.length===1){
        originalSpeak(batch[0].utterance);
        return;
      }
      const room=batch[0].room;
      const names=joinNames(batch.map(item=>item.name));
      const grouped=new SpeechSynthesisUtterance(`Pacientes ${names}. Dirijam-se à sala ${room}. Repetindo: sala ${room}.`);
      grouped.lang='pt-BR';
      grouped.rate=.95;
      originalSpeak(grouped);
    }

    synth.speak=(utterance)=>{
      const text=String(utterance?.text||'');
      const match=text.match(/^Paciente\s+(.+?)\.\s+Dirija-se à sala\s+(\d+)\.\s+Repetindo:\s+sala\s+\2\.$/i);
      if(!match){
        originalSpeak(utterance);
        return;
      }
      const name=match[1].trim();
      const room=match[2];
      if(pending.length&&pending[0].room!==room) flush();
      pending.push({name,room,utterance});
      if(timer) clearTimeout(timer);
      timer=setTimeout(flush,850);
    };
  }

  async function toggleFullscreen(){
    try{
      if(document.fullscreenElement){
        await document.exitFullscreen();
      }else{
        const target=document.getElementById('content')||document.documentElement;
        await target.requestFullscreen({navigationUI:'hide'});
      }
    }catch{
      try{await document.documentElement.requestFullscreen();}catch{}
    }
    decorate();
  }

  function refineReception(){
    if((location.hash||'#painel')!=='#recepcao') return;
    const content=document.getElementById('content');
    if(!content) return;
    content.classList.add('reception-view');
    content.classList.remove('caller-only-view');

    const pageHead=content.querySelector('.page-head');
    if(pageHead){
      const h1=pageHead.querySelector('h1');
      const p=pageHead.querySelector('p');
      if(h1) h1.textContent='Recepção';
      if(p) p.textContent='Tela dedicada para exibição das chamadas aos pacientes.';
      const actions=pageHead.querySelector('.actions');
      if(actions){
        [...actions.querySelectorAll('a')].forEach(a=>{
          if((a.getAttribute('href')||'')==='#chamador') a.remove();
        });
        let fs=actions.querySelector('#reception-fullscreen-btn');
        if(!fs){
          fs=document.createElement('button');
          fs.type='button';
          fs.className='btn primary';
          fs.id='reception-fullscreen-btn';
          fs.onclick=toggleFullscreen;
          actions.prepend(fs);
        }
        fs.textContent=document.fullscreenElement?'Sair da tela cheia':'⛶ Tela cheia';
      }
    }

    const now=content.querySelector('.now-card');
    if(now) now.classList.add('reception-stage');
  }

  function cleanupRouteClasses(){
    const content=document.getElementById('content');
    if(!content) return;
    const route=(location.hash||'#painel').slice(1);
    if(route!=='chamador') content.classList.remove('caller-only-view');
    if(route!=='recepcao') content.classList.remove('reception-view');
  }

  function decorate(){
    ensureReceptionNav();
    refineInternacaoLabel();
    cleanupRouteClasses();
    refineCaller();
    refineReception();
    syncActiveNav();
  }

  installGroupedSpeech();
  const observer=new MutationObserver(()=>requestAnimationFrame(decorate));
  observer.observe(document.documentElement,{subtree:true,childList:true});
  window.addEventListener('hashchange',()=>requestAnimationFrame(decorate));
  document.addEventListener('fullscreenchange',()=>requestAnimationFrame(decorate));
  document.addEventListener('DOMContentLoaded',decorate,{once:true});
  decorate();
})();
