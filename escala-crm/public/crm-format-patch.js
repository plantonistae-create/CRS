(function(){
  function patchFields(){
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
    var template=document.querySelector('#template-form');
    if(template){
      var category=template.querySelector('select[name="category"]');
      if(category){
        var fixed=category.querySelector('option[value="fixo"]');
        var eventual=category.querySelector('option[value="eventual"]');
        var payment=category.querySelector('option[value="pagamento"]');
        if(fixed) fixed.textContent='Plantão de folha / fixo';
        if(eventual) eventual.textContent='Eventual fixo · conta nas 96h extras';
        if(payment) payment.remove();
        var label=category.closest('.field')?.querySelector('label');
        if(label) label.textContent='Vínculo no padrão semanal';
        if(!category.closest('.field')?.querySelector('.eventual-fixo-help')){
          var help=document.createElement('small');help.className='eventual-fixo-help';help.textContent='Eventual fixo se repete semanalmente, mas continua sendo eventual e consome o limite diário de 96h.';category.closest('.field')?.appendChild(help);
        }
      }
    }
  }
  patchFields();
  new MutationObserver(patchFields).observe(document.documentElement,{childList:true,subtree:true});
})();
