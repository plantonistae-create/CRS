(() => {
  'use strict';

  const MAX_UPLOAD = 12 * 1024 * 1024;
  const AUTO_COMPRESS_FROM = 1.8 * 1024 * 1024;
  const SUPPORTED_SERVER_IMAGES = new Set(['image/jpeg','image/png','image/webp']);

  function human(bytes){
    const n=Number(bytes||0);
    if(n>=1e9)return (n/1e9).toFixed(n>=10e9?1:2)+' GB';
    if(n>=1e6)return (n/1e6).toFixed(n>=100e6?0:1)+' MB';
    if(n>=1e3)return (n/1e3).toFixed(0)+' KB';
    return n+' B';
  }

  function ensureStyles(){
    if(document.getElementById('crs-attachment-styles'))return;
    const style=document.createElement('style');
    style.id='crs-attachment-styles';
    style.textContent=`
      .crs-storage-meter{border:1px solid #d6e2ed;background:#f7fbff;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#40576a}
      .crs-storage-meter strong{color:#173f62}.crs-storage-meter.warning{border-color:#ebc472;background:#fff9ea}.crs-storage-meter.high,.crs-storage-meter.critical{border-color:#e7a6aa;background:#fff6f7;color:#9f2931}
      .crs-meter-track{height:7px;background:#e5edf4;border-radius:99px;overflow:hidden;margin-top:7px}.crs-meter-fill{height:100%;background:#2f80c9;border-radius:99px;min-width:2px}.crs-storage-meter.warning .crs-meter-fill{background:#d89823}.crs-storage-meter.high .crs-meter-fill,.crs-storage-meter.critical .crs-meter-fill{background:#ce343d}
      .crs-file-note{font-size:11px;margin-top:7px;color:#617689}.crs-file-note.ok{color:#267954}.crs-file-note.err{color:#b82932}.crs-file-note.busy{color:#1d68a7}
      .crs-storage-help{font-size:10.5px;margin-top:5px;color:#718493}
    `;
    document.head.appendChild(style);
  }

  function noteFor(input){
    const root=input.closest('.field')||input.parentElement;
    let note=root?.querySelector('.crs-file-note');
    if(!note&&root){note=document.createElement('div');note.className='crs-file-note';root.appendChild(note);}
    return note;
  }

  function setNote(input,text,kind=''){
    const note=noteFor(input);if(!note)return;note.textContent=text;note.className='crs-file-note'+(kind?' '+kind:'');
  }

  function loadImage(file){
    return new Promise(async(resolve,reject)=>{
      if('createImageBitmap' in window){
        try{return resolve(await createImageBitmap(file,{imageOrientation:'from-image'}));}catch{}
      }
      const url=URL.createObjectURL(file),img=new Image();
      img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Não foi possível ler esta imagem.'))};
      img.src=url;
    });
  }

  function canvasBlob(canvas,type,quality){
    return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Falha ao comprimir imagem.')),type,quality));
  }

  async function compressImage(file){
    const mustConvert=!SUPPORTED_SERVER_IMAGES.has(file.type);
    if(!mustConvert&&file.size<=AUTO_COMPRESS_FROM)return {file,changed:false};
    const source=await loadImage(file);
    const sw=source.width||source.naturalWidth,sh=source.height||source.naturalHeight;
    if(!sw||!sh)throw new Error('Imagem inválida.');
    let maxDim=3200;
    let scale=Math.min(1,maxDim/Math.max(sw,sh));
    let w=Math.max(1,Math.round(sw*scale)),h=Math.max(1,Math.round(sh*scale));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,w,h);
    if(source.close)try{source.close()}catch{}
    let blob=await canvasBlob(canvas,'image/jpeg',0.92);
    if(blob.size>3.5*1024*1024){blob=await canvasBlob(canvas,'image/jpeg',0.87);}
    if(blob.size>3*1024*1024&&Math.max(w,h)>2600){
      const ratio=2600/Math.max(w,h),nw=Math.max(1,Math.round(w*ratio)),nh=Math.max(1,Math.round(h*ratio));
      const c2=document.createElement('canvas');c2.width=nw;c2.height=nh;const c2x=c2.getContext('2d',{alpha:false});c2x.fillStyle='#fff';c2x.fillRect(0,0,nw,nh);c2x.imageSmoothingEnabled=true;c2x.imageSmoothingQuality='high';c2x.drawImage(canvas,0,0,nw,nh);blob=await canvasBlob(c2,'image/jpeg',0.88);
    }
    if(!mustConvert&&blob.size>=file.size*0.98)return {file,changed:false};
    const base=(file.name||'imagem').replace(/\.[^.]+$/,'').slice(0,140)||'imagem';
    return {file:new File([blob],base+'.jpg',{type:'image/jpeg',lastModified:file.lastModified||Date.now()}),changed:true};
  }

  function redispatch(input,file){
    const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dataset.crsAttachmentReady='1';
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }

  document.addEventListener('change',async e=>{
    const input=e.target;if(!(input instanceof HTMLInputElement)||input.id!=='exam-file')return;
    if(input.dataset.crsAttachmentReady==='1'){delete input.dataset.crsAttachmentReady;return;}
    const file=input.files?.[0];if(!file)return;
    e.preventDefault();e.stopImmediatePropagation();
    try{
      if(file.type==='application/pdf'){
        if(file.size>MAX_UPLOAD)throw new Error('PDF acima de 12 MB. Reduza o arquivo antes de anexar.');
        setNote(input,`PDF ${human(file.size)} · enviado sem alteração.`,'busy');
        return redispatch(input,file);
      }
      if(!String(file.type||'').startsWith('image/'))throw new Error('Use PDF ou imagem.');
      setNote(input,file.size>AUTO_COMPRESS_FROM?'Otimizando imagem antes do envio…':'Preparando imagem…','busy');
      const result=await compressImage(file);
      if(result.file.size>MAX_UPLOAD)throw new Error('Mesmo após otimização, a imagem ficou acima de 12 MB.');
      setNote(input,result.changed?`Imagem otimizada: ${human(file.size)} → ${human(result.file.size)}. Enviando…`:`Imagem ${human(result.file.size)} · sem necessidade de compressão. Enviando…`,'ok');
      redispatch(input,result.file);
    }catch(error){
      input.value='';setNote(input,error.message||'Não foi possível preparar o arquivo.','err');
    }
  },true);

  async function storageData(){
    const res=await fetch('/api/clinical/storage',{credentials:'same-origin',cache:'no-store'});
    if(!res.ok)throw new Error('storage');
    return res.json();
  }

  async function refreshMeter(meter){
    if(!meter||meter.dataset.loading==='1')return;meter.dataset.loading='1';
    try{
      const d=await storageData(),pct=Math.max(0,Math.min(100,Number(d.percent||0)));
      meter.className='crs-storage-meter '+(d.level||'ok');
      const label=d.level==='critical'?'CRÍTICO':d.level==='high'?'ALTO':d.level==='warning'?'ATENÇÃO':'OK';
      meter.innerHTML=`<strong>Armazenamento de anexos: ${pct.toFixed(1)}% · ${human(d.bytes)} de ${human(d.limitBytes)}</strong><div class="crs-meter-track"><div class="crs-meter-fill" style="width:${Math.max(1,pct)}%"></div></div><div class="crs-storage-help">Status: ${label}. O CRS usa um limite interno de segurança; perto do teto, novos uploads são bloqueados em vez de continuar gravando.</div>`;
    }catch{meter.innerHTML='<strong>Armazenamento de anexos</strong><div class="crs-storage-help">Não foi possível consultar o uso agora.</div>';}
    finally{meter.dataset.loading='0';}
  }

  function enhanceExamPane(){
    ensureStyles();
    const input=document.getElementById('exam-file');if(!input)return;
    input.accept='application/pdf,image/*';
    const panel=input.closest('.panel');if(!panel)return;
    let meter=panel.querySelector('#crs-storage-meter');
    if(!meter){meter=document.createElement('div');meter.id='crs-storage-meter';meter.className='crs-storage-meter';meter.innerHTML='<strong>Armazenamento de anexos</strong><div class="crs-storage-help">Calculando uso…</div>';panel.insertBefore(meter,panel.firstChild);}
    refreshMeter(meter);
    const helper=[...panel.querySelectorAll('.patient-meta')].find(x=>x.textContent.includes('12 MB'));
    if(helper)helper.textContent='PDF ou imagem · até 12 MB após otimização. Imagens grandes são comprimidas automaticamente; PDFs permanecem inalterados. Arquivos continuam privados e exigem login.';
  }

  let scheduled=false;
  const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;enhanceExamPane();});});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',enhanceExamPane);
})();
