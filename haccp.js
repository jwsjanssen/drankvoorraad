/* HACCP-registraties per keuken: leveringen, kerntemperaturen, terugkoelen, warmhouden, opwarmen en frituurvet.
   Eén pagina: haccp/?p=<plek>. Anders dan de dagelijkse koeltemperaturen zijn dit losse registraties, zo vaak als nodig.
   Gegevens (zie backend.js):
     haccp/<plek>                 instellingen: {types:{<soort>:{on,target}},norms:{...}}
     haccplog/<plek>_<JJJJ-MM>    registraties: {entries:{<id>:{type,day,at,by,f:{...},ok,nm,note,gone}}}
   Bij het opslaan wordt de uitkomst (ok) en de norm van dat moment (nm) meebewaard; latere normwijzigingen veranderen oude registraties niet.
   Verwijderen is doorhalen (gone): de registratie blijft in de database staan. */
(function(){
'use strict';

var PLEKKEN=window.DV_PLEKKEN||[];
var KEY=(/[?&]p=([a-z0-9-]+)/.exec(location.search)||[])[1]||'';
var P=PLEKKEN.filter(function(p){return p.key===KEY})[0];
var DAGEN=['zo','ma','di','wo','do','vr','za'],MND=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'],
    MAAND=['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];

var ORDER=['levering','kern','koel','warm','regen','friet'];
var TYPES={
  levering:{label:'Levering ontvangen',short:'Levering',what:'Leverancier',ph:'bv. Sligro'},
  kern:{label:'Kerntemperatuur bij bereiden',short:'Bereiden',what:'Product',ph:'bv. kipfilet'},
  koel:{label:'Terugkoelen',short:'Terugkoelen',what:'Product',ph:'bv. tomatensoep'},
  warm:{label:'Warmhouden',short:'Warmhouden',what:'Product',ph:'bv. jus in de bain-marie'},
  regen:{label:'Opwarmen',short:'Opwarmen',what:'Product',ph:'bv. stoofvlees'},
  friet:{label:'Frituurvet',short:'Frituur',what:'Frituur',ph:'bv. frituur links'}
};
var SOORT={koel:'Gekoeld',vries:'Diepvries',droog:'Ongekoeld'};
/* Standaardnormen; per keuken aan te passen bij Instellingen. */
var NORM={lev_koel:7,lev_vries:-15,kern:75,koel_temp:7,koel_uren:5,warm:60,regen:75,friet:175};
var NORMF={
  levering:[['lev_koel','Gekoeld: maximaal (°C)'],['lev_vries','Diepvries: maximaal (°C)']],
  kern:[['kern','Minimaal (°C)']],
  koel:[['koel_temp','Terug naar maximaal (°C)'],['koel_uren','Binnen (uren)']],
  warm:[['warm','Minimaal (°C)']],
  regen:[['regen','Minimaal (°C)']],
  friet:[['friet','Maximaal (°C)']]
};

var S={db:null,dl:null,view:'vandaag',day:null,follow:true,month:null,cfg:null,cfgLoaded:false,logs:{},logsLoaded:false};
var chain={},toastT;

/* ---------- hulpjes ---------- */
function $(s,r){return (r||document).querySelector(s)}
function $all(s,r){return [].slice.call((r||document).querySelectorAll(s))}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function ls(k,v){try{if(v===undefined)return localStorage.getItem('dv.'+k);localStorage.setItem('dv.'+k,v)}catch(e){return null}}
function toast(msg){var t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true},4200)}
function openModal(html){var m=$('#modal');m.innerHTML='<div class="sheet" role="dialog" aria-modal="true" tabindex="-1">'+html+'</div>';m.hidden=false;var f=$('.sheet',m);if(f)f.focus()}
function closeModal(){var m=$('#modal');m.hidden=true;m.innerHTML=''}
function modalOpen(){return !$('#modal').hidden}
function p2(n){return (n<10?'0':'')+n}
function ymd(d){return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())}
function hm(d){return p2(d.getHours())+':'+p2(d.getMinutes())}
function today(){return ymd(new Date())}
function toDate(s){var a=s.split('-');return new Date(+a[0],+a[1]-1,+a[2]||1,12)}
function addDays(s,n){var d=toDate(s);d.setDate(d.getDate()+n);return ymd(d)}
function addMonths(m,n){var d=toDate(m+'-01');d.setMonth(d.getMonth()+n);return ymd(d).slice(0,7)}
function daysIn(m){var a=m.split('-');return new Date(+a[0],+a[1],0).getDate()}
function wday(s){var d=toDate(s).getDay();return d===0?7:d}
function isoWeek(s){var d=toDate(s);d.setDate(d.getDate()+4-wday(s));var y=d.getFullYear(),w=Math.ceil(((d-new Date(y,0,1,12))/864e5+1)/7);return y+'-W'+p2(w)}
function dayLabel(s){var d=toDate(s);return DAGEN[d.getDay()]+' '+d.getDate()+' '+MND[d.getMonth()]}
function monthLabel(m){var a=m.split('-');return MAAND[+a[1]-1]+' '+a[0]}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5)}
function parseNum(v){v=String(v==null?'':v).trim().replace(/−/g,'-').replace(',','.').replace(/\s|°|c$/gi,'');if(!/^[+-]?\d{1,3}(\.\d{1,2})?$/.test(v))return null;var n=parseFloat(v);return isFinite(n)?n:null}
function fmtT(t){var a=Math.round(Math.abs(t)*10)/10;return (t<0&&a!==0?'−':'')+String(a).replace('.',',')}
function nl(n){return String(n).replace('.',',')}
function dur(ms){var m=Math.max(0,Math.round(ms/6e4)),h=Math.floor(m/60);return (h?h+' u ':'')+(m%60)+' min'}
function atOf(day,time){var a=day.split('-'),t=/^(\d{1,2}):(\d{2})$/.exec(time||'');var d=new Date(+a[0],+a[1]-1,+a[2],t?+t[1]:12,t?+t[2]:0);return d.toISOString()}

/* ---------- instellingen en normen ---------- */
function norms(){var o={},c=(S.cfg&&S.cfg.norms)||{};Object.keys(NORM).forEach(function(k){o[k]=typeof c[k]==='number'?c[k]:NORM[k]});return o}
function tcfg(t){var c=(S.cfg&&S.cfg.types&&S.cfg.types[t])||{};return {on:c.on!==false,target:typeof c.target==='number'?c.target:1}}
function activeTypes(){return ORDER.filter(function(t){return tcfg(t).on})}
function normText(t,n){
  n=n||norms();
  if(t==='levering')return 'gekoeld max '+fmtT(n.lev_koel)+' °C · diepvries max '+fmtT(n.lev_vries)+' °C';
  if(t==='kern')return 'min '+fmtT(n.kern)+' °C';
  if(t==='koel')return 'binnen '+nl(n.koel_uren)+' uur naar max '+fmtT(n.koel_temp)+' °C';
  if(t==='warm')return 'min '+fmtT(n.warm)+' °C';
  if(t==='regen')return 'min '+fmtT(n.regen)+' °C';
  return 'max '+fmtT(n.friet)+' °C';
}
/* uitkomst van een registratie: true = binnen de norm, false = afwijking, null = loopt nog (terugkoelen) */
function judge(e,n){
  n=n||norms();var f=e.f||{};
  if(e.type==='levering'){
    var okT=f.soort==='droog'||typeof f.t!=='number'?f.soort==='droog':f.t<=(f.soort==='vries'?n.lev_vries:n.lev_koel);
    return okT&&f.pak!==false;
  }
  if(e.type==='kern')return f.t>=n.kern;
  if(e.type==='warm')return f.t>=n.warm;
  if(e.type==='regen')return f.t>=n.regen;
  if(e.type==='friet')return f.t<=n.friet;
  if(e.type==='koel'){
    if(typeof f.t2!=='number'||!f.at2)return (Date.now()-Date.parse(e.at))/36e5>n.koel_uren?false:null;
    return f.t2<=n.koel_temp&&(Date.parse(f.at2)-Date.parse(e.at))/36e5<=n.koel_uren;
  }
  return true;
}
function isOpen(e){return e.type==='koel'&&(typeof (e.f||{}).t2!=='number')}
function outcome(e){return isOpen(e)?judge(e):(typeof e.ok==='boolean'?e.ok:judge(e))}
function whyBad(e){
  var f=e.f||{},n=norms(),a=[];
  if(e.type==='levering'){
    if(f.soort!=='droog'&&typeof f.t==='number'&&f.t>(f.soort==='vries'?n.lev_vries:n.lev_koel))a.push('te warm geleverd');
    if(f.pak===false)a.push('verpakking of houdbaarheid niet in orde');
  }else if(e.type==='koel'){
    if(isOpen(e))a.push('staat langer dan '+nl(n.koel_uren)+' uur open');
    else{if(f.t2>n.koel_temp)a.push('niet koud genoeg');if((Date.parse(f.at2)-Date.parse(e.at))/36e5>n.koel_uren)a.push('duurde te lang')}
  }else if(e.type==='friet')a.push('vet te heet');
  else a.push('te koud');
  return a.join(' en ');
}
function valueText(e){
  var f=e.f||{};
  if(e.type==='levering')return SOORT[f.soort]+(typeof f.t==='number'?' · '+fmtT(f.t)+' °C':'')+(f.pak===false?' · verpakking of houdbaarheid niet in orde':'');
  if(e.type==='koel'){
    var s=(typeof f.t1==='number'?fmtT(f.t1)+' °C':'gestart '+hm(new Date(e.at)));
    if(isOpen(e))return s+' · loopt '+dur(Date.now()-Date.parse(e.at));
    return s+' → '+fmtT(f.t2)+' °C in '+dur(Date.parse(f.at2)-Date.parse(e.at));
  }
  if(e.type==='friet')return fmtT(f.t)+' °C'+(f.ververst?' · vet ververst':'');
  return fmtT(f.t)+' °C';
}

/* ---------- gegevens ---------- */
function entries(){
  var a=[];
  Object.keys(S.logs).forEach(function(id){var es=(S.logs[id]&&S.logs[id].entries)||{};Object.keys(es).forEach(function(eid){var e=es[eid];if(e&&TYPES[e.type]&&e.day&&e.at&&!e.gone)a.push({id:eid,doc:id,type:e.type,day:e.day,at:e.at,by:e.by||'',f:e.f||{},ok:e.ok,nm:e.nm||'',note:e.note||''})})});
  return a.sort(function(x,y){return x.at<y.at?1:-1});
}
function find(eid){return entries().filter(function(e){return e.id===eid})[0]}
function write(path,patch){
  function go(){return S.db.doc(path).get().then(function(s){return s.exists?S.db.doc(path).update(patch):S.db.doc(path).set(patch)})}
  function attempt(){return go().then(null,function(e){
    if(e&&e.code==='unavailable')return new Promise(function(res){setTimeout(res,1500)}).then(go);
    throw e;
  })}
  var p=(chain[path]||Promise.resolve()).then(attempt,attempt);
  chain[path]=p.then(null,function(){});
  return p;
}
function saveEntry(docId,eid,fields){
  var es={};es[eid]=fields;
  return write('haccplog/'+docId,{page:KEY,entries:es});
}
function suggestions(type){
  var seen={},a=[];
  entries().forEach(function(e){var x=(e.f.x||'').trim();if(e.type===type&&x&&!seen[x.toLowerCase()]){seen[x.toLowerCase()]=1;a.push(x)}});
  return a.slice(0,30);
}

/* ---------- weergave ---------- */
function render(){
  $all('.tabs a').forEach(function(a){if(a.getAttribute('href')==='#'+S.view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  var v=$('#view');
  if(!S.cfgLoaded||!S.logsLoaded){v.innerHTML='<div class="empty"><h3>Registraties laden…</h3><p>De instellingen en registraties worden opgehaald.</p></div>';return}
  var keep=document.activeElement&&document.activeElement.id==='naam'?document.activeElement.value:null;
  if(S.view==='vandaag')renderDay();else if(S.view==='overzicht')renderMonth();else renderSettings();
  if(keep!==null){var f=$('#naam');if(f){f.value=keep;f.focus()}}
}
function pillFor(e){
  var o=outcome(e);
  if(o===null)return '<span class="pill warn">Loopt</span>';
  return o?'<span class="pill good">In orde</span>':'<span class="pill bad">Afwijking</span>';
}
function entryRow(e,withDay){
  var d=new Date(e.at),o=outcome(e);
  return '<li><button type="button" class="hrow'+(o===false?' bad':'')+'" data-eid="'+esc(e.id)+'"><span class="htime num">'+(withDay?esc(dayLabel(e.day))+'<br>':'')+hm(d)+'</span>'
    +'<span class="hmain"><b>'+esc(TYPES[e.type].short)+(e.f.x?' · '+esc(e.f.x):'')+'</b><span class="hsub">'+esc(valueText(e))+(e.by?' · '+esc(e.by):'')+'</span>'
    +(o===false?'<span class="hbad">'+esc(cap(whyBad(e)))+(e.note?'. Actie: '+esc(e.note):'. Nog geen actie genoteerd.')+'</span>':(e.note?'<span class="hsub">'+esc(e.note)+'</span>':''))+'</span>'
    +pillFor(e)+'</button></li>';
}
function renderDay(){
  var day=S.day,isToday=day===today(),all=entries(),wk=isoWeek(day),n=norms();
  var todays=all.filter(function(e){return e.day===day}),open=all.filter(function(e){return isOpen(e)&&e.day!==day});
  var h='<section class="stack">'
    +'<div class="daybar"><button class="iconbtn" id="prev" aria-label="Vorige dag">‹</button>'
    +'<div class="dy"><b>'+(isToday?'Vandaag · ':'')+esc(dayLabel(day))+'</b><span class="muted">'+todays.length+' '+(todays.length===1?'registratie':'registraties')+' · week '+(+wk.slice(6))+'</span></div>'
    +'<button class="iconbtn" id="next" aria-label="Volgende dag"'+(isToday?' disabled':'')+'>›</button></div>';
  if(!isToday)h+='<div class="note warn spread"><span>Je bekijkt een eerdere dag. Wat je hier registreert, telt voor '+esc(dayLabel(day))+'.</span><button class="btn" id="totoday">Naar vandaag</button></div>';
  h+='<div class="card"><div class="field"><label for="naam">Je naam</label><input class="input" id="naam" autocomplete="name" placeholder="Je naam" value="'+esc(ls('naam')||'')+'"><small>Je naam komt bij elke registratie en wordt op dit apparaat onthouden.</small></div></div>';
  if(open.length){
    h+='<div class="stack"><h3>Loopt nog</h3><ul class="rows">'+open.map(function(e){return entryRow(e,true)}).join('')+'</ul></div>';
  }
  var types=activeTypes();
  h+='<div class="stack"><h3>Nieuwe registratie</h3>';
  if(!types.length)h+='<div class="card empty"><p>Er staan geen soorten registraties aan. Zet ze aan bij Instellingen.</p></div>';
  else{
    h+='<ul class="rows hadd">';
    types.forEach(function(t){
      var c=tcfg(t),cnt=all.filter(function(e){return e.type===t&&isoWeek(e.day)===wk}).length;
      var pill=c.target>0?'<span class="pill'+(cnt>=c.target?' good':'')+'">deze week '+cnt+' van '+c.target+'</span>':(cnt?'<span class="pill">deze week '+cnt+'</span>':'');
      h+='<li><div class="hmain"><b>'+esc(TYPES[t].label)+'</b><span class="hsub">'+esc(normText(t,n))+'</span>'+(pill?'<span>'+pill+'</span>':'')+'</div>'
        +'<button type="button" class="btn primary" data-new="'+t+'" aria-label="'+esc(TYPES[t].label)+' registreren">+ Nieuw</button></li>';
    });
    h+='</ul>';
  }
  h+='</div><div class="stack"><h3>Geregistreerd op '+esc(dayLabel(day))+'</h3>';
  h+=todays.length?'<ul class="rows">'+todays.map(function(e){return entryRow(e,false)}).join('')+'</ul>':'<div class="card"><p class="muted">Nog niets geregistreerd op deze dag.</p></div>';
  h+='</div></section>';
  $('#view').innerHTML=h;
}

/* --- formulier --- */
function field(id,label,inner,small){return '<div class="field"><label for="'+id+'">'+label+'</label>'+inner+(small?'<small>'+small+'</small>':'')+'</div>'}
function tempField(id,label,val,neg,small){
  return '<div class="field"><label for="'+id+'">'+label+'</label><div class="tin"><button type="button" class="sign" data-for="'+id+'" data-neg="'+(neg?'1':'0')+'" aria-label="Boven of onder nul">'+(neg?'−':'+')+'</button>'
    +'<input class="tval" id="'+id+'" inputmode="decimal" autocomplete="off" value="'+(typeof val==='number'?nl(Math.abs(val)):'')+'"><span class="unit" aria-hidden="true">°C</span></div>'+(small?'<small>'+small+'</small>':'')+'</div>';
}
function yesNo(id,label,val,yes,no){
  return '<div class="field"><span class="flabel" id="'+id+'-l">'+label+'</span><div class="seg soft" role="group" aria-labelledby="'+id+'-l" id="'+id+'"><button type="button" data-yn="1" aria-pressed="'+(val?'true':'false')+'">'+yes+'</button><button type="button" data-yn="0" aria-pressed="'+(val?'false':'true')+'">'+no+'</button></div></div>';
}
function openEntry(type,eid){
  var e=eid?find(eid):null;if(eid&&!e)return;
  type=e?e.type:type;
  var T=TYPES[type],f=e?e.f:{},n=norms(),finishing=e&&isOpen(e);
  var now=new Date(),time=e?hm(new Date(e.at)):hm(now);
  var h='<h2>'+esc(e?(finishing?'Terugkoelen afronden':T.label+' aanpassen'):T.label)+'</h2><p class="muted" style="margin-top:-8px">Norm: '+esc(normText(type,n))+'</p>';
  h+='<datalist id="h-sug">'+suggestions(type).map(function(x){return '<option value="'+esc(x)+'">'}).join('')+'</datalist>';
  h+=field('h-x',T.what,'<input class="input" id="h-x" list="h-sug" autocomplete="off" maxlength="80" placeholder="'+esc(T.ph)+'" value="'+esc(f.x||'')+'">');
  if(type==='levering'){
    h+=field('h-soort','Soort producten','<select class="input" id="h-soort">'+Object.keys(SOORT).map(function(k){return '<option value="'+k+'"'+(k===(f.soort||'koel')?' selected':'')+'>'+SOORT[k]+'</option>'}).join('')+'</select>');
    h+='<div id="h-twrap">'+tempField('h-t','Gemeten temperatuur',f.t,typeof f.t==='number'?f.t<0:false,'Meet tussen twee verpakkingen of in het product.')+'</div>';
    h+=yesNo('h-pak','Verpakking en houdbaarheid',f.pak!==false,'In orde','Niet in orde');
  }else if(type==='koel'){
    h+=tempField('h-t1','Temperatuur bij de start (optioneel)',f.t1,false);
    if(e)h+=tempField('h-t2','Temperatuur nu',f.t2,typeof f.t2==='number'&&f.t2<0,'Vul dit in als het product is teruggekoeld. De tijd sinds de start telt mee.');
    else h+='<p class="note">Sla nu de start op. Is het product koud, open de registratie dan opnieuw en vul de eindtemperatuur in.</p>';
  }else if(type==='friet'){
    h+=tempField('h-t','Temperatuur van het vet',f.t,false);
    h+=yesNo('h-ververst','Vet ververst',!!f.ververst,'Ja','Nee');
  }else h+=tempField('h-t',type==='warm'?'Gemeten temperatuur':'Kerntemperatuur',f.t,false,type==='warm'?'':'Meet in het midden van het dikste deel.');
  h+=field('h-time',type==='koel'?'Tijdstip van de start':'Tijdstip','<input class="input" id="h-time" type="time" value="'+esc(time)+'">');
  h+=field('h-note','Opmerking of genomen actie','<input class="input" id="h-note" autocomplete="off" maxlength="300" placeholder="bv. levering geweigerd, opnieuw verhit" value="'+esc(e?e.note:'')+'">','Bij een afwijking: noteer wat je hebt gedaan.');
  h+='<p class="gate-msg" id="h-msg" role="alert" style="min-height:0"></p>';
  h+='<div class="spread" id="h-btns">'+(e?'<button class="btn danger" id="h-del">Verwijderen</button>':'<span></span>')+'<span class="rowflex"><button class="btn ghost" data-close>Annuleren</button><button class="btn primary" id="h-save">Opslaan</button></span></div>';
  openModal(h);
  var sheet=$('#modal .sheet');sheet.setAttribute('data-type',type);sheet.setAttribute('data-eid',eid||'');
  syncForm();
  setTimeout(function(){var t=finishing?$('#h-t2'):(e?null:$('#h-x'));if(t)t.focus()},50);
}
function syncForm(){
  var s=$('#h-soort');if(!s)return;
  var w=$('#h-twrap');w.hidden=s.value==='droog';
  var sg=$('.sign',w),inp=$('#h-t');
  if(!inp.value){sg.setAttribute('data-neg',s.value==='vries'?'1':'0');sg.textContent=s.value==='vries'?'−':'+'}
}
function readTemp(id,required,msg){
  var inp=$('#'+id);if(!inp)return {v:undefined};
  var raw=inp.value.trim();
  if(raw===''){if(required){msg.textContent='Vul de temperatuur in.';inp.focus();return {err:true}}return {v:null}}
  var nmb=parseNum(raw);
  if(nmb===null){msg.textContent='Vul bij de temperatuur een getal in, bijvoorbeeld 4 of 72,5.';inp.focus();return {err:true}}
  var sg=$('.sign[data-for="'+id+'"]'),neg=/^[-−]/.test(raw)||(sg.getAttribute('data-neg')==='1'&&!/^\+/.test(raw));
  return {v:neg?-Math.abs(nmb):Math.abs(nmb)};
}
function doSave(){
  var sheet=$('#modal .sheet'),type=sheet.getAttribute('data-type'),eid=sheet.getAttribute('data-eid'),msg=$('#h-msg'),old=eid?find(eid):null;
  msg.textContent='';
  var nm=(ls('naam')||'').trim();
  if(!nm){closeModal();toast('Vul eerst je naam in.');var nf=$('#naam');if(nf)nf.focus();return}
  var x=$('#h-x').value.trim().replace(/\s+/g,' ');
  if(!x){msg.textContent='Vul '+(type==='levering'?'de leverancier':type==='friet'?'de frituur':'het product')+' in.';$('#h-x').focus();return}
  var f={x:x},r;
  if(type==='levering'){
    f.soort=$('#h-soort').value;f.pak=$('#h-pak [data-yn="1"]').getAttribute('aria-pressed')==='true';
    if(f.soort==='droog')f.t=null;else{r=readTemp('h-t',true,msg);if(r.err)return;f.t=r.v}
  }else if(type==='koel'){
    r=readTemp('h-t1',false,msg);if(r.err)return;f.t1=r.v;
    if(old){r=readTemp('h-t2',false,msg);if(r.err)return;f.t2=r.v;f.at2=r.v===null?null:(old.f.at2&&old.f.t2===r.v?old.f.at2:new Date().toISOString())}
  }else{
    r=readTemp('h-t',true,msg);if(r.err)return;f.t=r.v;
    if(type==='friet')f.ververst=$('#h-ververst [data-yn="1"]').getAttribute('aria-pressed')==='true';
  }
  var day=old?old.day:S.day,time=$('#h-time').value||hm(new Date()),at=atOf(day,time);
  if(type==='koel'&&f.at2&&Date.parse(f.at2)<Date.parse(at)){msg.textContent='De start ligt na het einde. Controleer het tijdstip van de start.';$('#h-time').focus();return}
  var e={type:type,day:day,at:at,by:old?old.by:nm,f:f,note:$('#h-note').value.trim()},n=norms(),o=judge(e,n);
  e.ok=o;e.nm=normText(type,n);
  if(old&&old.by!==nm)e.edit=nm;
  if(o===false&&!e.note&&!sheet.hasAttribute('data-warned')){
    sheet.setAttribute('data-warned','');
    msg.textContent='Dit valt buiten de norm ('+e.nm+'). Noteer wat je hebt gedaan en sla opnieuw op, of sla op zonder actie.';$('#h-note').focus();return;
  }
  var b=$('#h-save');b.disabled=true;b.textContent='Opslaan…';
  saveEntry(old?old.doc:KEY+'_'+day.slice(0,7),eid||uid('e'),e).then(function(){
    closeModal();toast(o===false?'Opgeslagen als afwijking.':o===null?'Start opgeslagen. Rond af als het product koud is.':'Opgeslagen.');
  },function(){b.disabled=false;b.textContent='Opslaan';msg.textContent='Opslaan lukt niet. Controleer je internetverbinding.'});
}
function askDelete(){
  $('#h-btns').outerHTML='<div class="note bad" id="h-btns"><p style="margin-bottom:10px"><b>Deze registratie verwijderen?</b> Ze verdwijnt uit het overzicht.</p><div class="rowflex"><button class="btn" data-close>Nee, laat staan</button><button class="btn danger" id="h-del2">Ja, verwijderen</button></div></div>';
}
function doDelete(){
  var e=find($('#modal .sheet').getAttribute('data-eid')),b=$('#h-del2');if(!e)return;b.disabled=true;
  saveEntry(e.doc,e.id,{gone:true,goneBy:(ls('naam')||'').trim(),goneAt:new Date().toISOString()}).then(function(){closeModal();toast('Registratie verwijderd.')},function(){b.disabled=false;toast('Verwijderen lukt niet. Controleer je internetverbinding.')});
}

/* --- overzicht per maand --- */
function monthEntries(mo){return entries().filter(function(e){return e.day.slice(0,7)===mo})}
function weeksOf(mo){
  var td=today(),last=mo===td.slice(0,7)?+td.slice(8):daysIn(mo),ws=[];
  for(var i=1;i<=last;i++){var w=isoWeek(mo+'-'+p2(i));if(ws.indexOf(w)<0)ws.push(w)}
  return ws;
}
function renderMonth(){
  var mo=S.month,td=today(),cur=mo===td.slice(0,7),es=monthEntries(mo),all=entries(),ws=weeksOf(mo),nowW=isoWeek(td);
  var bad=es.filter(function(e){return outcome(e)===false}),open=es.filter(function(e){return outcome(e)===null});
  var h='<section class="stack"><div class="daybar"><button class="iconbtn" id="mprev" aria-label="Vorige maand">‹</button>'
    +'<div class="dy"><b>'+esc(cap(monthLabel(mo)))+'</b><span class="muted">'+esc(P.loc+' · '+P.area)+'</span></div>'
    +'<button class="iconbtn" id="mnext" aria-label="Volgende maand"'+(cur?' disabled':'')+'>›</button></div>';
  h+='<div class="stats"><div class="stat"><span class="v num">'+es.length+'</span><span class="l">registraties</span></div>'
    +'<div class="stat"><span class="v num"'+(bad.length?' style="color:var(--bad)"':'')+'>'+bad.length+'</span><span class="l">afwijkingen</span></div>'
    +'<div class="stat"><span class="v num"'+(open.length?' style="color:var(--warn)"':'')+'>'+open.length+'</span><span class="l">terugkoelen loopt nog</span></div></div>';
  var types=ORDER.filter(function(t){return tcfg(t).on||es.some(function(e){return e.type===t})});
  /* weken van vóór de eerste registratie tellen niet als gemist */
  var firstW=all.length?isoWeek(all[all.length-1].day):'9';
  h+='<div class="stack"><div class="spread"><h3>Per week</h3><span class="muted" style="font-size:13px">aantal registraties van het weekdoel · rood = doel niet gehaald</span></div>'
    +'<div class="gridwrap" id="gridwrap" tabindex="0" role="region" aria-label="Registraties per week"><table class="mgrid hgrid"><thead><tr><th class="dev">Soort</th>'+ws.map(function(w){return '<th'+(w===nowW?' class="today"':'')+'><span>wk '+(+w.slice(6))+'</span></th>'}).join('')+'</tr></thead><tbody>';
  types.forEach(function(t){
    var c=tcfg(t);
    h+='<tr><th class="dev" scope="row">'+esc(TYPES[t].short)+'<div class="muted" style="font-weight:500;font-size:11.5px">'+(c.target>0?'doel '+c.target+' per week':'geen weekdoel')+'</div></th>';
    ws.forEach(function(w){
      var cnt=all.filter(function(e){return e.type===t&&isoWeek(e.day)===w}).length;
      var cls=c.target>0&&w>=firstW?(cnt>=c.target?'ok':w<nowW?'bad':''):'';
      h+='<td class="'+cls+'">'+(w<firstW&&!cnt?'':cnt+(c.target>0?'/'+c.target:''))+'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table></div></div>';
  h+='<div class="card stack"><h3>Afwijkingen</h3>';
  if(!bad.length)h+='<p class="muted">Geen afwijkingen in '+esc(monthLabel(mo))+'.</p>';
  else h+='<ul class="devlist">'+bad.map(function(e){
    return '<li><div class="spread"><b>'+esc(TYPES[e.type].short)+(e.f.x?' · '+esc(e.f.x):'')+'</b><span class="num" style="color:var(--bad);font-weight:700">'+esc(cap(whyBad(e)))+'</span></div>'
      +'<div class="muted" style="font-size:13px">'+esc(dayLabel(e.day))+' '+hm(new Date(e.at))+' · '+esc(valueText(e))+' · norm '+esc(e.nm||normText(e.type))+(e.by?' · '+esc(e.by):'')+'</div>'
      +'<div>'+(e.note?esc(e.note):'<span class="muted">Niet genoteerd wat er is gedaan.</span>')+'</div></li>';
  }).join('')+'</ul>';
  h+='</div>';
  h+='<div class="stack"><h3>Alle registraties</h3>'+(es.length?'<ul class="rows">'+es.map(function(e){return entryRow(e,true)}).join('')+'</ul>':'<div class="card"><p class="muted">Geen registraties in '+esc(monthLabel(mo))+'.</p></div>')+'</div>';
  h+='<div class="rowflex"><button class="btn" id="csv"'+(es.length?'':' disabled')+'>Download '+esc(monthLabel(mo))+' (CSV)</button><span class="muted" style="font-size:13px">Alle registraties van deze maand, te openen in Excel.</span></div></section>';
  $('#view').innerHTML=h;
  var gw=$('#gridwrap');if(gw)gw.scrollLeft=gw.scrollWidth;
}
function buildCsv(mo){
  var L=[['Datum','Tijdstip','Locatie','Plek','Soort','Leverancier of product','Soort producten','Temperatuur (°C)','Starttemperatuur (°C)','Eindtijdstip','Duur (min)','Verpakking en houdbaarheid','Vet ververst','Norm','Uitkomst','Opmerking of actie','Door']];
  function q(v){v=String(v==null?'':v);return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
  monthEntries(mo).slice().reverse().forEach(function(e){
    var f=e.f,o=outcome(e),d=new Date(e.at),d2=f.at2?new Date(f.at2):null;
    L.push([e.day,hm(d),P.loc,P.area,TYPES[e.type].label,f.x||'',e.type==='levering'?SOORT[f.soort]:'',
      e.type==='koel'?(typeof f.t2==='number'?nl(f.t2):''):(typeof f.t==='number'?nl(f.t):''),typeof f.t1==='number'?nl(f.t1):'',
      d2?ymd(d2)+' '+hm(d2):'',d2?Math.round((d2-d)/6e4):'',e.type==='levering'?(f.pak===false?'niet in orde':'in orde'):'',e.type==='friet'?(f.ververst?'ja':'nee'):'',
      e.nm||normText(e.type),o===null?'loopt nog':o?'in orde':'afwijking',e.note,e.by]);
  });
  return '﻿'+L.map(function(r){return r.map(q).join(';')}).join('\r\n');
}

/* --- instellingen --- */
function renderSettings(){
  var n=norms();
  var h='<section class="stack"><div><h2>Instellingen</h2><span class="muted">'+esc(P.loc+' · '+P.area)+'</span></div>'
    +'<div class="note warn">De normen hieronder zijn gangbare waarden uit de horeca. Leg ze naast jullie eigen HACCP-plan of de Hygiënecode voor de Horeca en pas ze aan waar dat afwijkt.</div>';
  ORDER.forEach(function(t){
    var c=tcfg(t);
    h+='<div class="card stack" data-set="'+t+'"><div class="spread"><h3>'+esc(TYPES[t].label)+'</h3><label class="dchk"><input type="checkbox" class="s-on"'+(c.on?' checked':'')+'><span>Gebruiken</span></label></div><div class="grid2">'
      +'<div class="field"><label>Minimaal per week</label><input class="input s-target" inputmode="numeric" value="'+c.target+'"><small>0 = geen weekdoel.</small></div>'
      +NORMF[t].map(function(x){return '<div class="field"><label>'+x[1]+'</label><input class="input s-norm" data-k="'+x[0]+'" inputmode="decimal" value="'+esc(nl(n[x[0]]))+'"></div>'}).join('')
      +'</div></div>';
  });
  h+='<p class="gate-msg" id="s-msg" role="alert" style="min-height:0"></p><div class="rowflex"><button class="btn primary" id="s-save">Instellingen opslaan</button><span class="muted" style="font-size:13px">Een nieuwe norm geldt voor nieuwe registraties; oude blijven zoals ze zijn beoordeeld.</span></div></section>';
  $('#view').innerHTML=h;
}
function doSaveSettings(){
  var msg=$('#s-msg'),types={},nn={},bad=null;msg.textContent='';
  $all('[data-set]').forEach(function(card){
    var t=card.getAttribute('data-set'),tg=parseNum($('.s-target',card).value);
    if(tg===null||tg<0||tg>99||tg!==Math.round(tg)){bad=bad||$('.s-target',card);return}
    types[t]={on:$('.s-on',card).checked,target:tg};
    $all('.s-norm',card).forEach(function(inp){var v=parseNum(inp.value);if(v===null||(inp.getAttribute('data-k')==='koel_uren'&&v<=0)){bad=bad||inp;return}nn[inp.getAttribute('data-k')]=v});
  });
  if(bad){msg.textContent='Vul overal een geldig getal in.';bad.focus();return}
  var b=$('#s-save');b.disabled=true;b.textContent='Opslaan…';
  write('haccp/'+KEY,{page:KEY,types:types,norms:nn}).then(function(){toast('Instellingen opgeslagen.');render()},function(){b.disabled=false;b.textContent='Instellingen opslaan';msg.textContent='Opslaan lukt niet. Controleer je internetverbinding.'});
}

/* ---------- bediening ---------- */
function setView(v){if(['vandaag','overzicht','instellingen'].indexOf(v)<0)v='vandaag';S.view=v;if(v==='overzicht'&&!S.month)S.month=today().slice(0,7);render();window.scrollTo(0,0)}
function setDay(day){var t=today();if(day>t)day=t;S.day=day;S.follow=day===t;render()}
document.addEventListener('click',function(ev){
  var el=ev.target.closest('a[href^="#"]');
  if(el){ev.preventDefault();var v=el.getAttribute('href').slice(1);try{history.replaceState(null,'',location.pathname+location.search+'#'+v)}catch(e){}setView(v);return}
  el=ev.target.closest('button');if(!el)return;
  if(el.hasAttribute('data-close')){closeModal();return}
  if(el.id==='prev'){setDay(addDays(S.day,-1));return}
  if(el.id==='next'){setDay(addDays(S.day,1));return}
  if(el.id==='totoday'){setDay(today());return}
  if(el.id==='mprev'){S.month=addMonths(S.month,-1);render();return}
  if(el.id==='mnext'){S.month=addMonths(S.month,1);render();return}
  if(el.hasAttribute('data-new')){
    if(!(ls('naam')||'').trim()){toast('Vul eerst je naam in.');var nf=$('#naam');if(nf){nf.focus();nf.scrollIntoView({block:'center'})}return}
    openEntry(el.getAttribute('data-new'),null);return;
  }
  if(el.hasAttribute('data-eid')){openEntry(null,el.getAttribute('data-eid'));return}
  if(el.id==='h-save'){doSave();return}
  if(el.id==='h-del'){askDelete();return}
  if(el.id==='h-del2'){doDelete();return}
  if(el.id==='s-save'){doSaveSettings();return}
  if(el.id==='csv'){
    var data=buildCsv(S.month),name='haccp-'+KEY+'-'+S.month+'.csv';
    (S.dl?S.dl.save({filename:name,data:data}):Promise.reject()).then(null,function(){toast('Downloaden lukt niet op dit apparaat.')});return;
  }
  if(el.classList.contains('sign')){var neg=el.getAttribute('data-neg')!=='1';el.setAttribute('data-neg',neg?'1':'0');el.textContent=neg?'−':'+';return}
  if(el.hasAttribute('data-yn')){$all('button',el.parentNode).forEach(function(b){b.setAttribute('aria-pressed',b===el?'true':'false')})}
});
document.addEventListener('change',function(ev){
  var el=ev.target;
  if(el.id==='naam'){var v=el.value.trim();el.value=v;ls('naam',v);if(v)$('#toast').hidden=true;return}
  if(el.id==='h-soort')syncForm();
});
document.addEventListener('keydown',function(ev){
  if(ev.key==='Escape'&&modalOpen()){closeModal();return}
  if(ev.key!=='Enter')return;
  var el=ev.target;
  if(el.id==='naam'){ev.preventDefault();el.blur()}
  else if(modalOpen()&&el.tagName==='INPUT'){ev.preventDefault();doSave()}
});
$('#modal').addEventListener('click',function(ev){if(ev.target===this)closeModal()});
window.addEventListener('hashchange',function(){var v=location.hash.slice(1);if(v&&v!==S.view)setView(v)});
/* lopende terugkoelingen tellen door; een scherm dat openstaat springt naar de nieuwe dag */
setInterval(function(){
  if(S.follow&&S.day!==today())S.day=today();
  if(S.view==='vandaag'&&!modalOpen()&&!/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||''))render();
},60000);

/* ---------- start ---------- */
function fail(t,p){$('#view').innerHTML='<div class="empty"><h3>'+esc(t)+'</h3><p>'+esc(p)+'</p></div>'}
if(!P){
  var hh='<div class="card stack"><h2>Kies een keuken</h2><ul class="rows">';
  PLEKKEN.filter(function(p){return p.haccp}).forEach(function(p){hh+='<li class="prow"><a class="pmain" style="text-decoration:none;color:inherit;display:block" href="?p='+p.key+'"><b>'+esc(p.loc+' '+p.area.toLowerCase())+'</b></a></li>'});
  $('#view').innerHTML=hh+'</ul></div>';$('.tabs').hidden=true;$('#where').hidden=true;return;
}
document.body.setAttribute('data-page',KEY);document.body.setAttribute('data-loc',P.loc.toLowerCase());
document.title=document.title.replace('HACCP','HACCP '+P.loc+' '+P.area.toLowerCase());
$('#where').textContent=P.loc+' · '+P.area;
S.day=today();S.month=S.day.slice(0,7);
var hv=location.hash.slice(1);if(hv==='overzicht'||hv==='instellingen')S.view=hv;
if(!window.claude||!window.claude.use){fail('De website is niet goed geladen','Laad de pagina opnieuw. Blijft dit terugkomen, meld het bij de eigenaar.');return}
render();
Promise.all([window.claude.use('db'),window.claude.use('downloads')]).then(function(r){
  S.db=r[0];S.dl=r[1];
  if(!S.db){fail('De website is niet goed geladen','Laad de pagina opnieuw. Blijft dit terugkomen, meld het bij de eigenaar.');return}
  S.db.doc('haccp/'+KEY).onSnapshot(function(s){S.cfg=s.exists?s.data():null;S.cfgLoaded=true;if(!modalOpen()||S.view!=='instellingen')render()});
  S.db.collection('haccplog').limit(1000).onSnapshot(function(qs){
    var o={};qs.docs.forEach(function(d){if(d.id.indexOf(KEY+'_')===0)o[d.id]=d.data()});
    S.logs=o;S.logsLoaded=true;
    if(S.view==='instellingen'&&$('[data-set]'))return;   /* niet opnieuw tekenen terwijl iemand normen invult */
    render();
  });
});
})();
