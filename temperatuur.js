/* Temperatuurregistratie per keuken of bar. Eén pagina per plek; welke plek staat in <body data-page="...">.
   Gegevens (zie backend.js):
     temp/<plek>                apparaten: {devices:{<id>:{name,type,max,ord,since,gone}}}
     templog/<plek>_<JJJJ-MM>   metingen:  {days:{<DD>:{m:{<id>:{t,mx,at,by,note}}}}}
   Een verwijderd apparaat krijgt een einddatum (gone); eerdere metingen blijven zo zichtbaar in het overzicht. */
(function(){
'use strict';

var PAGES={
  'floats-keuken':{loc:'FLOATS',area:'Keuken',seed:[
    ['Vriezer voorraad 1','vries'],['Vriezer voorraad 2','vries'],['Vriezer voorraad 3','vries'],['Vriezer voorraad 4','vries'],
    ['Koelkast voorraad 1','koel'],['Koelkast voorraad 2','koel'],['Koelkast voorraad 3','koel'],['Koelkast voorraad 4','koel'],
    ['Koelwerkbank warme kant','koel'],['Koelwerkbank koude kant','koel'],['Ladevriezer keuken','vries'],['Ladekoelkast keuken','koel']]},
  'floats-bar':{loc:'FLOATS',area:'Bar',seed:[
    ['Ladekoelkast','koel'],['Fustenkoelkast','koel'],['Wijnkoelkast wit','wijn'],['Wijnkoelkast rood','wijn',18]]},
  'altstadt-keuken':{loc:'ALTSTADT',area:'Keuken',seed:[
    ['Dubbele koelkast','koel'],['Koelkast 1','koel'],['Koelkast 2','koel'],['Vriezer 1','vries'],['Vriezer 2','vries'],['Vriezer 3','vries']]},
  'altstadt-bar':{loc:'ALTSTADT',area:'Bar',seed:[
    ['Frisdrank koelkast','koel'],['Wijnkoelkast','wijn']]}
};
var TYPES={koel:{label:'Koeling',max:7},vries:{label:'Vriezer',max:-18},wijn:{label:'Wijnkoeling',max:12},anders:{label:'Anders',max:7}};
var DAGEN=['zo','ma','di','wo','do','vr','za'],MND=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'],
    MAAND=['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];

var KEY=document.body.getAttribute('data-page'),P=PAGES[KEY];
var S={db:null,dl:null,view:'vandaag',day:null,follow:true,month:null,cfg:null,cfgLoaded:false,logs:{},logsLoaded:false,sig:'',seeding:false};
var chain={},toastT;

/* ---------- hulpjes ---------- */
function $(s,r){return (r||document).querySelector(s)}
function $all(s,r){return [].slice.call((r||document).querySelectorAll(s))}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function ls(k,v){try{if(v===undefined)return localStorage.getItem('dv.'+k);localStorage.setItem('dv.'+k,v)}catch(e){return null}}
function toast(msg){var t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true},4200)}
function openModal(html){var m=$('#modal');m.innerHTML='<div class="sheet" role="dialog" aria-modal="true" tabindex="-1">'+html+'</div>';m.hidden=false;var f=$('.sheet',m);if(f)f.focus()}
function closeModal(){var m=$('#modal');m.hidden=true;m.innerHTML=''}
function p2(n){return (n<10?'0':'')+n}
function ymd(d){return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())}
function today(){return ymd(new Date())}
function toDate(s){var a=s.split('-');return new Date(+a[0],+a[1]-1,+a[2]||1,12)}
function addDays(s,n){var d=toDate(s);d.setDate(d.getDate()+n);return ymd(d)}
function addMonths(m,n){var d=toDate(m+'-01');d.setMonth(d.getMonth()+n);return ymd(d).slice(0,7)}
function daysIn(m){var a=m.split('-');return new Date(+a[0],+a[1],0).getDate()}
function dayLabel(s){var d=toDate(s);return DAGEN[d.getDay()]+' '+d.getDate()+' '+MND[d.getMonth()]}
function monthLabel(m){var a=m.split('-');return MAAND[+a[1]-1]+' '+a[0]}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}
function fmtT(t){var a=Math.round(Math.abs(t)*10)/10;return (t<0&&a!==0?'−':'')+String(a).replace('.',',')}
function parseNum(v){
  v=String(v==null?'':v).trim().replace(/−/g,'-').replace(',','.').replace(/\s|°|c$/gi,'');
  if(!/^[+-]?\d{1,3}(\.\d{1,2})?$/.test(v))return null;
  var n=parseFloat(v);return isFinite(n)&&Math.abs(n)<=99?n:null;
}
function normText(mx){return 'max '+fmtT(mx)+' °C'}
function typeLabel(d){return (TYPES[d.type]||TYPES.anders).label}

/* ---------- gegevens ---------- */
function devices(all){
  var o=(S.cfg&&S.cfg.devices)||{};
  return Object.keys(o).map(function(id){var d=o[id]||{};return {id:id,name:d.name||'Apparaat',type:TYPES[d.type]?d.type:'anders',max:typeof d.max==='number'?d.max:7,ord:typeof d.ord==='number'?d.ord:999,since:d.since||null,gone:d.gone||null}})
    .filter(function(d){return all||!d.gone})
    .sort(function(a,b){return a.ord-b.ord||a.name.localeCompare(b.name,'nl')});
}
function expected(d,day){return (!d.since||d.since<=day)&&(!d.gone||day<d.gone)}
function meas(day){var l=S.logs[KEY+'_'+day.slice(0,7)],dd=l&&l.days&&l.days[day.slice(8)];return (dd&&dd.m)||{}}
function hasT(m){return !!m&&typeof m.t==='number'}
function isBad(d,m){return hasT(m)&&m.t>(typeof m.mx==='number'?m.mx:d.max)}
function dayDevices(day){var m=meas(day);return devices(true).filter(function(d){return expected(d,day)||hasT(m[d.id])})}

/* schrijven: per document na elkaar, zodat het aanmaken van een nieuw maanddocument en de eerste metingen elkaar niet kruisen */
function write(path,patch){
  function go(){
    return S.db.doc(path).get().then(function(s){return s.exists?S.db.doc(path).update(patch):S.db.doc(path).set(patch)});
  }
  function attempt(){return go().then(null,function(e){
    if(e&&e.code==='unavailable')return new Promise(function(res){setTimeout(res,1500)}).then(go);
    throw e;
  })}
  var p=(chain[path]||Promise.resolve()).then(attempt,attempt);
  chain[path]=p.then(null,function(){});
  return p;
}
function saveMeas(day,id,fields){
  var mo=day.slice(0,7),m={},d={};m[id]=fields;d[day.slice(8)]={m:m};
  return write('templog/'+KEY+'_'+mo,{page:KEY,month:mo,days:d}).then(null,function(){
    toast('Opslaan lukt niet. Controleer je internetverbinding en vul de meting opnieuw in.');
  });
}
function saveDevice(id,fields){
  var o={};o[id]=fields;
  return write('temp/'+KEY,{page:KEY,devices:o});
}
function seed(){
  if(S.seeding)return;S.seeding=true;
  var o={},t=today();
  P.seed.forEach(function(x,i){o['d'+(i+1)]={name:x[0],type:x[1],max:typeof x[2]==='number'?x[2]:TYPES[x[1]].max,ord:i+1,since:t}});
  S.db.doc('temp/'+KEY).set({page:KEY,devices:o}).then(null,function(){S.seeding=false});
}

/* ---------- weergave ---------- */
function footer(){
  var h='<nav class="foot" aria-label="Andere pagina\'s"><span>Andere pagina\'s:</span>';
  Object.keys(PAGES).forEach(function(k){if(k!==KEY)h+='<a href="../'+k+'/">'+PAGES[k].loc+' '+PAGES[k].area.toLowerCase()+'</a>'});
  return h+'<a href="../">Drankvoorraad</a></nav>';
}
function render(){
  $all('.tabs a').forEach(function(a){if(a.getAttribute('href')==='#'+S.view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  var v=$('#view');
  if(!S.cfgLoaded||!S.logsLoaded){v.innerHTML='<div class="empty"><h3>Temperaturen laden…</h3><p>De apparaten en metingen worden opgehaald.</p></div>';S.sig='';return}
  if(S.view==='vandaag'){
    var sg='v|'+S.day+'|'+JSON.stringify(dayDevices(S.day).map(function(d){return [d.id,d.name,d.type,d.max]}));
    if(sg===S.sig&&$('#rows')){patchDay();return}
    S.sig=sg;renderDay();
  }else{
    S.sig='';
    if(S.view==='overzicht')renderMonth();else renderDevices();
  }
}

/* --- vandaag --- */
function renderDay(){
  var day=S.day,isToday=day===today(),devs=dayDevices(day);
  var h='<section class="stack">'
    +'<div class="daybar"><button class="iconbtn" id="prev" aria-label="Vorige dag">‹</button>'
    +'<div class="dy"><b>'+(isToday?'Vandaag · ':'')+esc(dayLabel(day))+'</b><span class="muted" id="prog"></span><div class="bar"><i id="progbar" style="width:0"></i></div></div>'
    +'<button class="iconbtn" id="next" aria-label="Volgende dag"'+(isToday?' disabled':'')+'>›</button></div>';
  if(!isToday)h+='<div class="note warn spread"><span>Je bekijkt een eerdere dag. Wat je hier invult, telt voor '+esc(dayLabel(day))+'.</span><button class="btn" id="totoday">Naar vandaag</button></div>';
  if(!devs.length){
    h+='<div class="card empty"><h3>Geen apparaten op deze dag</h3><p>'+(devices().length?'Op deze dag stonden er nog geen apparaten in de lijst.':'Voeg eerst apparaten toe bij Apparaten.')+'</p></div>';
  }else{
    h+='<div class="card"><div class="field"><label for="naam">Gemeten door</label><input class="input" id="naam" autocomplete="name" placeholder="Je naam" value="'+esc(ls('naam')||'')+'"><small>Je naam wordt bij elke meting bewaard en op dit apparaat onthouden.</small></div></div>';
    h+='<ul class="rows" id="rows">';
    devs.forEach(function(d){
      h+='<li class="trow" data-id="'+esc(d.id)+'"><div><div class="tname">'+esc(d.name)+'</div><div class="tsub">'+esc(typeLabel(d))+' · '+esc(normText(d.max))+'</div></div>'
        +'<div class="tin"><button type="button" class="sign"></button>'
        +'<input class="tval" inputmode="decimal" autocomplete="off" enterkeyhint="next" aria-label="Temperatuur '+esc(d.name)+' in graden Celsius"><span class="unit" aria-hidden="true">°C</span></div>'
        +'<div class="tstate"></div></li>';
    });
    h+='</ul><div id="daynote"></div>';
  }
  h+='</section>'+footer();
  $('#view').innerHTML=h;
  patchDay();
}
function setSign(li,neg){
  var b=$('.sign',li);b.setAttribute('data-neg',neg?'1':'0');b.textContent=neg?'−':'+';
  b.setAttribute('aria-label',neg?'Onder nul. Tik voor boven nul.':'Boven nul. Tik voor onder nul.');
}
function whoText(m,day){
  if(!m.at)return m.by||'';
  var d=new Date(m.at),t=p2(d.getHours())+':'+p2(d.getMinutes());
  return (m.by?m.by+', ':'')+(ymd(d)===day?t:d.getDate()+' '+MND[d.getMonth()]+' '+t);
}
function paintRow(li,d,m,force){
  var inp=$('.tval',li),st=$('.tstate',li),has=hasT(m),bad=isBad(d,m),kind=has?(bad?'bad':'ok'):'none';
  li.classList.toggle('bad',bad);
  if(force||(document.activeElement!==inp&&!li.classList.contains('pending'))){
    inp.value=has?String(Math.round(Math.abs(m.t)*10)/10).replace('.',','):'';
    setSign(li,has?m.t<0:d.type==='vries');
  }
  if(li.getAttribute('data-kind')!==kind){
    li.setAttribute('data-kind',kind);
    if(kind==='ok')st.innerHTML='<span class="ok">✓ Binnen de norm <span class="who"></span></span>';
    else if(kind==='bad')st.innerHTML='<span class="bad">Te warm: de norm is '+esc(normText(typeof m.mx==='number'?m.mx:d.max))+'. Noteer wat je hebt gedaan. <span class="who"></span></span>'
      +'<input class="input tnote" autocomplete="off" aria-label="Actie bij '+esc(d.name)+'" placeholder="bv. deur stond open, later opnieuw gemeten">';
    else st.innerHTML='';
  }
  var w=$('.who',st);if(w)w.textContent=has&&whoText(m,S.day)?'· '+whoText(m,S.day):'';
  var n=$('.tnote',st);if(n&&document.activeElement!==n)n.value=m.note||'';
}
function patchDay(){
  var m=meas(S.day),devs=dayDevices(S.day),byId={},done=0,bad=0,exp=0;
  devs.forEach(function(d){byId[d.id]=d;if(expected(d,S.day)){exp++;if(hasT(m[d.id]))done++}if(isBad(d,m[d.id]))bad++});
  $all('#rows .trow').forEach(function(li){var d=byId[li.getAttribute('data-id')];if(d)paintRow(li,d,m[d.id]||{})});
  var pr=$('#prog');if(pr)pr.textContent=exp?done+' van '+exp+' gemeten':'';
  var pb=$('#progbar');if(pb)pb.style.width=(exp?Math.round(done/exp*100):0)+'%';
  var dn=$('#daynote');
  if(dn){
    if(bad)dn.innerHTML='<div class="note bad">'+bad+' '+(bad>1?'apparaten zijn':'apparaat is')+' te warm. Meld het bij je leidinggevende en noteer bij het apparaat wat je hebt gedaan.</div>';
    else if(exp&&done===exp)dn.innerHTML='<div class="note good">Alles gemeten en binnen de norm. Klaar voor '+(S.day===today()?'vandaag':esc(dayLabel(S.day)))+'.</div>';
    else dn.innerHTML='';
  }
}
function readRow(li){
  var raw=$('.tval',li).value.trim();
  if(raw==='')return {empty:true};
  var n=parseNum(raw);
  if(n===null)return {invalid:true};
  if(/^[-−]/.test(raw))setSign(li,true);else if(/^\+/.test(raw))setSign(li,false);
  var neg=$('.sign',li).getAttribute('data-neg')==='1';
  return {t:neg?-Math.abs(n):Math.abs(n)};
}
function commitRow(li){
  var id=li.getAttribute('data-id'),d=devices(true).filter(function(x){return x.id===id})[0];if(!d)return;
  var cur=meas(S.day)[id]||{},r=readRow(li);
  if(r.invalid){toast('Vul een getal in, bijvoorbeeld 4 of 4,5.');li.classList.remove('pending');paintRow(li,d,cur,true);return}
  if(r.empty){li.classList.remove('pending');if(hasT(cur))saveMeas(S.day,id,{t:null,at:new Date().toISOString(),by:(ls('naam')||'').trim()});return}
  var nm=(($('#naam')||{}).value||'').trim();
  if(!nm){li.classList.add('pending');toast('Vul eerst je naam in bij "Gemeten door".');var f=$('#naam');if(f)f.focus();return}
  li.classList.remove('pending');
  if(hasT(cur)&&cur.t===r.t)return;
  saveMeas(S.day,id,{t:r.t,mx:d.max,at:new Date().toISOString(),by:nm});
}

/* --- overzicht per maand --- */
function monthData(mo){
  var n=daysIn(mo),td=today(),last=mo===td.slice(0,7)?+td.slice(8):n,devs=[],rows=[],dev=[],stats={full:0,days:0,bad:0,miss:0};
  var all=devices(true),days=[];
  for(var i=1;i<=n;i++)days.push(mo+'-'+p2(i));
  all.forEach(function(d){
    var cells=[],use=false;
    days.forEach(function(day,ix){
      var m=meas(day)[d.id],ex=expected(d,day)&&ix<last,c={day:day,m:m,ex:ex,has:hasT(m),bad:isBad(d,m)};
      if(c.has||ex)use=true;cells.push(c);
    });
    if(use){devs.push(d);rows.push(cells)}
  });
  days.forEach(function(day,ix){
    if(ix>=last)return;
    var ex=0,ok=0;
    rows.forEach(function(cells,r){var c=cells[ix];if(c.ex){ex++;if(c.has)ok++;else if(day!==td)stats.miss++}if(c.bad){stats.bad++;dev.push({day:day,d:devs[r],m:c.m})}});
    if(ex){stats.days++;if(ok===ex)stats.full++}
  });
  return {days:days,last:last,devs:devs,rows:rows,dev:dev,stats:stats};
}
function renderMonth(){
  var mo=S.month,td=today(),D=monthData(mo),cur=mo===td.slice(0,7);
  var h='<section class="stack"><div class="daybar"><button class="iconbtn" id="mprev" aria-label="Vorige maand">‹</button>'
    +'<div class="dy"><b>'+esc(cap(monthLabel(mo)))+'</b><span class="muted">'+esc(P.loc+' · '+P.area)+'</span></div>'
    +'<button class="iconbtn" id="mnext" aria-label="Volgende maand"'+(cur?' disabled':'')+'>›</button></div>';
  if(!D.devs.length){
    h+='<div class="card empty"><h3>Geen metingen in '+esc(monthLabel(mo))+'</h3><p>Zodra er temperaturen zijn ingevuld, zie je ze hier per dag terug.</p></div></section>'+footer();
    $('#view').innerHTML=h;return;
  }
  h+='<div class="stats"><div class="stat"><span class="v num">'+D.stats.full+' <span class="muted" style="font-size:15px;font-weight:600">van '+D.stats.days+'</span></span><span class="l">dagen volledig gemeten</span></div>'
    +'<div class="stat"><span class="v num"'+(D.stats.bad?' style="color:var(--bad)"':'')+'>'+D.stats.bad+'</span><span class="l">metingen te warm</span></div>'
    +'<div class="stat"><span class="v num"'+(D.stats.miss?' style="color:var(--warn)"':'')+'>'+D.stats.miss+'</span><span class="l">metingen gemist</span></div></div>';
  h+='<div class="stack"><div class="spread"><h3>Per dag</h3><span class="muted" style="font-size:13px">rood = te warm · ! = gemist · tik op een dag om hem te openen</span></div>'
    +'<div class="gridwrap" id="gridwrap" tabindex="0" role="region" aria-label="Temperaturen per dag"><table class="mgrid"><thead><tr><th class="dev">Apparaat</th>';
  D.days.forEach(function(day,ix){
    var wd=toDate(day).getDay(),wk=wd===0||wd===6;
    h+='<th class="'+(wk?'wk':'')+(day===td?' today':'')+'">'+(ix<D.last?'<button type="button" data-day="'+day+'" aria-label="Open '+esc(dayLabel(day))+'">'+(ix+1)+'</button>':'<span class="muted" style="opacity:.5">'+(ix+1)+'</span>')+'</th>';
  });
  h+='</tr></thead><tbody>';
  D.devs.forEach(function(d,r){
    h+='<tr><th class="dev" scope="row">'+esc(d.name)+(d.gone?' <span class="muted" style="font-weight:500">(verwijderd)</span>':'')+'<div class="muted" style="font-weight:500;font-size:11.5px">'+esc(normText(d.max))+'</div></th>';
    D.rows[r].forEach(function(c){
      var wd=toDate(c.day).getDay(),cl=(wd===0||wd===6)?'wk':'';
      if(c.has)h+='<td class="'+cl+(c.bad?' bad':'')+'">'+fmtT(c.m.t)+'</td>';
      else if(c.ex&&c.day!==td)h+='<td class="'+cl+' miss" title="Niet gemeten">!</td>';
      else h+='<td class="'+cl+'"></td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table></div></div>';
  h+='<div class="card stack"><h3>Te warm gemeten</h3>';
  if(!D.dev.length)h+='<p class="muted">Geen afwijkingen in '+esc(monthLabel(mo))+'.</p>';
  else{
    h+='<ul class="devlist">';
    D.dev.forEach(function(x){
      h+='<li><div class="spread"><b>'+esc(x.d.name)+'</b><span class="num" style="color:var(--bad);font-weight:700;white-space:nowrap">'+fmtT(x.m.t)+' °C</span></div>'
        +'<div class="muted" style="font-size:13px">'+esc(dayLabel(x.day))+' · norm '+esc(normText(typeof x.m.mx==='number'?x.m.mx:x.d.max))+(x.m.by?' · gemeten door '+esc(x.m.by):'')+'</div>'
        +'<div>'+(x.m.note?esc(x.m.note):'<span class="muted">Niet genoteerd wat er is gedaan.</span>')+'</div></li>';
    });
    h+='</ul>';
  }
  h+='</div><div class="rowflex"><button class="btn" id="csv">Download '+esc(monthLabel(mo))+' (CSV)</button><span class="muted" style="font-size:13px">Alle metingen van deze maand, te openen in Excel.</span></div></section>'+footer();
  $('#view').innerHTML=h;
  var gw=$('#gridwrap'),tc=$('th.today',gw);
  if(gw&&tc)gw.scrollLeft=Math.max(0,tc.offsetLeft-gw.clientWidth+tc.offsetWidth+8);
}
function buildCsv(mo){
  var D=monthData(mo),L=[['Datum','Locatie','Plek','Apparaat','Soort','Norm max (°C)','Gemeten (°C)','Binnen norm','Gemeten door','Tijdstip','Wat is er gedaan']];
  function q(v){v=String(v==null?'':v);return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
  function nl(n){return String(n).replace('.',',')}
  D.days.forEach(function(day,ix){
    if(ix>=D.last)return;
    D.devs.forEach(function(d,r){
      var c=D.rows[r][ix];
      if(c.has){var at=c.m.at?new Date(c.m.at):null,mx=typeof c.m.mx==='number'?c.m.mx:d.max;
        L.push([day,P.loc,P.area,d.name,typeLabel(d),nl(mx),nl(c.m.t),c.bad?'nee':'ja',c.m.by||'',at?ymd(at)+' '+p2(at.getHours())+':'+p2(at.getMinutes()):'',c.m.note||''])}
      else if(c.ex&&day!==today())L.push([day,P.loc,P.area,d.name,typeLabel(d),nl(d.max),'','niet gemeten','','','']);
    });
  });
  return '﻿'+L.map(function(r){return r.map(q).join(';')}).join('\r\n');
}

/* --- apparaten --- */
function renderDevices(){
  var devs=devices();
  var h='<section class="stack"><div class="spread"><div><h2>Apparaten</h2><span class="muted">'+esc(P.loc+' · '+P.area)+' · '+devs.length+' '+(devs.length===1?'apparaat':'apparaten')+'</span></div><button class="btn primary" id="add">Apparaat toevoegen</button></div>';
  if(!devs.length)h+='<div class="card empty"><h3>Nog geen apparaten</h3><p>Voeg de koelingen en vriezers toe die elke dag gemeten moeten worden.</p></div>';
  else{
    h+='<ul class="rows">';
    devs.forEach(function(d,i){
      h+='<li class="prow"><button type="button" class="pmain" data-edit="'+esc(d.id)+'"><b>'+esc(d.name)+'</b><span class="muted" style="font-size:13px">'+esc(typeLabel(d))+' · '+esc(normText(d.max))+'</span></button>'
        +'<button type="button" class="mv" data-move="-1" data-id="'+esc(d.id)+'" aria-label="'+esc(d.name)+' omhoog"'+(i===0?' disabled':'')+'>▲</button>'
        +'<button type="button" class="mv" data-move="1" data-id="'+esc(d.id)+'" aria-label="'+esc(d.name)+' omlaag"'+(i===devs.length-1?' disabled':'')+'>▼</button></li>';
    });
    h+='</ul><p class="muted" style="font-size:13px">Tik op een apparaat om de naam of de norm aan te passen, of om het te verwijderen. Met de pijltjes zet je de lijst in de volgorde van je meetronde.</p>';
  }
  h+='</section>'+footer();
  $('#view').innerHTML=h;
}
function openDevice(id){
  var d=id?devices().filter(function(x){return x.id===id})[0]:null;
  if(id&&!d)return;
  var t=d?d.type:'koel',mx=d?d.max:TYPES.koel.max;
  var h='<h2>'+(d?'Apparaat aanpassen':'Apparaat toevoegen')+'</h2>'
    +'<div class="field"><label for="a-naam">Naam</label><input class="input" id="a-naam" autocomplete="off" maxlength="60" value="'+esc(d?d.name:'')+'" placeholder="bv. Koelkast voorraad 5"></div>'
    +'<div class="grid2"><div class="field"><label for="a-type">Soort</label><select class="input" id="a-type">'
    +Object.keys(TYPES).map(function(k){return '<option value="'+k+'"'+(k===t?' selected':'')+'>'+TYPES[k].label+'</option>'}).join('')+'</select></div>'
    +'<div class="field"><label for="a-max">Maximale temperatuur (°C)</label><input class="input" id="a-max" autocomplete="off" value="'+esc(String(mx).replace('.',','))+'"><small>Koeling 7 · vriezer -18. Warmer dan dit telt als afwijking.</small></div></div>'
    +'<p class="gate-msg" id="a-msg" role="alert" style="min-height:0"></p>'
    +'<div class="spread" id="a-btns">'+(d?'<button class="btn danger" id="a-del">Verwijderen</button>':'<span></span>')
    +'<span class="rowflex"><button class="btn ghost" data-close>Annuleren</button><button class="btn primary" id="a-save">Opslaan</button></span></div>';
  openModal(h);
  var sheet=$('#modal .sheet');sheet.setAttribute('data-id',id||'');sheet.setAttribute('data-type',t);
  if(!d)setTimeout(function(){var f=$('#a-naam');if(f)f.focus()},50);
}
function doSaveDevice(){
  var sheet=$('#modal .sheet'),id=sheet.getAttribute('data-id'),msg=$('#a-msg');
  var name=$('#a-naam').value.trim().replace(/\s+/g,' '),type=$('#a-type').value,mx=parseNum($('#a-max').value);
  if(!name){msg.textContent='Vul een naam in.';$('#a-naam').focus();return}
  if(mx===null){msg.textContent='Vul bij de maximale temperatuur een getal in, bijvoorbeeld 7 of -18.';$('#a-max').focus();return}
  var f={name:name,type:type,max:mx};
  if(!id){
    id='d'+Date.now().toString(36);
    f.ord=devices(true).reduce(function(a,d){return Math.max(a,d.ord<999?d.ord:0)},0)+1;f.since=today();
  }
  var b=$('#a-save');b.disabled=true;b.textContent='Opslaan…';
  saveDevice(id,f).then(function(){closeModal();toast('Apparaat opgeslagen.')},function(){b.disabled=false;b.textContent='Opslaan';msg.textContent='Opslaan lukt niet. Controleer je internetverbinding.'});
}
function askDelete(){
  var name=$('#a-naam').value.trim()||'dit apparaat';
  $('#a-btns').outerHTML='<div class="note bad" id="a-btns"><p style="margin-bottom:10px"><b>'+esc(name)+' verwijderen?</b> Het verdwijnt uit de dagelijkse lijst. Eerdere metingen blijven bewaard in het overzicht.</p>'
    +'<div class="rowflex"><button class="btn" data-close>Nee, laat staan</button><button class="btn danger" id="a-del2">Ja, verwijderen</button></div></div>';
}
function doDelete(){
  var id=$('#modal .sheet').getAttribute('data-id'),b=$('#a-del2');b.disabled=true;
  saveDevice(id,{gone:today()}).then(function(){closeModal();toast('Apparaat verwijderd.')},function(){b.disabled=false;toast('Verwijderen lukt niet. Controleer je internetverbinding.')});
}
function move(id,dir){
  var devs=devices(),i=devs.map(function(d){return d.id}).indexOf(id),j=i+dir;
  if(i<0||j<0||j>=devs.length)return;
  var t=devs[i];devs[i]=devs[j];devs[j]=t;
  var o={};devs.forEach(function(d,k){if(d.ord!==k+1)o[d.id]={ord:k+1}});
  write('temp/'+KEY,{page:KEY,devices:o}).then(null,function(){toast('Volgorde opslaan lukt niet.')});
}

/* ---------- bediening ---------- */
function setView(v){if(['vandaag','overzicht','apparaten'].indexOf(v)<0)v='vandaag';S.view=v;if(v==='overzicht'&&!S.month)S.month=today().slice(0,7);render();window.scrollTo(0,0)}
function setDay(day){var t=today();if(day>t)day=t;S.day=day;S.follow=day===t;render()}
document.addEventListener('click',function(ev){
  var el=ev.target.closest('a[href^="#"]');
  if(el){ev.preventDefault();var v=el.getAttribute('href').slice(1);try{history.replaceState(null,'','#'+v)}catch(e){}setView(v);return}
  el=ev.target.closest('button');if(!el)return;
  if(el.hasAttribute('data-close')){closeModal();return}
  if(el.id==='prev'){setDay(addDays(S.day,-1));return}
  if(el.id==='next'){setDay(addDays(S.day,1));return}
  if(el.id==='totoday'){setDay(today());return}
  if(el.id==='mprev'){S.month=addMonths(S.month,-1);render();return}
  if(el.id==='mnext'){S.month=addMonths(S.month,1);render();return}
  if(el.hasAttribute('data-day')){S.view='vandaag';try{history.replaceState(null,'','#vandaag')}catch(e){}setDay(el.getAttribute('data-day'));window.scrollTo(0,0);return}
  if(el.id==='csv'){
    var data=buildCsv(S.month),name='temperaturen-'+KEY+'-'+S.month+'.csv';
    (S.dl?S.dl.save({filename:name,data:data}):Promise.reject()).then(null,function(){toast('Downloaden lukt niet op dit apparaat.')});return;
  }
  if(el.id==='add'){openDevice(null);return}
  if(el.hasAttribute('data-edit')){openDevice(el.getAttribute('data-edit'));return}
  if(el.hasAttribute('data-move')){move(el.getAttribute('data-id'),+el.getAttribute('data-move'));return}
  if(el.id==='a-save'){doSaveDevice();return}
  if(el.id==='a-del'){askDelete();return}
  if(el.id==='a-del2'){doDelete();return}
  if(el.classList.contains('sign')){
    var li=el.closest('.trow');setSign(li,el.getAttribute('data-neg')!=='1');
    if($('.tval',li).value.trim()!=='')commitRow(li);
  }
});
document.addEventListener('change',function(ev){
  var el=ev.target;
  if(el.id==='naam'){
    var v=el.value.trim();el.value=v;ls('naam',v);
    if(v){$('#toast').hidden=true;$all('#rows .trow.pending').forEach(commitRow)}
    return;
  }
  if(el.classList.contains('tval')){commitRow(el.closest('.trow'));return}
  if(el.classList.contains('tnote')){
    var li=el.closest('.trow');saveMeas(S.day,li.getAttribute('data-id'),{note:el.value.trim().slice(0,300)});return;
  }
  if(el.id==='a-type'){
    var sheet=$('#modal .sheet'),old=sheet.getAttribute('data-type'),mx=$('#a-max'),cur=parseNum(mx.value);
    if(cur===null||cur===TYPES[old].max)mx.value=String(TYPES[el.value].max);
    sheet.setAttribute('data-type',el.value);
  }
});
/* eerst de naam, dan pas meten: zo hoeft niemand een ingevuld getal opnieuw te typen */
document.addEventListener('focusin',function(ev){
  var el=ev.target,f=$('#naam');
  if(el.classList&&el.classList.contains('tval')&&f&&!f.value.trim()){toast('Vul eerst je naam in bij "Gemeten door".');f.focus()}
});
document.addEventListener('keydown',function(ev){
  if(ev.key==='Escape'&&!$('#modal').hidden){closeModal();return}
  if(ev.key!=='Enter')return;
  var el=ev.target;
  if(el.classList&&el.classList.contains('tval')){
    ev.preventDefault();
    var rows=$all('#rows .tval'),i=rows.indexOf(el);
    if(rows[i+1])rows[i+1].focus();else el.blur();
  }else if(el.classList&&el.classList.contains('tnote')){ev.preventDefault();el.blur()}
  else if(el.id==='naam'){ev.preventDefault();el.blur();var first=$('#rows .tval');if(first&&el.value.trim())first.focus()}
  else if(el.id==='a-naam'||el.id==='a-max'){ev.preventDefault();doSaveDevice()}
});
$('#modal').addEventListener('click',function(ev){if(ev.target===this)closeModal()});
window.addEventListener('hashchange',function(){var v=location.hash.slice(1);if(v&&v!==S.view)setView(v)});
/* een scherm dat de hele nacht openstaat springt vanzelf naar de nieuwe dag */
setInterval(function(){if(S.follow&&S.day!==today()){S.day=today();render()}},30000);
document.addEventListener('visibilitychange',function(){if(!document.hidden&&S.follow&&S.day!==today()){S.day=today();render()}});

/* ---------- start ---------- */
function fail(t,p){$('#view').innerHTML='<div class="empty"><h3>'+esc(t)+'</h3><p>'+esc(p)+'</p></div>'}
if(!P){fail('Deze pagina bestaat niet','Controleer het adres.');return}
S.day=today();S.month=S.day.slice(0,7);
var hv=location.hash.slice(1);if(hv==='overzicht'||hv==='apparaten')S.view=hv;
if(!window.claude||!window.claude.use){fail('De website is niet goed geladen','Laad de pagina opnieuw. Blijft dit terugkomen, meld het bij de eigenaar.');return}
render();
Promise.all([window.claude.use('db'),window.claude.use('downloads')]).then(function(r){
  S.db=r[0];S.dl=r[1];
  if(!S.db){fail('De website is niet goed geladen','Laad de pagina opnieuw. Blijft dit terugkomen, meld het bij de eigenaar.');return}
  S.db.doc('temp/'+KEY).onSnapshot(function(s){
    S.cfg=s.exists?s.data():null;S.cfgLoaded=true;
    if(!s.exists)seed();
    render();
  });
  S.db.collection('templog').limit(1000).onSnapshot(function(qs){
    var o={};qs.docs.forEach(function(d){if(d.id.indexOf(KEY+'_')===0)o[d.id]=d.data()});
    S.logs=o;S.logsLoaded=true;render();
  });
});
})();
