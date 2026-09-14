(function(){
  function patchCrmFields(){
    document.querySelectorAll('input[name="crm"]').forEach(function(input){
      input.setAttribute('inputmode','numeric');
      input.setAttribute('pattern','[0-9]{4,5}');
      input.setAttribute('minlength','4');
      input.setAttribute('maxlength','5');
      input.setAttribute('placeholder','0000 ou 00000');
    });
    document.querySelectorAll('label').forEach(function(label){
      var text=(label.textContent||'').trim();
      if(text==='CRM'||text==='CRM (5 dígitos)') label.textContent='CRM (4 ou 5 dígitos, somente números)';
    });
    document.querySelectorAll('small,p.muted').forEach(function(el){
      var text=el.textContent||'';
      if(text.includes('CRM de 5 dígitos')) el.textContent=text.replace('CRM de 5 dígitos','CRM de 4 ou 5 dígitos, somente números');
    });
  }
  patchCrmFields();
  new MutationObserver(patchCrmFields).observe(document.documentElement,{childList:true,subtree:true});
})();
