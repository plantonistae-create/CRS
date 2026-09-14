(()=>{
  'use strict';

  function replaceExactText(root, from, to){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];
    while(walker.nextNode()) nodes.push(walker.currentNode);
    for(const node of nodes){
      const value=node.nodeValue||'';
      if(value.trim()===from) node.nodeValue=value.replace(from,to);
    }
  }

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
      const subtitle=pageHead.querySelector('p');
      if(subtitle) subtitle.textContent='Chamada e controle dos pacientes da unidade.';
    }

    const grid=content.querySelector('.call-grid');
    if(grid){
      grid.classList.add('caller-control-grid');
      const preview=grid.querySelector(':scope > .now-card');
      if(preview) preview.remove();
    }
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

  const observer=new MutationObserver(()=>requestAnimationFrame(decorate));
  observer.observe(document.documentElement,{subtree:true,childList:true});
  window.addEventListener('hashchange',()=>requestAnimationFrame(decorate));
  document.addEventListener('fullscreenchange',()=>requestAnimationFrame(decorate));
  document.addEventListener('DOMContentLoaded',decorate,{once:true});
  decorate();
})();
