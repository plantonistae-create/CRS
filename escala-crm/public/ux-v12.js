(function(){
  const PERIODS={
    matutino:{label:'Matutino',start:'07:00',end:'13:00',hours:6,order:1},
    vespertino:{label:'Vespertino',start:'13:00',end:'19:00',hours:6,order:2},
    diurno:{label:'Diurno',start:'07:00',end:'19:00',hours:12,order:3},
    noturno:{label:'Noturno',start:'19:00',end:'07:00',hours:12,order:4},
    cinderela:{label:'Cinderela',start:'19:00',end:'01:00',hours:6,order:5}
  };

  function periodKeyForShift(s){
    const match=Object.entries(PERIODS).find(([,p])=>p.start===s.start&&p.end===s.end&&Number(p.hours)===Number(s.hours));
    return match?match[0]:'outro';
  }
  function periodLabelForShift(s){
    const key=periodKeyForShift(s);
    return key==='outro'?`${s.start}–${s.end}`:PERIODS[key].label;
  }
  function periodOrderForShift(s){
    const key=periodKeyForShift(s);
    return key==='outro'?9:PERIODS[key].order;
  }
  function periodOptions(selected='diurno'){
    return Object.entries(PERIODS).map(([k,p])=>`<option value="${k}" ${k===selected?'selected':''}>${p.label} · ${p.start}–${p.end} · ${p.hours}h</option>`).join('');
  }
  window.applyPeriodPreset=function(select){
    const p=PERIODS[select.value]||PERIODS.diurno;
    const form=select.form||select.closest('form');
    if(!form)return;
    const start=form.querySelector('[name="start"]'),end=form.querySelector('[name="end"]'),hours=form.querySelector('[name="hours"]');
    if(start)start.value=p.start;if(end)end.value=p.end;if(hours)hours.value=p.hours;
  };
  function periodField(selected='diurno'){
    const p=PERIODS[selected]||PERIODS.diurno;
    return `<div class="field span2"><label>Período do plantão</label><select name="periodPreset" onchange="applyPeriodPreset(this)">${periodOptions(selected)}</select><small>O horário e a carga horária são preenchidos automaticamente.</small></div><input type="hidden" name="start" value="${p.start}"><input type="hidden" name="end" value="${p.end}"><input type="hidden" name="hours" value="${p.hours}">`;
  }

  calendar=function(admin=false){
    const [y,m]=state.month.split('-').map(Number),days=new Date(y,m,0).getDate(),list=state.data?.shifts||[];
    let html='';
    for(let d=1;d<=days;d++){
      const date=`${state.month}-${String(d).padStart(2,'0')}`,dateObj=new Date(`${date}T00:00:00Z`),shifts=list.filter(s=>s.date===date).sort((a,b)=>periodOrderForShift(a)-periodOrderForShift(b)||String(a.start).localeCompare(String(b.start))||String(a.end).localeCompare(String(b.end))),used=shifts.filter(s=>s.category!=='fixo').reduce((a,s)=>a+Number(s.hours),0),avail=Math.max(0,96-used);
      const groups={};
      shifts.forEach(s=>{const label=periodLabelForShift(s);(groups[label]||(groups[label]=[])).push(s)});
      const labels=Object.keys(groups).sort((a,b)=>{
        const sa=groups[a][0],sb=groups[b][0];return periodOrderForShift(sa)-periodOrderForShift(sb)||String(sa.start).localeCompare(String(sb.start));
      });
      const periodSummary=labels.map(label=>`${label}: ${groups[label].length}`).join(' · ');
      const inside=labels.map(label=>`<div class="period-group"><div class="period-title">${label}</div>${groups[label].map(s=>shiftCard(s,admin)).join('')}</div>`).join('');
      html+=`<details class="day-card compact-day ${shifts.length?'':'empty'}"><summary class="day-summary"><div><div class="date-num">${d}</div><div class="muted day-week">${DAYS[dateObj.getUTCDay()]}</div></div><div class="day-summary-main"><b>${shifts.length?`${shifts.length} plantão${shifts.length>1?'ões':''}`:'Sem plantonistas'}</b><small>${periodSummary||'Clique para visualizar'}</small></div><div class="extra-meter"><strong>${avail}h livres</strong>${used}h / 96h extras</div></summary><div class="day-expanded">${inside||'<div class="muted">Sem plantonistas lançados</div>'}</div></details>`;
    }
    return `<div class="calendar-grid compact-calendar">${html}</div>`;
  };

  scheduleAdmin=function(){return `<div class="hero"><div><div class="eyebrow">Administração</div><h1>Escala mensal</h1><p>Altere apenas o dia necessário sem modificar o padrão semanal.</p></div>${monthbar()}</div><section class="card"><h2>Adicionar plantonista no dia</h2><form id="shift-form" class="form-grid">${doctorSelect('doctorId')}<div class="field"><label>Data</label><input type="date" name="date" required></div>${periodField('diurno')}${functionSelect('function')}${categorySelect('category')}<div class="field"><label>&nbsp;</label><button class="btn primary" type="submit">Adicionar</button></div></form></section><section class="section"><div class="section-head"><h2>${esc(monthLabel(state.month))}</h2><button class="btn" data-action="generate">Gerar mês pelo padrão semanal</button></div>${calendar(true)}</section><section class="card section"><h2>Lançamento administrativo retroativo</h2><form id="record-form" class="form-grid">${doctorSelect('doctorId')}<div class="field"><label>Tipo</label><select name="kind"><option value="atestado">Atestado</option><option value="debt">Horas a compensar</option><option value="paid">Horas compensadas/pagas</option><option value="extra">Plantão extra</option></select></div><div class="field"><label>Data do fato</label><input type="date" name="eventDate" required></div><div class="field"><label>Horas</label><input type="number" step="0.5" name="hours" value="12" required></div><div class="field"><label>Início (se extra)</label><input type="time" name="start" value="07:00"></div><div class="field"><label>Fim (se extra)</label><input type="time" name="end" value="19:00"></div>${functionSelect('function')}${categorySelect('category','eventual')}<div class="field span4"><label>Motivo do lançamento retroativo/administrativo</label><input name="reason" required placeholder="Ex.: implantação do sistema; informação recebida posteriormente"></div><div class="field"><button class="btn primary" type="submit">Registrar</button></div></form></section>`;};

  templatesView=function(){const grouped=Array.from({length:7},(_,i)=>(state.data.templates||[]).filter(t=>t.weekday===i));return `<div class="hero"><div><div class="eyebrow">Configuração</div><h1>Padrão semanal</h1><p>Defina os médicos fixos por dia da semana usando os períodos padronizados da unidade.</p></div></div><section class="card"><form id="template-form" class="form-grid"><div class="field"><label>Dia</label><select name="weekday">${DAYS.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}</select></div>${doctorSelect('doctorId')}${periodField('diurno')}${functionSelect('function')}${categorySelect('category','fixo')}<div class="field"><label>&nbsp;</label><button class="btn primary" type="submit">Adicionar ao padrão</button></div></form></section><section class="section"><div class="week-grid">${grouped.map((arr,i)=>`<div class="week-col"><h3>${DAYS[i]}</h3>${arr.sort((a,b)=>String(a.start).localeCompare(String(b.start))).map(t=>{const d=state.data.doctorsList.find(x=>x.id===t.doctorId);const p=periodLabelForShift(t);return `<div class="template-item"><b>${esc(d?.name||'Médico')}</b><br><strong>${esc(p)}</strong> · ${esc(t.start)}–${esc(t.end)} · ${t.hours}h<br>${esc(FN[t.function])} · ${esc(CAT[t.category])}<br><button class="btn small danger" data-template-delete="${t.id}">Remover</button></div>`}).join('')||'<span class="muted">Sem padrão</span>'}</div>`).join('')}</div></section>`;};

  try{render();}catch(e){console.error('ux-v12-render',e)}
})();
