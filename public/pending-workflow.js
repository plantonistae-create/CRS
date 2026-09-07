(() => {
  'use strict';
  let timer=null,running=false;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  function chips(text){const n=norm(text),out=[];if(/exame|hemograma|laborat|raio|radiograf|tomograf|ecg|eletrocard/.test(n))out.push(['exam','Exames']);if(/medic|analges|antibiot|soro|hidrat|nebul|observacao apos/.test(n))out.push(['med','Medicação']);if(/vaga|regula|transfer|leito|internacao/.test(n))out.push(['reg','Vaga/Regulação']);if(/reavali|rever|nova avaliacao/.test(n))out.push(['review','Reavaliar']);return out.slice(0,3)}
  function pendingHtml(text){const clean=String(text||'').trim();if(!clean)return '<div class="workflow-pending none"><div class="workflow-pending-head"><span class="workflow-label">Pendências</span></div>Sem pendências registradas.</div>';const badges=chips(clean).map(([c,l])=>`<span class="workflow-chip ${c}">${l}</span>`).join('');return `<div class="workflow-pending"><div class="workflow-pending-head"><span class="workflow-label">Pendências</span>${badges}</div>${esc(clean)}</div>`}
  async function enhance(){if(running)return;const route=(location.hash||'').slice(1);if(!['censo','reavaliacoes'].includes(route))return;running=true;try{const res=await fetch('/api/clinical/state',{credentials:'same-origin'});if(!res.ok)return;const data=await res.json();if(route==='reavaliacoes'){const list=(data.patients||[]).filter(p=>p.status==='reavaliacao');document.querySelectorAll('.review-card').forEach((card,i)=>{const p=list[i];if(!p)return;const current=card.querySelector('.workflow-pending');const html=pendingHtml(p.pending);const holder=document.createElement('div');holder.innerHTML=html;const next=holder.firstElementChild;if(current){if(current.outerHTML!==next.outerHTML)current.replaceWith(next)}else{const actions=card.querySelector('.review-actions');actions?card.insertBefore(next,actions):card.appendChild(next)}})}else{document.querySelectorAll('.patient-pending').forEach(el=>{const t=(el.textContent||'').trim();const active=t&&!/^sem pend/i.test(t);el.classList.toggle('workflow-active',active);el.classList.toggle('workflow-empty',!active)})}}catch{}finally{running=false}}
  function schedule(){clearTimeout(timer);timer=setTimeout(enhance,120)}
  window.addEventListener('hashchange',schedule);
  const target=document.getElementById('content');if(target)new MutationObserver(schedule).observe(target,{childList:true,subtree:true});
  schedule();
})();
