/* Checklijsten per plek (openen, sluiten, schoonmaak, diensten). Eén pagina: checklijst/?p=<plek>.
   Gegevens (zie backend.js):
     check/<plek>                    lijsten: {lists:{<lid>:{name,desc,freq:'dag'|'week'|'maand',start,end,ord,since,gone,
                                       tasks:{<tid>:{type:'check'|'getal'|'tekst'|'kop',text,info,time,days:[1..7],req,ord,since,gone}}}}}
     checklog/<plek>_<JJJJ-MM>       dagelijkse lijsten:  {days:{<DD>:{<lid>:{t:{<tid>:{v,at,by}}}}}}
     checklog/<plek>_<JJJJ>-w        wekelijkse lijsten:  {weeks:{<Www>:{<lid>:{t:{...}}}}}
     checklog/<plek>_<JJJJ>-m        maandelijkse lijsten:{months:{<MM>:{<lid>:{t:{...}}}}}
   Een verwijderde lijst of taak krijgt een einddatum (gone); wat eerder is afgetekend blijft zichtbaar. */
(function(){
'use strict';

var PLEKKEN=window.DV_PLEKKEN||[];
var KEY=(/[?&]p=([a-z0-9-]+)/.exec(location.search)||[])[1]||'';
var P=PLEKKEN.filter(function(p){return p.key===KEY})[0];
var DAGEN=['zo','ma','di','wo','do','vr','za'],MND=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'],
    MAAND=['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'],
    WD=['ma','di','wo','do','vr','za','zo'];
var FREQ={dag:'Elke dag',week:'Elke week',maand:'Elke maand'};
var TYPE={check:'Afvinken',getal:'Getal invullen',tekst:'Tekst invullen',kop:'Tussenkop'};

/* Startlijsten voor keuken, bar en housekeeping. Algemene horecataken; pas ze aan onder Lijsten. */
function L(name,freq,start,end,tasks){return {name:name,freq:freq,start:start,end:end,tasks:tasks}}
var SEED={
  keuken:[
    L('Openen','dag',null,null,['Handen gewassen en schone werkkleding aan','Koelingen en vriezers gecontroleerd; temperaturen ingevuld','Werkbanken en snijplanken schoon en gedesinfecteerd','Leveringen gecontroleerd en direct opgeruimd (koel en vries eerst)','Houdbaarheid gecontroleerd; wat over datum is weggegooid','Mise-en-place aangevuld en gestickerd met datum','Afzuiging aan; oven, frituur en bain-marie aangezet','Frituurvet gecontroleerd','Handzeep, papier en schone doeken bij de wasbak','Afwasmachine gevuld en opgestart']),
    L('Sluiten','dag',null,null,['Producten afgedekt, gestickerd en in de koeling','Restanten die niet bewaard mogen worden weggegooid','Werkbanken, snijplanken en messen schoon','Fornuis, grill en bakplaat schoon','Frituur uit; vet gezeefd of ververst','Afwas weg; afwasmachine geleegd en schoongemaakt','Vloer geveegd en gedweild','Afval en glas weggebracht; bakken schoon met nieuwe zak','Koelingen en vriezers dicht; temperaturen gecontroleerd','Gas, apparatuur en afzuiging uit',['tekst','Bijzonderheden voor de volgende dienst']]),
    L('Schoonmaak dagelijks','dag',null,null,['Handcontactpunten: grepen, kranen en schakelaars','Wasbakken en spoelbakken','Afvalbakken binnen- en buitenkant','Vaatdoeken en theedoeken naar de was','Vloer en afvoerputjes']),
    L('Schoonmaak wekelijks','week',null,null,['Koelingen uitgeruimd en binnenkant schoon','Filters van de afzuigkap','Oven grondig','Magnetron en kleine apparatuur','Wanden en tegels achter de apparatuur','Stellingen droog magazijn','Vriezers gecontroleerd op ijsvorming']),
    L('Schoonmaak maandelijks','maand',null,null,['Vriezers ontdooid en schoongemaakt','Achter en onder de apparatuur','Afzuigkap grondig','Plafond en verlichting stofvrij','Afwasmachine ontkalkt'])
  ],
  bar:[
    L('Openen','dag',null,null,['Bar en werkblad schoon','Koffiemachine aan en doorgespoeld','Tap gecontroleerd; eerste glas weggegooid','Koelingen aangevuld (oud voor, nieuw achter); temperaturen ingevuld','Garnering gesneden: citroen, limoen, munt','IJs aangevuld','Glaswerk gepoleerd en aangevuld','Kassa en pin opgestart; wisselgeld geteld','Terras en tafels klaargezet','Muziek en verlichting aan']),
    L('Sluiten','dag',null,null,['Koffiemachine schoon: teruggespoeld, stoompijpje en lekbak','Tapkranen gespoeld; lekbakken schoon','Garnering afgedekt in de koeling of weggegooid','Spoelbakken en afvoer schoon','Glazenspoelmachine geleegd en schoongemaakt','Koelingen aangevuld voor morgen','Bar, werkblad en flessen afgenomen','Vloer achter de bar geveegd en gedweild','Afval en glas weggebracht','Kassa afgesloten en geteld','Terrasmeubilair binnen of vastgezet','Muziek, verlichting en apparatuur uit; deuren op slot',['tekst','Bijzonderheden voor de volgende dienst']]),
    L('Schoonmaak dagelijks','dag',null,null,['Speedrail en flessenrek','IJsschep en ijsbak','Handcontactpunten: grepen, kranen en pin','Afvalbakken binnen- en buitenkant']),
    L('Schoonmaak wekelijks','week',null,null,['Koelingen uitgeruimd en binnenkant schoon','Bierleidingen gereinigd volgens schema','Koffiemolen en bonenreservoir','Planken en flessen van de achterbar','Afvoerputjes']),
    L('Schoonmaak maandelijks','maand',null,null,['IJsmachine gereinigd en ontkalkt','Koffiemachine ontkalkt','Achter en onder de koelingen','Planken in het magazijn'])
  ],
  housekeeping:[
    L('Dagrapport housekeeping','dag',null,'18:00',[['getal','Aantal check-outs schoongemaakt',true],['getal','Aantal stay-overs schoongemaakt',true],['getal','Aantal niet storen',true],['tekst','Bijzonderheden',true]])
  ]
};

var S={db:null,dl:null,view:'vandaag',day:null,follow:true,month:null,cfg:null,cfgLoaded:false,logs:{},logsLoaded:false,sig:'',open:{},openInit:false,seeding:false};
var chain={},toastT;

/* ---------- hulpjes ---------- */
function $(s,r){return (r||document).querySelector(s)}
function $all(s,r){return [].slice.call((r||document).querySelectorAll(s))}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function ls(k,v){try{if(v===undefined)return localStorage.getItem('dv.'+k);localStorage.setItem('dv.'+k,v)}catch(e){return null}}
function toast(msg){var t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true},4200)}
function openModal(html,cls){var m=$('#modal');m.innerHTML='<div class="sheet'+(cls?' '+cls:'')+'" role="dialog" aria-modal="true" tabindex="-1">'+html+'</div>';m.hidden=false;var f=$('.sheet',m);if(f)f.focus()}
function closeModal(){var m=$('#modal');m.hidden=true;m.innerHTML=''}
function p2(n){return (n<10?'0':'')+n}
function ymd(d){return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())}
function today(){return ymd(new Date())}
function toDate(s){var a=s.split('-');return new Date(+a[0],+a[1]-1,+a[2]||1,12)}
function addDays(s,n){var d=toDate(s);d.setDate(d.getDate()+n);return ymd(d)}
function addMonths(m,n){var d=toDate(m+'-01');d.setMonth(d.getMonth()+n);return ymd(d).slice(0,7)}
function daysIn(m){var a=m.split('-');return new Date(+a[0],+a[1],0).getDate()}
function wday(s){var d=toDate(s).getDay();return d===0?7:d}                      /* 1 = maandag … 7 = zondag */
function isoWeek(s){var d=toDate(s);d.setDate(d.getDate()+4-wday(s));var y=d.getFullYear(),w=Math.ceil(((d-new Date(y,0,1,12))/864e5+1)/7);return y+'-W'+p2(w)}
function dayLabel(s){var d=toDate(s);return DAGEN[d.getDay()]+' '+d.getDate()+' '+MND[d.getMonth()]}
function monthLabel(m){var a=m.split('-');return MAAND[+a[1]-1]+' '+a[0]}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}
function mins(t){var a=/^(\d{1,2}):(\d{2})/.exec(t||'');return a?+a[1]*60+ +a[2]:null}
function nowMin(){var d=new Date();return d.getHours()*60+d.getMinutes()}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5)}
function parseNum(v){v=String(v==null?'':v).trim().replace(/−/g,'-').replace(',','.');if(!/^-?\d{1,6}(\.\d{1,2})?$/.test(v))return null;return parseFloat(v)}
function nl(n){return String(n).replace('.',',')}

/* ---------- gegevens ---------- */
function lists(all){
  var o=(S.cfg&&S.cfg.lists)||{};
  return Object.keys(o).map(function(id){var l=o[id]||{};return {id:id,name:l.name||'Lijst',desc:l.desc||'',freq:FREQ[l.freq]?l.freq:'dag',start:l.start||null,end:l.end||null,ord:typeof l.ord==='number'?l.ord:999,since:l.since||null,gone:l.gone||null,tasks:l.tasks||{}}})
    .filter(function(l){return all||!l.gone})
    .sort(function(a,b){return a.ord-b.ord||a.name.localeCompare(b.name,'nl')});
}
function tasks(l,all){
  return Object.keys(l.tasks).map(function(id){var t=l.tasks[id]||{};return {id:id,type:TYPE[t.type]?t.type:'check',text:t.text||'',info:t.info||'',time:t.time||'',days:Array.isArray(t.days)&&t.days.length?t.days:null,req:!!t.req,ord:typeof t.ord==='number'?t.ord:999,since:t.since||null,gone:t.gone||null}})
    .filter(function(t){return all||!t.gone})
    .sort(function(a,b){return a.ord-b.ord});
}
/* periode van een lijst: dag 'JJJJ-MM-DD', week 'JJJJ-Www', maand 'JJJJ-MM' */
function periodKey(l,day){return l.freq==='week'?isoWeek(day):l.freq==='maand'?day.slice(0,7):day}
function logRef(l,key){
  if(l.freq==='week')return {id:KEY+'_'+key.slice(0,4)+'-w',grp:'weeks',k:key.slice(5)};
  if(l.freq==='maand')return {id:KEY+'_'+key.slice(0,4)+'-m',grp:'months',k:key.slice(5)};
  return {id:KEY+'_'+key.slice(0,7),grp:'days',k:key.slice(8)};
}
function entry(l,key){var r=logRef(l,key),d=S.logs[r.id],g=d&&d[r.grp]&&d[r.grp][r.k];return (g&&g[l.id]&&g[l.id].t)||{}}
function filled(t,e){
  if(!e)return false;
  if(t.type==='check')return e.v===true;
  if(t.type==='getal')return typeof e.v==='number';
  return typeof e.v==='string'&&e.v.trim()!=='';
}
function counts(t){return t.type==='check'||((t.type==='getal'||t.type==='tekst')&&t.req)}
/* taken die bij deze lijst in deze periode horen */
function tasksFor(l,key){
  var e=entry(l,key);
  return tasks(l,true).filter(function(t){
    if(filled(t,e[t.id]))return true;
    if(l.freq!=='dag')return !t.gone;
    if(t.since&&t.since>key)return false;
    if(t.gone&&key>=t.gone)return false;
    return !t.days||t.days.indexOf(wday(key))>=0;
  });
}
function listExpected(l,day){return (!l.since||l.since<=day)&&(!l.gone||day<l.gone)}
function progress(l,key){
  var e=entry(l,key),ts=tasksFor(l,key).filter(counts),done=ts.filter(function(t){return filled(t,e[t.id])}).length;
  return {done:done,total:ts.length,complete:ts.length>0&&done===ts.length};
}
/* Loopt een dienst over middernacht (bv. 22:45–07:00), dan hoort de nacht bij de dag waarop hij begon. */
function overMidnight(l){var a=mins(l.start),b=mins(l.end);return l.freq==='dag'&&a!==null&&b!==null&&b<a}
function listDay(l){
  if(!S.follow)return S.day;
  if(overMidnight(l)&&nowMin()<mins(l.end)+120&&nowMin()<mins(l.start))return addDays(today(),-1);
  return today();
}
function keyOf(l){return periodKey(l,listDay(l))}
function timeText(l){return l.start&&l.end?l.start+'–'+l.end:l.end?'vóór '+l.end:l.start?'vanaf '+l.start:''}
function status(l,key){
  var p=progress(l,key);
  if(p.complete)return {k:'klaar',label:'Klaar',cls:'good'};
  var live=S.follow&&l.freq==='dag',late=false;
  if(live&&l.end&&mins(l.end)!==null){
    if(overMidnight(l))late=key<today()&&nowMin()>mins(l.end);
    else late=key===today()&&nowMin()>mins(l.end);
  }
  if(late)return {k:'laat',label:'Te laat',cls:'bad'};
  if(!S.follow&&l.freq==='dag'&&key<today())return p.done?{k:'deels',label:'Niet af',cls:'warn'}:{k:'gemist',label:'Niet gedaan',cls:'bad'};
  return p.done?{k:'bezig',label:'Bezig',cls:'warn'}:{k:'open',label:'Nog te doen',cls:''};
}

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
function saveTask(l,key,tid,fields){
  var r=logRef(l,key),t={},li={},g={},patch={page:KEY};
  t[tid]=fields;li[l.id]={t:t};g[r.k]=li;patch[r.grp]=g;
  return write('checklog/'+r.id,patch).then(null,function(){toast('Opslaan lukt niet. Controleer je internetverbinding en probeer het opnieuw.')});
}
function seed(){
  var src=SEED[(P.area||'').toLowerCase()];
  if(S.seeding||!src)return;S.seeding=true;
  var o={},t0=today();
  src.forEach(function(l,i){
    var ts={};
    l.tasks.forEach(function(x,j){
      var a=Array.isArray(x)?x:['check',x],d={type:a[0],text:a[1],ord:j+1,since:t0};
      if(a[2])d.req=true;
      ts['k'+p2(j+1)]=d;
    });
    var d={name:l.name,freq:l.freq,ord:i+1,since:t0,tasks:ts};
    if(l.start)d.start=l.start;if(l.end)d.end=l.end;
    o['l'+p2(i+1)]=d;
  });
  S.db.doc('check/'+KEY).set({page:KEY,lists:o}).then(null,function(){S.seeding=false});
}

/* ---------- weergave ---------- */
function render(){
  $all('.tabs a').forEach(function(a){if(a.getAttribute('href')==='#'+S.view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  var v=$('#view');
  if(!S.cfgLoaded||!S.logsLoaded){v.innerHTML='<div class="empty"><h3>Checklijsten laden…</h3><p>De lijsten en wat er is afgetekend worden opgehaald.</p></div>';S.sig='';return}
  if(S.view==='vandaag'){
    var ls_=dayLists();
    if(!S.openInit&&ls_.length){S.openInit=true;var first=pickOpen(ls_);if(first)S.open[first]=true}
    var sg='v|'+S.day+'|'+S.follow+'|'+JSON.stringify(ls_.map(function(l){var k=keyOf(l);return [l.id,l.name,l.start,l.end,k,!!S.open[l.id],S.open[l.id]?tasksFor(l,k).map(function(t){return [t.id,t.type,t.text,t.info,t.time]}):0]}));
    if(sg===S.sig&&$('#lists')){patchDay();return}
    S.sig=sg;renderDay();
  }else{
    S.sig='';
    if(S.view==='overzicht')renderMonth();else renderManage();
  }
}
function dayLists(){return lists(true).filter(function(l){var k=keyOf(l);return listExpected(l,l.freq==='dag'?k:listDay(l))||Object.keys(entry(l,k)).length>0})}
/* welke lijst staat open bij binnenkomst: de dienst die nu loopt, anders de eerste die nog niet af is */
function pickOpen(ls_){
  var n=nowMin(),cur=ls_.filter(function(l){
    var a=mins(l.start),b=mins(l.end);if(l.freq!=='dag'||a===null||b===null)return false;
    return b<a?(n>=a||n<b):(n>=a&&n<b);
  }).filter(function(l){return !progress(l,keyOf(l)).complete})[0];
  if(cur)return cur.id;
  var open=ls_.filter(function(l){return !progress(l,keyOf(l)).complete})[0];
  return open?open.id:null;
}
function periodText(l,key){
  if(l.freq==='week')return 'Week '+(+key.slice(6));
  if(l.freq==='maand')return cap(monthLabel(key));
  var t=timeText(l);
  if(S.follow&&key!==today())t=(t?t+' · ':'')+'begonnen '+dayLabel(key);
  return t;
}
function renderDay(){
  var day=S.day,isToday=day===today(),ls_=dayLists();
  var h='<section class="stack">'
    +'<div class="daybar"><button class="iconbtn" id="prev" aria-label="Vorige dag">‹</button>'
    +'<div class="dy"><b>'+(isToday?'Vandaag · ':'')+esc(dayLabel(day))+'</b><span class="muted" id="prog"></span></div>'
    +'<button class="iconbtn" id="next" aria-label="Volgende dag"'+(isToday?' disabled':'')+'>›</button></div>';
  if(!isToday)h+='<div class="note warn spread"><span>Je bekijkt een eerdere dag. Wat je hier aftekent, telt voor '+esc(dayLabel(day))+'.</span><button class="btn" id="totoday">Naar vandaag</button></div>';
  if(!ls_.length){
    h+='<div class="card empty"><h3>'+(lists().length?'Geen lijsten op deze dag':'Nog geen checklijsten')+'</h3><p>'+(lists().length?'Op deze dag stonden er nog geen lijsten klaar.':'Maak de eerste lijst aan bij Lijsten.')+'</p></div>';
  }else{
    h+='<div class="card"><div class="field"><label for="naam">Je naam</label><input class="input" id="naam" autocomplete="name" placeholder="Je naam" value="'+esc(ls('naam')||'')+'"><small>Je naam komt bij alles wat je aftekent en wordt op dit apparaat onthouden.</small></div></div>';
    h+='<div id="lists" class="stack">';
    ls_.forEach(function(l){
      var key=keyOf(l),open=!!S.open[l.id];
      h+='<section class="clist" data-lid="'+esc(l.id)+'" data-key="'+esc(key)+'">'
        +'<button type="button" class="chead" aria-expanded="'+open+'" aria-controls="b-'+esc(l.id)+'">'
        +'<span class="chev" aria-hidden="true">›</span><span class="ctitle"><b>'+esc(l.name)+'</b><span class="csub"></span></span><span class="pill cpill"></span></button>';
      if(open){
        h+='<div class="cbody" id="b-'+esc(l.id)+'">'+(l.desc?'<p class="muted cdesc">'+esc(l.desc)+'</p>':'')+'<ul class="ctasks">';
        var ts=tasksFor(l,key),buf='',pendingKop='';
        ts.forEach(function(t){
          if(t.type==='kop'){pendingKop='<li class="ckop">'+esc(t.text)+'</li>';return}
          buf+=pendingKop;pendingKop='';
          var head=(t.time?'<span class="ctime">'+esc(t.time)+'</span>':'')+'<span class="ctext">'+esc(t.text)+(t.req&&t.type!=='check'?' <span class="creq">verplicht</span>':'')+'</span>'+(t.info?'<span class="cinfo">'+esc(t.info)+'</span>':'');
          if(t.type==='check')buf+='<li class="ctask" data-tid="'+esc(t.id)+'" data-type="check"><button type="button" class="cbox" role="checkbox" aria-checked="false" aria-label="'+esc(t.text)+'"><span aria-hidden="true">✓</span></button><div class="cmain">'+head+'<span class="cwho"></span></div></li>';
          else if(t.type==='getal')buf+='<li class="ctask cin" data-tid="'+esc(t.id)+'" data-type="getal"><div class="cmain">'+head+'<span class="cwho"></span></div><input class="cnum" inputmode="decimal" autocomplete="off" aria-label="'+esc(t.text)+'"></li>';
          else buf+='<li class="ctask cin wide" data-tid="'+esc(t.id)+'" data-type="tekst"><div class="cmain">'+head+'<span class="cwho"></span></div><textarea class="input ctxt" rows="2" aria-label="'+esc(t.text)+'"></textarea></li>';
        });
        h+=(buf||'<li class="ckop">Geen taken op deze dag.</li>')+'</ul></div>';
      }
      h+='</section>';
    });
    h+='</div>';
  }
  h+='</section>';
  $('#view').innerHTML=h;
  patchDay();
}
function whoText(e,key,l){
  if(!e||!e.at)return (e&&e.by)||'';
  var d=new Date(e.at),t=p2(d.getHours())+':'+p2(d.getMinutes());
  return (e.by?e.by+' · ':'')+(l.freq==='dag'&&ymd(d)===key?t:d.getDate()+' '+MND[d.getMonth()]+' '+t);
}
function patchDay(){
  var ls_=dayLists(),byId={},all=0,ok=0;
  ls_.forEach(function(l){byId[l.id]=l});
  $all('#lists .clist').forEach(function(sec){
    var l=byId[sec.getAttribute('data-lid')];if(!l)return;
    var key=sec.getAttribute('data-key'),p=progress(l,key),st=status(l,key),e=entry(l,key),pt=periodText(l,key);
    all++;if(p.complete)ok++;
    $('.csub',sec).textContent=(pt?pt+' · ':'')+p.done+' van '+p.total;
    var pill=$('.cpill',sec);pill.className='pill cpill'+(st.cls?' '+st.cls:'');pill.textContent=st.label;
    sec.classList.toggle('done',p.complete);
    var ts={};tasksFor(l,key).forEach(function(t){ts[t.id]=t});
    $all('.ctask',sec).forEach(function(li){
      var t=ts[li.getAttribute('data-tid')];if(!t)return;
      var x=e[t.id]||{},f=filled(t,x);
      li.classList.toggle('on',f);
      if(t.type==='check')$('.cbox',li).setAttribute('aria-checked',f?'true':'false');
      else{var inp=$('.cnum,.ctxt',li);if(document.activeElement!==inp)inp.value=f?(t.type==='getal'?nl(x.v):x.v):''}
      $('.cwho',li).textContent=f?whoText(x,key,l):'';
    });
  });
  var pr=$('#prog');if(pr)pr.textContent=all?ok+' van '+all+' lijsten klaar':'';
}
function needName(){
  var f=$('#naam'),nm=((f||{}).value||'').trim();
  if(!nm){toast('Vul eerst je naam in.');if(f){f.focus();f.scrollIntoView({block:'center'})}return null}
  return nm;
}
function ctx(el){
  var li=el.closest('.ctask'),sec=el.closest('.clist');if(!li||!sec)return null;
  var l=lists(true).filter(function(x){return x.id===sec.getAttribute('data-lid')})[0];if(!l)return null;
  return {li:li,l:l,key:sec.getAttribute('data-key'),tid:li.getAttribute('data-tid'),type:li.getAttribute('data-type')};
}
function toggleTask(el){
  var c=ctx(el);if(!c)return;
  var nm=needName();if(!nm)return;
  var cur=entry(c.l,c.key)[c.tid]||{};
  saveTask(c.l,c.key,c.tid,{v:cur.v===true?false:true,at:new Date().toISOString(),by:nm});
}
function commitInput(el){
  var c=ctx(el);if(!c)return;
  var cur=entry(c.l,c.key)[c.tid]||{},raw=el.value.trim(),v;
  if(c.type==='getal'){
    if(raw==='')v=null;else{v=parseNum(raw);if(v===null){toast('Vul een getal in, bijvoorbeeld 12.');el.value=typeof cur.v==='number'?nl(cur.v):'';return}}
  }else v=raw===''?null:raw.slice(0,2000);
  if((cur.v==null?null:cur.v)===v)return;
  var nm=needName();if(!nm)return;
  saveTask(c.l,c.key,c.tid,{v:v,at:new Date().toISOString(),by:nm});
}

/* --- overzicht per maand --- */
function monthData(mo){
  var n=daysIn(mo),td=today(),last=mo===td.slice(0,7)?+td.slice(8):n,days=[],rows=[],stats={full:0,total:0,miss:0};
  for(var i=1;i<=n;i++)days.push(mo+'-'+p2(i));
  var daily=lists(true).filter(function(l){return l.freq==='dag'}),other=lists(true).filter(function(l){return l.freq!=='dag'});
  daily.forEach(function(l){
    var cells=[],use=false;
    days.forEach(function(day,ix){
      var past=ix<last,ex=past&&listExpected(l,day),p=progress(l,day),c={day:day,ex:ex,p:p,any:p.done>0};
      if(ex||c.any)use=true;
      if(ex&&p.total){
        /* een nachtdienst die vandaag begint of nog loopt telt nog niet mee als gemist */
        var pending=day===td||(overMidnight(l)&&day===addDays(td,-1)&&nowMin()<mins(l.end)+120);
        c.pending=pending&&!p.complete;
        if(!c.pending){stats.total++;if(p.complete)stats.full++;else if(!p.done)stats.miss++}
      }
      cells.push(c);
    });
    if(use)rows.push({l:l,cells:cells});
  });
  var per=[];
  other.forEach(function(l){
    var keys=[];
    /* alleen weken of maanden waarin de lijst bestond */
    var from=l.since?periodKey(l,l.since):'',to=l.gone?periodKey(l,l.gone):'9';
    days.forEach(function(day,ix){if(ix>=last)return;var k=periodKey(l,day);if(k<from||k>to)return;if(keys.indexOf(k)<0)keys.push(k)});
    var items=keys.map(function(k){return {k:k,p:progress(l,k)}});
    if(!l.gone||items.some(function(x){return x.p.done}))per.push({l:l,items:items});
  });
  return {days:days,last:last,rows:rows,per:per,stats:stats};
}
function renderMonth(){
  var mo=S.month,td=today(),D=monthData(mo),cur=mo===td.slice(0,7);
  var h='<section class="stack"><div class="daybar"><button class="iconbtn" id="mprev" aria-label="Vorige maand">‹</button>'
    +'<div class="dy"><b>'+esc(cap(monthLabel(mo)))+'</b><span class="muted">'+esc(P.loc+' · '+P.area)+'</span></div>'
    +'<button class="iconbtn" id="mnext" aria-label="Volgende maand"'+(cur?' disabled':'')+'>›</button></div>';
  if(!D.rows.length&&!D.per.length){
    h+='<div class="card empty"><h3>Niets afgetekend in '+esc(monthLabel(mo))+'</h3><p>Zodra er lijsten zijn afgetekend, zie je ze hier per dag terug.</p></div></section>';
    $('#view').innerHTML=h;return;
  }
  var part=D.stats.total-D.stats.full-D.stats.miss;
  h+='<div class="stats"><div class="stat"><span class="v num">'+D.stats.full+' <span class="muted" style="font-size:15px;font-weight:600">van '+D.stats.total+'</span></span><span class="l">lijsten helemaal af</span></div>'
    +'<div class="stat"><span class="v num"'+(part?' style="color:var(--warn)"':'')+'>'+part+'</span><span class="l">lijsten niet af</span></div>'
    +'<div class="stat"><span class="v num"'+(D.stats.miss?' style="color:var(--bad)"':'')+'>'+D.stats.miss+'</span><span class="l">lijsten niet gedaan</span></div></div>';
  if(D.rows.length){
    h+='<div class="stack"><div class="spread"><h3>Dagelijkse lijsten</h3><span class="muted" style="font-size:13px">✓ = af · 5/8 = deels · ! = niet gedaan · tik op een dag om hem te openen</span></div>'
      +'<div class="gridwrap" id="gridwrap" tabindex="0" role="region" aria-label="Checklijsten per dag"><table class="mgrid cgrid"><thead><tr><th class="dev">Lijst</th>';
    D.days.forEach(function(day,ix){
      var w=wday(day),wk=w>=6;
      h+='<th class="'+(wk?'wk':'')+(day===td?' today':'')+'">'+(ix<D.last?'<button type="button" data-day="'+day+'" aria-label="Open '+esc(dayLabel(day))+'">'+(ix+1)+'</button>':'<span class="muted" style="opacity:.5">'+(ix+1)+'</span>')+'</th>';
    });
    h+='</tr></thead><tbody>';
    D.rows.forEach(function(r){
      h+='<tr><th class="dev" scope="row">'+esc(r.l.name)+(r.l.gone?' <span class="muted" style="font-weight:500">(verwijderd)</span>':'')+(timeText(r.l)?'<div class="muted" style="font-weight:500;font-size:11.5px">'+esc(timeText(r.l))+'</div>':'')+'</th>';
      r.cells.forEach(function(c){
        var cl=wday(c.day)>=6?'wk':'';
        if(c.p.complete)h+='<td class="'+cl+' ok" title="Helemaal af">✓</td>';
        else if(c.any)h+='<td class="'+cl+' part" title="Deels afgetekend">'+c.p.done+'/'+c.p.total+'</td>';
        else if(c.ex&&c.p.total&&!c.pending)h+='<td class="'+cl+' miss" title="Niet gedaan">!</td>';
        else h+='<td class="'+cl+'"></td>';
      });
      h+='</tr>';
    });
    h+='</tbody></table></div></div>';
  }
  if(D.per.length){
    h+='<div class="card stack"><h3>Wekelijkse en maandelijkse lijsten</h3><ul class="devlist">';
    D.per.forEach(function(x){
      h+='<li><div class="spread"><b>'+esc(x.l.name)+'</b><span class="muted" style="font-size:13px">'+esc(FREQ[x.l.freq].toLowerCase())+'</span></div><div class="rowflex">';
      x.items.forEach(function(it){
        var lab=x.l.freq==='week'?'week '+(+it.k.slice(6)):monthLabel(it.k),nowKey=periodKey(x.l,td);
        var cls=it.p.complete?'good':it.p.done?'warn':it.k<nowKey?'bad':'';
        var txt=it.p.complete?'af':it.p.done?it.p.done+' van '+it.p.total:it.k<nowKey?'niet gedaan':'nog te doen';
        h+='<span class="pill '+cls+'">'+esc(lab)+': '+esc(txt)+'</span>';
      });
      h+='</div></li>';
    });
    h+='</ul></div>';
  }
  h+='<div class="rowflex"><button class="btn" id="csv">Download '+esc(monthLabel(mo))+' (CSV)</button><span class="muted" style="font-size:13px">Alles wat deze maand is afgetekend of ingevuld, te openen in Excel.</span></div></section>';
  $('#view').innerHTML=h;
  var gw=$('#gridwrap'),tc=gw&&$('th.today',gw);
  if(gw&&tc)gw.scrollLeft=Math.max(0,tc.offsetLeft-gw.clientWidth+tc.offsetWidth+8);
}
function buildCsv(mo){
  var D=monthData(mo),Lr=[['Periode','Locatie','Plek','Lijst','Tijd','Taak','Soort','Gedaan of waarde','Door','Tijdstip']];
  function q(v){v=String(v==null?'':v);return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
  function rowsFor(l,key){
    var e=entry(l,key);
    tasksFor(l,key).forEach(function(t){
      if(t.type==='kop')return;
      var x=e[t.id]||{},f=filled(t,x),at=x.at&&f?new Date(x.at):null;
      Lr.push([key,P.loc,P.area,l.name,t.time,t.text,TYPE[t.type],t.type==='check'?(f?'ja':'nee'):(f?(t.type==='getal'?nl(x.v):x.v):''),f?(x.by||''):'',at?ymd(at)+' '+p2(at.getHours())+':'+p2(at.getMinutes()):'']);
    });
  }
  D.rows.forEach(function(r){r.cells.forEach(function(c){if(c.ex||c.any)rowsFor(r.l,c.day)})});
  D.per.forEach(function(x){x.items.forEach(function(it){rowsFor(x.l,it.k)})});
  return '﻿'+Lr.map(function(r){return r.map(q).join(';')}).join('\r\n');
}

/* --- lijsten beheren --- */
function renderManage(){
  var ls_=lists();
  var h='<section class="stack"><div class="spread"><div><h2>Lijsten</h2><span class="muted">'+esc(P.loc+' · '+P.area)+' · '+ls_.length+' '+(ls_.length===1?'lijst':'lijsten')+'</span></div><button class="btn primary" id="add">Lijst toevoegen</button></div>';
  if(!ls_.length)h+='<div class="card empty"><h3>Nog geen checklijsten</h3><p>Maak een lijst voor bijvoorbeeld openen, sluiten of de schoonmaak, en zet de taken erin.</p></div>';
  else{
    h+='<ul class="rows">';
    ls_.forEach(function(l,i){
      var n=tasks(l).filter(function(t){return t.type!=='kop'}).length;
      h+='<li class="prow"><button type="button" class="pmain" data-edit="'+esc(l.id)+'"><b>'+esc(l.name)+'</b><span class="muted" style="font-size:13px">'+esc(FREQ[l.freq])+(timeText(l)?' · '+esc(timeText(l)):'')+' · '+n+' '+(n===1?'taak':'taken')+'</span></button>'
        +'<button type="button" class="mv" data-move="-1" data-id="'+esc(l.id)+'" aria-label="'+esc(l.name)+' omhoog"'+(i===0?' disabled':'')+'>▲</button>'
        +'<button type="button" class="mv" data-move="1" data-id="'+esc(l.id)+'" aria-label="'+esc(l.name)+' omlaag"'+(i===ls_.length-1?' disabled':'')+'>▼</button></li>';
    });
    h+='</ul><p class="muted" style="font-size:13px">Tik op een lijst om de taken aan te passen. Wat al is afgetekend blijft bewaard, ook als je een taak of lijst later verwijdert.</p>';
  }
  h+='</section>';
  $('#view').innerHTML=h;
}
function taskRow(t){
  var days='';for(var i=1;i<=7;i++)days+='<label class="dchk"><input type="checkbox" value="'+i+'"'+(!t.days||t.days.indexOf(i)>=0?' checked':'')+'><span>'+WD[i-1]+'</span></label>';
  return '<li class="etask" data-tid="'+esc(t.id||'')+'" data-type="'+esc(t.type)+'">'
    +'<div class="erow"><span class="emv"><button type="button" class="mv" data-tmove="-1" aria-label="Omhoog">▲</button><button type="button" class="mv" data-tmove="1" aria-label="Omlaag">▼</button></span>'
    +'<textarea class="input e-text" rows="1" placeholder="'+(t.type==='kop'?'Tussenkop, bv. 07:00 – 11:00':'Wat moet er gebeuren?')+'" aria-label="Taak">'+esc(t.text)+'</textarea>'
    +'<button type="button" class="mv e-more" aria-expanded="false" aria-label="Meer instellingen">⋯</button></div>'
    +'<div class="emore" hidden><div class="grid2"><div class="field"><label>Soort</label><select class="input e-type">'+Object.keys(TYPE).map(function(k){return '<option value="'+k+'"'+(k===t.type?' selected':'')+'>'+TYPE[k]+'</option>'}).join('')+'</select></div>'
    +'<div class="field e-nokop"><label>Tijd (optioneel)</label><input class="input e-time" autocomplete="off" maxlength="40" placeholder="bv. 07:30" value="'+esc(t.time)+'"></div></div>'
    +'<div class="field e-nokop"><label>Toelichting (optioneel)</label><textarea class="input e-info" rows="2">'+esc(t.info)+'</textarea></div>'
    +'<div class="field e-nokop e-days"><label>Op welke dagen</label><div class="rowflex">'+days+'</div></div>'
    +'<label class="dchk e-reqwrap"><input type="checkbox" class="e-req"'+(t.req?' checked':'')+'><span>Verplicht invullen</span></label>'
    +'<div><button type="button" class="btn danger e-del">Taak verwijderen</button></div></div></li>';
}
function openList(id){
  var l=id?lists().filter(function(x){return x.id===id})[0]:null;
  if(id&&!l)return;
  var ts=l?tasks(l):[];
  var h='<h2>'+(l?'Lijst aanpassen':'Lijst toevoegen')+'</h2>'
    +'<div class="field"><label for="e-naam">Naam</label><input class="input" id="e-naam" autocomplete="off" maxlength="60" value="'+esc(l?l.name:'')+'" placeholder="bv. Openen"></div>'
    +'<div class="grid2"><div class="field"><label for="e-freq">Hoe vaak</label><select class="input" id="e-freq">'+Object.keys(FREQ).map(function(k){return '<option value="'+k+'"'+(k===(l?l.freq:'dag')?' selected':'')+'>'+FREQ[k]+'</option>'}).join('')+'</select></div>'
    +'<div class="field" id="e-timewrap"><label>Dienst van – tot (optioneel)</label><div class="rowflex" style="flex-wrap:nowrap"><input class="input" id="e-start" type="time" aria-label="Begin van de dienst" value="'+esc(l&&l.start||'')+'"><input class="input" id="e-end" type="time" aria-label="Einde van de dienst" value="'+esc(l&&l.end||'')+'"></div><small>Na de eindtijd staat een lijst die niet af is op "Te laat".</small></div></div>'
    +'<div class="field"><label for="e-desc">Omschrijving (optioneel)</label><input class="input" id="e-desc" autocomplete="off" maxlength="200" value="'+esc(l?l.desc:'')+'"></div>'
    +'<div class="stack"><div class="spread"><h3>Taken</h3><span class="muted" style="font-size:13px">⋯ = tijd, toelichting, dagen en soort</span></div>'
    +'<ol class="etasks" id="e-tasks">'+ts.map(taskRow).join('')+'</ol>'
    +'<div class="rowflex"><button type="button" class="btn" id="e-add">Taak toevoegen</button><button type="button" class="btn" id="e-addkop">Tussenkop toevoegen</button></div></div>'
    +'<p class="gate-msg" id="e-msg" role="alert" style="min-height:0"></p>'
    +'<div class="spread" id="e-btns">'+(l?'<button class="btn danger" id="e-del">Lijst verwijderen</button>':'<span></span>')
    +'<span class="rowflex"><button class="btn ghost" data-close>Annuleren</button><button class="btn primary" id="e-save">Opslaan</button></span></div>';
  openModal(h,'tall');
  var sheet=$('#modal .sheet');sheet.setAttribute('data-id',id||'');
  syncEditor();$all('#e-tasks .e-text').forEach(grow);
  if(!l){addTaskRow('check');setTimeout(function(){var f=$('#e-naam');if(f)f.focus()},50)}
}
function grow(ta){ta.style.height='auto';ta.style.height=Math.min(220,ta.scrollHeight+2)+'px'}
function syncEditor(){
  var daily=$('#e-freq').value==='dag';
  $('#e-timewrap').hidden=!daily;
  $all('#e-tasks .etask').forEach(function(li){
    var type=$('.e-type',li).value;li.setAttribute('data-type',type);
    $all('.e-nokop',li).forEach(function(el){el.hidden=type==='kop'||(el.classList.contains('e-days')&&!daily)});
    $('.e-reqwrap',li).hidden=type!=='getal'&&type!=='tekst';
  });
}
function addTaskRow(type){
  var ol=$('#e-tasks');ol.insertAdjacentHTML('beforeend',taskRow({id:'',type:type,text:'',info:'',time:'',days:null,req:false}));
  syncEditor();var li=ol.lastElementChild;$('.e-text',li).focus();li.scrollIntoView({block:'nearest'});
}
function doSaveList(){
  var sheet=$('#modal .sheet'),id=sheet.getAttribute('data-id'),msg=$('#e-msg'),t0=today();
  var name=$('#e-naam').value.trim().replace(/\s+/g,' '),freq=$('#e-freq').value;
  if(!name){msg.textContent='Geef de lijst een naam.';$('#e-naam').focus();return}
  var old=id?(lists().filter(function(x){return x.id===id})[0]||{tasks:{}}):{tasks:{}},ts={},n=0,seen={},bad=null;
  $all('#e-tasks .etask').forEach(function(li){
    var tid=li.getAttribute('data-tid'),text=$('.e-text',li).value.trim().replace(/\s*\n\s*/g,' ');
    if(li.hasAttribute('data-removed')||!text){if(tid&&!li.hasAttribute('data-removed')&&!bad)bad=li;if(tid&&li.hasAttribute('data-removed')){ts[tid]={gone:t0};seen[tid]=1}return}
    var type=$('.e-type',li).value,d={type:type,text:text.slice(0,300),ord:++n,gone:null};
    if(type==='kop'){d.info='';d.time='';d.days=null;d.req=false}
    else{
      d.info=$('.e-info',li).value.trim().replace(/\s*\n\s*/g,' ').slice(0,600);d.time=$('.e-time',li).value.trim();
      var days=$all('.e-days input:checked',li).map(function(c){return +c.value});
      d.days=freq==='dag'&&days.length>0&&days.length<7?days:null;
      d.req=(type==='getal'||type==='tekst')&&$('.e-req',li).checked;
    }
    if(!tid){tid=uid('k');d.since=t0}
    ts[tid]=d;seen[tid]=1;
  });
  if(bad){msg.textContent='Er staat een lege taak in de lijst. Vul hem in of verwijder hem.';$('.e-text',bad).focus();return}
  if(!n){msg.textContent='Zet minstens één taak in de lijst.';return}
  var f={name:name,desc:$('#e-desc').value.trim(),freq:freq,start:freq==='dag'?($('#e-start').value||null):null,end:freq==='dag'?($('#e-end').value||null):null,tasks:ts};
  if(!id){id=uid('l');f.since=t0;f.ord=lists(true).reduce(function(a,l){return Math.max(a,l.ord<999?l.ord:0)},0)+1}
  var b=$('#e-save');b.disabled=true;b.textContent='Opslaan…';
  var o={};o[id]=f;
  write('check/'+KEY,{page:KEY,lists:o}).then(function(){closeModal();toast('Lijst opgeslagen.')},function(){b.disabled=false;b.textContent='Opslaan';msg.textContent='Opslaan lukt niet. Controleer je internetverbinding.'});
}
function askDeleteList(){
  var name=$('#e-naam').value.trim()||'deze lijst';
  $('#e-btns').outerHTML='<div class="note bad" id="e-btns"><p style="margin-bottom:10px"><b>'+esc(name)+' verwijderen?</b> De lijst verdwijnt uit het dagelijkse scherm. Wat eerder is afgetekend blijft bewaard in het overzicht.</p>'
    +'<div class="rowflex"><button class="btn" data-close>Nee, laat staan</button><button class="btn danger" id="e-del2">Ja, verwijderen</button></div></div>';
}
function doDeleteList(){
  var id=$('#modal .sheet').getAttribute('data-id'),b=$('#e-del2'),o={};b.disabled=true;o[id]={gone:today()};
  write('check/'+KEY,{page:KEY,lists:o}).then(function(){closeModal();toast('Lijst verwijderd.')},function(){b.disabled=false;toast('Verwijderen lukt niet. Controleer je internetverbinding.')});
}
function moveList(id,dir){
  var ls_=lists(),i=ls_.map(function(l){return l.id}).indexOf(id),j=i+dir;
  if(i<0||j<0||j>=ls_.length)return;
  var t=ls_[i];ls_[i]=ls_[j];ls_[j]=t;
  var o={};ls_.forEach(function(l,k){if(l.ord!==k+1)o[l.id]={ord:k+1}});
  write('check/'+KEY,{page:KEY,lists:o}).then(null,function(){toast('Volgorde opslaan lukt niet.')});
}

/* ---------- bediening ---------- */
function setView(v){if(['vandaag','overzicht','lijsten'].indexOf(v)<0)v='vandaag';S.view=v;if(v==='overzicht'&&!S.month)S.month=today().slice(0,7);render();window.scrollTo(0,0)}
function setDay(day){var t=today();if(day>t)day=t;S.day=day;S.follow=day===t;S.openInit=false;S.open={};render()}
document.addEventListener('click',function(ev){
  var el=ev.target.closest('a[href^="#"]');
  if(el){ev.preventDefault();var v=el.getAttribute('href').slice(1);try{history.replaceState(null,'',location.pathname+location.search+'#'+v)}catch(e){}setView(v);return}
  var task=ev.target.closest('.ctask[data-type="check"]');
  if(task&&!ev.target.closest('a')){toggleTask(task);return}
  el=ev.target.closest('button');if(!el)return;
  if(el.hasAttribute('data-close')){closeModal();return}
  if(el.classList.contains('chead')){var lid=el.closest('.clist').getAttribute('data-lid');S.open[lid]=!S.open[lid];render();return}
  if(el.id==='prev'){setDay(addDays(S.day,-1));return}
  if(el.id==='next'){setDay(addDays(S.day,1));return}
  if(el.id==='totoday'){setDay(today());return}
  if(el.id==='mprev'){S.month=addMonths(S.month,-1);render();return}
  if(el.id==='mnext'){S.month=addMonths(S.month,1);render();return}
  if(el.hasAttribute('data-day')){S.view='vandaag';try{history.replaceState(null,'',location.pathname+location.search+'#vandaag')}catch(e){}setDay(el.getAttribute('data-day'));window.scrollTo(0,0);return}
  if(el.id==='csv'){
    var data=buildCsv(S.month),name='checklijsten-'+KEY+'-'+S.month+'.csv';
    (S.dl?S.dl.save({filename:name,data:data}):Promise.reject()).then(null,function(){toast('Downloaden lukt niet op dit apparaat.')});return;
  }
  if(el.id==='add'){openList(null);return}
  if(el.hasAttribute('data-edit')){openList(el.getAttribute('data-edit'));return}
  if(el.hasAttribute('data-move')){moveList(el.getAttribute('data-id'),+el.getAttribute('data-move'));return}
  if(el.id==='e-save'){doSaveList();return}
  if(el.id==='e-del'){askDeleteList();return}
  if(el.id==='e-del2'){doDeleteList();return}
  if(el.id==='e-add'){addTaskRow('check');return}
  if(el.id==='e-addkop'){addTaskRow('kop');return}
  var li=el.closest('.etask');if(!li)return;
  if(el.classList.contains('e-more')){var m=$('.emore',li);m.hidden=!m.hidden;el.setAttribute('aria-expanded',String(!m.hidden));return}
  if(el.classList.contains('e-del')){if(li.getAttribute('data-tid')){li.setAttribute('data-removed','');li.hidden=true}else li.remove();return}
  if(el.hasAttribute('data-tmove')){
    var dir=+el.getAttribute('data-tmove'),sib=li;
    do{sib=dir<0?sib.previousElementSibling:sib.nextElementSibling}while(sib&&sib.hidden);
    if(sib){if(dir<0)li.parentNode.insertBefore(li,sib);else li.parentNode.insertBefore(sib,li);el.focus()}
  }
});
document.addEventListener('change',function(ev){
  var el=ev.target;
  if(el.id==='naam'){var v=el.value.trim();el.value=v;ls('naam',v);if(v)$('#toast').hidden=true;return}
  if(el.classList.contains('cnum')||el.classList.contains('ctxt')){commitInput(el);return}
  if(el.id==='e-freq'||el.classList.contains('e-type')){syncEditor()}
});
document.addEventListener('input',function(ev){if(ev.target.classList&&ev.target.classList.contains('e-text'))grow(ev.target)});
document.addEventListener('keydown',function(ev){
  if(ev.key==='Escape'&&!$('#modal').hidden){closeModal();return}
  var el=ev.target;
  if((ev.key===' '||ev.key==='Enter')&&el.classList&&el.classList.contains('cbox')){ev.preventDefault();toggleTask(el);return}
  if(ev.key!=='Enter')return;
  if(el.classList&&el.classList.contains('cnum')){ev.preventDefault();el.blur()}
  else if(el.id==='naam'){ev.preventDefault();el.blur()}
  else if(el.classList&&el.classList.contains('e-text')){ev.preventDefault();addTaskRow('check')}
});
$('#modal').addEventListener('click',function(ev){if(ev.target===this)closeModal()});
window.addEventListener('hashchange',function(){var v=location.hash.slice(1);if(v&&v!==S.view)setView(v)});
/* een scherm dat blijft openstaan springt vanzelf naar de nieuwe dag en werkt "Te laat" bij */
setInterval(function(){if(S.follow&&S.day!==today()){S.day=today();S.sig=''}if(S.view==='vandaag'&&$('#modal').hidden&&!/^(INPUT|TEXTAREA)$/.test((document.activeElement||{}).tagName||''))render()},60000);
document.addEventListener('visibilitychange',function(){if(!document.hidden&&S.follow&&S.day!==today()){S.day=today();render()}});

/* ---------- start ---------- */
function fail(t,p){$('#view').innerHTML='<div class="empty"><h3>'+esc(t)+'</h3><p>'+esc(p)+'</p></div>'}
if(!P){
  var hh='<div class="card stack"><h2>Kies een plek</h2><ul class="rows">';
  PLEKKEN.forEach(function(p){hh+='<li class="prow"><a class="pmain" style="text-decoration:none;color:inherit;display:block" href="?p='+p.key+'"><b>'+esc(p.loc+' '+p.area.toLowerCase())+'</b></a></li>'});
  $('#view').innerHTML=hh+'</ul></div>';$('.tabs').hidden=true;$('#where').hidden=true;return;
}
document.body.setAttribute('data-page',KEY);document.body.setAttribute('data-loc',P.loc.toLowerCase());
document.title=document.title.replace('Checklijsten','Checklijsten '+P.loc+' '+P.area.toLowerCase());
$('#where').textContent=P.loc+' · '+P.area;
S.day=today();S.month=S.day.slice(0,7);
var hv=location.hash.slice(1);if(hv==='overzicht'||hv==='lijsten')S.view=hv;
if(!window.claude||!window.claude.use){fail('De website is niet goed geladen','Laad de pagina opnieuw. Blijft dit terugkomen, meld het bij de eigenaar.');return}
render();
Promise.all([window.claude.use('db'),window.claude.use('downloads')]).then(function(r){
  S.db=r[0];S.dl=r[1];
  if(!S.db){fail('De website is niet goed geladen','Laad de pagina opnieuw. Blijft dit terugkomen, meld het bij de eigenaar.');return}
  S.db.doc('check/'+KEY).onSnapshot(function(s){
    S.cfg=s.exists?s.data():null;S.cfgLoaded=true;
    if(!s.exists)seed();
    render();
  });
  S.db.collection('checklog').limit(1000).onSnapshot(function(qs){
    var o={};qs.docs.forEach(function(d){if(d.id.indexOf(KEY+'_')===0)o[d.id]=d.data()});
    S.logs=o;S.logsLoaded=true;render();
  });
});
})();
