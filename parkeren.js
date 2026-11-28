/* Parkeren (receptie): welke plek is aan wie verhuurd, met kenteken, borg en sleutel, en een controle op wat nog ontbreekt.
   Vervangt de twee Excel-lijsten (parkeerkalender en borgregistratie). Eén pagina: parkeren/?p=<plek>.
   Gegevens (zie backend.js):
     park/<plek>                   plekken: {spots:{<sid>:{nr,garage,hold,note,ord,gone}}}
     parklog/<plek>_<JJJJ-MM>      verhuringen en blokkades, in de maand van aankomst:
                                   {b:{<id>:{kind:'gast'|'blok',spot,name,room,from,to,t1,t2,plate,dep,keyOut,keyBack,depBack,mews,noshow,note,by,at,gone}}}
     parklog/<plek>_kb-<JJJJ>      kamerborg: {d:{<id>:{room,name,to,amount,how,back,note,by,at,gone}}}
   Twee stappen: eerst reserveren (plek, naam, datums), en pas bij aankomst activeren (kamer, kenteken, borg, sleutel uit = keyOut).
   Bij vertrek afmelden (sleutel terug = keyBack, borg terug = depBack).
   mews = de medewerker heeft bevestigd dat de parkeerkosten in Mews (het hotelsysteem) zijn opgeboekt.
   Een verhuring loopt van de dag van aankomst (from) tot de dag van vertrek (to). De plek telt als bezet op from t/m de dag vóór to:
   op de vertrekdag kan dezelfde plek weer aan een volgende gast. */
(function(){
'use strict';

var PLEKKEN=window.DV_PLEKKEN||[];
var KEY=(/[?&]p=([a-z0-9-]+)/.exec(location.search)||[])[1]||'';
if(!KEY){var only=PLEKKEN.filter(function(p){return p.park});if(only.length===1)KEY=only[0].key}
var P=PLEKKEN.filter(function(p){return p.key===KEY&&p.park})[0];
var DAGEN=['zo','ma','di','wo','do','vr','za'],MND=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'],
    MAAND=['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
var DEP={cash:'Contant',cc:'Creditcard',geen:'Geen borg'};
/* Startindeling: de tien plekken uit de parkeerkalender. Aan te passen onder Plekken. */
var SEED=[['188','J'],['260','J'],['261','J'],['262','J'],['263','J'],['264','J'],['340','B'],['335','B'],['246','B'],['239','B']];

var S={db:null,dl:null,view:'kalender',day:null,month:null,cfg:null,cfgLoaded:false,logs:{},logsLoaded:false,q:'',seeding:false};
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
function nights(a,b){return Math.round((toDate(b)-toDate(a))/864e5)}
function dayLabel(s){var d=toDate(s);return DAGEN[d.getDay()]+' '+d.getDate()+' '+MND[d.getMonth()]}
function monthLabel(m){var a=m.split('-');return MAAND[+a[1]-1]+' '+a[0]}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5)}
function me(){return (ls('naam')||'').trim()}
function stamp(){return {at:new Date().toISOString(),by:me()}}
function stampText(x){if(!x||!x.at)return '';var d=new Date(x.at);return (x.by?x.by+', ':'')+d.getDate()+' '+MND[d.getMonth()]+' '+hm(d)}
function plateFmt(s){return String(s||'').toUpperCase().replace(/\s+/g,'')}
function isDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s||'')}

/* ---------- gegevens ---------- */
function spots(all){
  var o=(S.cfg&&S.cfg.spots)||{};
  return Object.keys(o).map(function(id){var s=o[id]||{};return {id:id,nr:String(s.nr||'?'),garage:s.garage||'',hold:s.hold||'',note:s.note||'',ord:typeof s.ord==='number'?s.ord:999,gone:s.gone||null}})
    .filter(function(s){return all||!s.gone})
    .sort(function(a,b){return a.ord-b.ord||a.nr.localeCompare(b.nr,'nl',{numeric:true})});
}
function spotName(sid){var s=spots(true).filter(function(x){return x.id===sid})[0];return s?s.nr+(s.garage?' '+s.garage:''):'?'}
function bookings(){
  var a=[];
  Object.keys(S.logs).forEach(function(id){
    if(id.indexOf(KEY+'_kb-')===0)return;
    var bs=(S.logs[id]&&S.logs[id].b)||{};
    Object.keys(bs).forEach(function(bid){
      var b=bs[bid];if(!b||b.gone||!isDate(b.from)||!isDate(b.to)||!b.spot)return;
      a.push({id:bid,doc:id,kind:b.kind==='blok'?'blok':'gast',spot:b.spot,name:b.name||'',room:b.room||'',from:b.from,to:b.to,t1:b.t1||'',t2:b.t2||'',plate:b.plate||'',dep:DEP[b.dep]?b.dep:'',
        keyOut:b.keyOut||null,keyBack:b.keyBack||null,depBack:b.depBack||null,mews:b.mews||null,noshow:b.noshow||null,note:b.note||'',by:b.by||''});
    });
  });
  return a.sort(function(x,y){return x.from<y.from?-1:x.from>y.from?1:0});
}
function deposits(){
  var a=[];
  Object.keys(S.logs).forEach(function(id){
    if(id.indexOf(KEY+'_kb-')!==0)return;
    var ds=(S.logs[id]&&S.logs[id].d)||{};
    Object.keys(ds).forEach(function(did){var d=ds[did];if(!d||d.gone)return;a.push({id:did,doc:id,room:d.room||'',name:d.name||'',to:isDate(d.to)?d.to:'',amount:d.amount||'',how:DEP[d.how]?d.how:'',back:d.back||null,note:d.note||'',by:d.by||'',at:d.at||''})});
  });
  return a.sort(function(x,y){return (x.to||'9')<(y.to||'9')?-1:1});
}
function occupies(b,day){return !b.noshow&&b.from<=day&&day<b.to}
function missing(b){
  var m=[];
  if(!b.room)m.push('kamernummer');
  if(!b.plate)m.push('kenteken');
  if(!b.dep)m.push('borg');
  return m;
}
function depOpen(b){return (b.dep==='cash'||b.dep==='cc')&&!b.depBack}
function depBackLabel(dep){return dep==='cash'?'Borg contant terugbetaald':dep==='cc'?'Borg op creditcard teruggestort of vrijgegeven':'Borg terugbetaald of teruggestort'}
/* wat er na het verblijf nog openstaat: sleutel en borg worden apart gecontroleerd */
function afterOpen(b){
  var a=[];
  if(!b.keyBack)a.push('parkeersleutel nog niet terug');
  if(depOpen(b))a.push(b.dep==='cash'?'borg (contant) nog niet terugbetaald':'borg (creditcard) nog niet teruggestort');
  return a;
}
function needsCheckout(b){return !!b.keyOut&&b.to<=today()&&(!b.keyBack||depOpen(b))}
/* stand van één dag: per plek wie er staat, wie er vertrekt en of de plek vrij of geblokkeerd is */
function dayState(day,bs){
  bs=bs||bookings();
  var rows=spots().map(function(s){
    var mine=bs.filter(function(b){return b.spot===s.id});
    var stay=mine.filter(function(b){return occupies(b,day)})[0]||null;
    var leave=mine.filter(function(b){return b.kind==='gast'&&!b.noshow&&b.to===day})[0]||null;
    var st=stay?(stay.kind==='gast'?'verhuurd':'blok'):(s.hold?'vast':'vrij');
    return {s:s,stay:stay,leave:leave,st:st};
  });
  var sold=rows.filter(function(r){return r.st==='verhuurd'}).length,blocked=rows.filter(function(r){return r.st==='blok'||r.st==='vast'}).length;
  return {rows:rows,total:rows.length,sold:sold,blocked:blocked,free:rows.length-sold-blocked,
    arrive:rows.filter(function(r){return r.stay&&r.stay.kind==='gast'&&r.stay.from===day}).length,leave:rows.filter(function(r){return r.leave}).length};
}
/* controle: alles wat vandaag nagekeken of aangevuld moet worden */
function issues(){
  var td=today(),a=[];
  bookings().forEach(function(b){
    if(b.kind!=='gast'||b.noshow)return;
    var who=(b.name||'Gast zonder naam')+' · plek '+spotName(b.spot);
    if(!b.mews)a.push({b:b,day:b.from>td?b.from:(b.to<=td?b.to:td),sev:b.from<=td?'bad':'warn',tag:'Mews',title:who,text:'Kosten nog niet opgeboekt in Mews'+(b.from>td?' (aankomst '+dayLabel(b.from)+')':'')+'. Boek ze op en bevestig het hier.'});
    if(b.from<=td&&td<b.to){
      if(!b.keyOut)a.push({b:b,day:td,sev:b.from===td?'warn':'bad',title:who,text:b.from===td?'Komt vandaag aan. Activeer de plek bij aankomst: kenteken, borg en sleutel.':'Had moeten aankomen op '+dayLabel(b.from)+', maar de plek is niet geactiveerd. Activeer hem of zet de reservering op "niet gekomen".'});
      else{var m=missing(b);if(m.length)a.push({b:b,day:td,sev:'bad',title:who,text:'Geactiveerd, maar nog niet ingevuld: '+m.join(', ')+'.'})}
    }else if(b.to<=td){
      var due=b.to===td;
      if(!b.keyOut)a.push({b:b,day:b.to,sev:'bad',title:who,text:'Gereserveerd tot '+dayLabel(b.to)+', maar nooit geactiveerd. Zet de reservering op "niet gekomen" of activeer hem alsnog.'});
      else{
        var open=afterOpen(b);
        if(open.length)a.push({b:b,day:b.to,sev:due?'warn':'bad',tag:'Vertrek',title:who,text:(due?'Vertrekt vandaag':'Vertrokken op '+dayLabel(b.to))+': '+open.join(' en ')+'.'});
      }
    }
  });
  deposits().forEach(function(d){
    if(d.back||!d.to||d.to>td)return;
    a.push({d:d,day:d.to,sev:d.to===td?'warn':'bad',title:'Kamerborg kamer '+(d.room||'?')+(d.name?' · '+d.name:''),text:(d.to===td?'Checkt vandaag uit':'Uitgecheckt op '+dayLabel(d.to))+': borg'+(d.amount?' van '+d.amount:'')+' nog niet terug.'});
  });
  return a.sort(function(x,y){return (x.sev==='bad'?0:1)-(y.sev==='bad'?0:1)||(x.day<y.day?-1:1)});
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
function saveBooking(docId,bid,fields){var b={};b[bid]=fields;return write('parklog/'+docId,{page:KEY,b:b})}
function saveDeposit(docId,did,fields){var d={};d[did]=fields;return write('parklog/'+docId,{page:KEY,d:d})}
function saveSpot(sid,fields){var o={};o[sid]=fields;return write('park/'+KEY,{page:KEY,spots:o})}
function seed(){
  if(S.seeding)return;S.seeding=true;
  var o={};SEED.forEach(function(x,i){o['s'+p2(i+1)]={nr:x[0],garage:x[1],ord:i+1}});
  S.db.doc('park/'+KEY).set({page:KEY,spots:o}).then(null,function(){S.seeding=false});
}
function needName(){
  if(me())return true;
  toast('Vul eerst je naam in.');var f=$('#naam');if(f){f.focus();f.scrollIntoView({block:'center'})}
  return false;
}

/* ---------- weergave ---------- */
function render(){
  var is=S.cfgLoaded&&S.logsLoaded?issues():[];
  $all('.tabs a').forEach(function(a){
    var v=a.getAttribute('href').slice(1);
    if(v===S.view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
    if(v==='controle')a.innerHTML='Controle'+(is.length?' <span class="tcount'+(is.some(function(i){return i.sev==='bad'})?' bad':'')+'">'+is.length+'</span>':'');
  });
  var v=$('#view');
  if(!S.cfgLoaded||!S.logsLoaded){v.innerHTML='<div class="empty"><h3>Parkeren laden…</h3><p>De plekken en verhuringen worden opgehaald.</p></div>';return}
  var act=document.activeElement,keep=act&&(act.id==='naam'||act.id==='zoek')?{id:act.id,v:act.value,a:act.selectionStart}:null;
  if(S.view==='kalender')renderCal(is);else if(S.view==='controle')renderCheck(is);else if(S.view==='kamerborg')renderDeposits();else renderSpots();
  if(keep){var f=$('#'+keep.id);if(f){f.value=keep.v;f.focus();try{f.setSelectionRange(keep.a,keep.a)}catch(e){}}}
}
function bookingSub(b,day){
  var a=[];
  if(!b.keyOut)a.push('gereserveerd');
  if(b.room)a.push('kamer '+b.room);
  if(b.keyOut)a.push(b.plate?plateFmt(b.plate):'geen kenteken');
  a.push(b.to===day?'vertrekt vandaag'+(b.t2?' vóór '+b.t2:''):'vertrek '+dayLabel(b.to)+(b.t2?' vóór '+b.t2:''));
  if(b.from===day&&b.t1)a.push('vanaf '+b.t1);
  if(b.keyOut&&b.dep)a.push(b.dep==='geen'?'geen borg':'borg '+DEP[b.dep].toLowerCase());
  return a.join(' · ');
}
/* rechts op de regel: de volgende stap als knop, anders de stand */
function stayAct(b){
  var td=today();
  if(!b.keyOut)return b.from<=td?'<button type="button" class="btn primary" data-act="'+esc(b.id)+'">Activeren</button>':'<span class="pill">Gereserveerd</span>';
  var m=missing(b);
  return m.length?'<span class="pill bad">'+m.length+' ontbreekt</span>':'<span class="pill good">Actief</span>';
}
function leaveAct(b){
  var td=today();
  if(b.to>td)return '<span class="pill">Vertrekt</span>';
  if(!b.keyOut)return '<span class="pill bad">Niet geactiveerd</span>';
  if(needsCheckout(b))return '<button type="button" class="btn primary" data-out="'+esc(b.id)+'">'+(b.keyBack?'Borg terug':'Afmelden')+'</button>';
  return '<span class="pill good">Afgehandeld</span>';
}
function line(b,day,tag,act){
  var late=!b.keyOut&&b.from<today()&&b.to>today();
  return '<div class="pline"><button type="button" class="pedit" data-bid="'+esc(b.id)+'"><span class="hmain">'+(tag||'')+'<b>'+esc(b.name||'Gast zonder naam')+'</b><span class="hsub">'+esc(bookingSub(b,day))+'</span>'
    +(late?'<span class="hbad">Niet geactiveerd sinds '+esc(dayLabel(b.from))+'</span>':'')+(b.keyOut&&b.to<today()&&afterOpen(b).length?'<span class="hbad">'+esc(cap(afterOpen(b).join(' en ')))+'</span>':'')+(b.mews?'':'<span class="hbad">Kosten nog niet in Mews</span>')+(b.note?'<span class="hsub">'+esc(b.note)+'</span>':'')+'</span></button><span class="pact">'+act+'</span></div>';
}
function renderCal(is){
  var mo=S.month,td=today(),bs=bookings(),n=daysIn(mo),first=wday(mo+'-01'),issueDays={};
  is.forEach(function(i){issueDays[i.day]=i.sev==='bad'||issueDays[i.day]==='bad'?'bad':'warn'});
  var h='<section class="stack">';
  if(is.length)h+='<a class="note '+(is.some(function(i){return i.sev==='bad'})?'bad':'warn')+' spread plink" href="#controle"><span><b>'+(is.some(function(i){return i.sev==='bad'})?is.length+' '+(is.length===1?'punt vraagt':'punten vragen')+' actie.':is.length+' '+(is.length===1?'ding':'dingen')+' te doen vandaag.')+'</b> '+esc(is[0].title)+(is.length>1?' en '+(is.length-1)+' meer':'')+'.</span><span class="btn">Bekijk</span></a>';
  h+='<div class="field"><label for="zoek" class="vh">Zoek op naam, kenteken of kamer</label><input class="input" id="zoek" type="search" autocomplete="off" placeholder="Zoek op naam, kenteken of kamer" value="'+esc(S.q)+'"></div>';
  if(S.q.trim()){h+=searchHtml(bs)+'</section>';$('#view').innerHTML=h;return}
  h+='<div class="daybar"><button class="iconbtn" id="mprev" aria-label="Vorige maand">‹</button><div class="dy"><b>'+esc(cap(monthLabel(mo)))+'</b><span class="muted">Tik op een dag om de plekken te zien</span></div><button class="iconbtn" id="mnext" aria-label="Volgende maand">›</button></div>';
  h+='<div class="cal" role="grid" aria-label="'+esc(monthLabel(mo))+'"><div class="calhead" role="row">'+['ma','di','wo','do','vr','za','zo'].map(function(d){return '<span role="columnheader">'+d+'</span>'}).join('')+'</div><div class="calgrid">';
  for(var i=1;i<first;i++)h+='<span class="cpad"></span>';
  for(var d=1;d<=n;d++){
    var day=mo+'-'+p2(d),st=dayState(day,bs),sellable=st.total-st.blocked,lvl=st.sold===0?0:(st.free===0?3:(st.sold/Math.max(1,sellable)>=0.6?2:1));
    h+='<button type="button" class="cday l'+lvl+(day===td?' today':'')+(day===S.day?' sel':'')+(day<td?' past':'')+'" data-day="'+day+'" aria-pressed="'+(day===S.day)+'" aria-label="'+esc(dayLabel(day))+': '+st.sold+' van '+st.total+' verhuurd'+(issueDays[day]?', punten om na te kijken':'')+'">'
      +'<span class="cnum2">'+d+'</span><span class="ccount">'+st.sold+'/'+st.total+'</span>'+(issueDays[day]?'<i class="cdot '+issueDays[day]+'" aria-hidden="true"></i>':'')+'</button>';
  }
  h+='</div></div><p class="muted callegend"><span><i class="lg l0"></i>leeg</span><span><i class="lg l1"></i>deels</span><span><i class="lg l2"></i>druk</span><span><i class="lg l3"></i>vol</span></p>';
  h+=dayHtml(S.day,bs)+'</section>';
  $('#view').innerHTML=h;
}
function dayHtml(day,bs){
  var st=dayState(day,bs),td=today(),todo=day<=td?st.rows.filter(function(r){return r.stay&&r.stay.kind==='gast'&&!r.stay.keyOut}).length:0;
  var h='<div class="stack" id="dag"><div class="spread"><div><h2>'+(day===td?'Vandaag · ':'')+esc(dayLabel(day))+'</h2><span class="muted"><b class="num" style="color:var(--ink)">'+st.sold+' van '+st.total+'</b> verhuurd · '+st.free+' vrij'+(st.blocked?' · '+st.blocked+' geblokkeerd':'')+(todo?' · <b style="color:var(--warn)">'+todo+' nog te activeren</b>':'')+(st.arrive||st.leave?' · '+st.arrive+' aankomst'+(st.arrive===1?'':'en')+', '+st.leave+' vertrek':'')+'</span></div>'
    +(day!==td?'<button class="btn" id="totoday">Naar vandaag</button>':'')+'</div>';
  h+='<div class="card"><div class="field"><label for="naam">Je naam</label><input class="input" id="naam" autocomplete="name" placeholder="Je naam" value="'+esc(ls('naam')||'')+'"><small>Je naam komt bij alles wat je invult of afhandelt.</small></div></div>';
  if(!st.rows.length)return h+'<div class="card empty"><h3>Nog geen parkeerplekken</h3><p>Voeg de plekken toe bij Plekken.</p></div></div>';
  h+='<ul class="rows pspots">';
  st.rows.forEach(function(r){
    var s=r.s;
    h+='<li class="pspot"><div class="pnr"><b>'+esc(s.nr)+'</b>'+(s.garage?'<span>'+esc(s.garage)+'</span>':'')+'</div><div class="pbody">';
    if(r.leave)h+=line(r.leave,day,'<span class="ptag">Vertrekt</span>',leaveAct(r.leave));
    if(r.stay&&r.stay.kind==='gast')h+=line(r.stay,day,r.stay.from===day?'<span class="ptag in">Aankomst</span>':'',stayAct(r.stay));
    else if(r.stay)h+='<div class="pline"><button type="button" class="pedit" data-bid="'+esc(r.stay.id)+'"><span class="hmain"><b class="muted">Geblokkeerd</b><span class="hsub">'+esc(r.stay.name||'Zonder reden')+' · t/m '+esc(dayLabel(addDays(r.stay.to,-1)))+'</span></span></button><span class="pact"><span class="pill">Niet verhuren</span></span></div>';
    else h+='<div class="pline free"><span class="hmain"><b class="'+(r.st==='vast'?'muted':'pvrij')+'">'+(r.st==='vast'?'Vast voor '+esc(s.hold):'Vrij')+'</b>'+(s.note?'<span class="hsub">'+esc(s.note)+'</span>':'')+'</span><button type="button" class="btn'+(r.st==='vast'?'':' primary')+'" data-newb="'+esc(s.id)+'">'+(r.st==='vast'?'Toch reserveren':'+ Reserveren')+'</button></div>';
    h+='</div></li>';
  });
  return h+'</ul></div>';
}
function searchHtml(bs){
  var q=S.q.trim().toLowerCase(),qp=q.replace(/[\s-]/g,''),td=today();
  var hits=bs.filter(function(b){return b.kind==='gast'&&(b.name.toLowerCase().indexOf(q)>=0||(qp&&plateFmt(b.plate).toLowerCase().replace(/-/g,'').indexOf(qp)>=0)||String(b.room).toLowerCase()===q)});
  hits.sort(function(a,b){var ca=a.to>=td?0:1,cb=b.to>=td?0:1;return ca-cb||(ca?(a.from<b.from?1:-1):(a.from<b.from?-1:1))});
  var h='<div class="stack"><h3>'+hits.length+' '+(hits.length===1?'verhuring':'verhuringen')+' gevonden</h3>';
  if(!hits.length)return h+'<div class="card"><p class="muted">Niets gevonden voor "'+esc(S.q.trim())+'".</p></div></div>';
  h+='<ul class="rows">'+hits.slice(0,25).map(function(b){
    var now=occupies(b,td);
    return '<li><button type="button" class="hrow" data-bid="'+esc(b.id)+'"><span class="htime num">'+esc(spotName(b.spot))+'</span><span class="hmain"><b>'+esc(b.name||'Gast zonder naam')+'</b><span class="hsub">'+esc(dayLabel(b.from))+' – '+esc(dayLabel(b.to))+(b.room?' · kamer '+esc(b.room):'')+(b.plate?' · '+esc(plateFmt(b.plate)):'')+'</span></span>'+(now?(b.keyOut?'<span class="pill good">Staat er nu</span>':'<span class="pill warn">Nog te activeren</span>'):b.from>td?'<span class="pill">Gereserveerd</span>':'<span class="pill">Geweest</span>')+'</button></li>';
  }).join('')+'</ul>';
  return h+'</div>';
}

/* --- verhuring of blokkade --- */
function chk(id,label,on,sub){return '<label class="dchk pchk"><input type="checkbox" id="'+id+'"'+(on?' checked':'')+'><span>'+label+(sub?'<small>'+esc(sub)+'</small>':'')+'</span></label>'}
function mewsBtn(id,m){
  return '<div class="field"><span class="flabel">Kosten in Mews</span><button type="button" class="btn mews" id="'+id+'" aria-pressed="'+(m?'true':'false')+'"><span class="mews-box" aria-hidden="true">✓</span><span><b>Kosten opgeboekt in Mews</b><small>'+(m?esc(stampText(m)):'Tik om te bevestigen dat de parkeerkosten op de kamer of reservering staan.')+'</small></span></button></div>';
}
function summary(b){return '<p class="note"><b>Plek '+esc(spotName(b.spot))+' · '+esc(b.name||'Gast zonder naam')+'</b><br>'+esc(dayLabel(b.from))+' tot '+esc(dayLabel(b.to))+' · '+nights(b.from,b.to)+' '+(nights(b.from,b.to)===1?'nacht':'nachten')+'</p>'}
/* stap 1: reserveren (of een bestaande reservering, verhuring of blokkade aanpassen) */
function openBooking(bid,sid,kind,day0){
  var b=bid?bookings().filter(function(x){return x.id===bid})[0]:null;if(bid&&!b)return;
  kind=b?b.kind:(kind||'gast');
  var act=!!(b&&b.keyOut),from=b?b.from:(day0||S.day),to=b?b.to:addDays(day0||S.day,1),ss=spots(true).filter(function(s){return !s.gone||(b&&b.spot===s.id)});
  var h='<h2>'+(b?(kind==='blok'?'Blokkade aanpassen':act?'Verhuring aanpassen':'Reservering aanpassen'):(kind==='blok'?'Plek blokkeren':'Plek reserveren'))+'</h2>';
  if(!b)h+='<div class="seg soft" role="group" aria-label="Soort" id="b-kind"><button type="button" data-kind="gast" aria-pressed="'+(kind==='gast')+'">Reserveren voor gast</button><button type="button" data-kind="blok" aria-pressed="'+(kind==='blok')+'">Blokkeren</button></div>';
  if(!b&&kind==='gast')h+='<p class="muted" style="margin-top:-6px;font-size:13.5px">Kenteken, borg en sleutel vul je pas in bij aankomst, met de knop Activeren.</p>';
  h+='<div class="grid2"><div class="field"><label for="b-spot">Plek</label><select class="input" id="b-spot">'+ss.map(function(s){return '<option value="'+esc(s.id)+'"'+(s.id===(b?b.spot:sid)?' selected':'')+'>'+esc(s.nr+(s.garage?' '+s.garage:''))+'</option>'}).join('')+'</select></div>'
    +'<div class="field"><label for="b-name">'+(kind==='blok'?'Reden':'Naam gast')+'</label><input class="input" id="b-name" autocomplete="off" maxlength="80" placeholder="'+(kind==='blok'?'bv. niet verkopen, onderhoud':'')+'" value="'+esc(b?b.name:'')+'"></div></div>';
  h+='<div class="grid2"><div class="field"><label for="b-from">'+(kind==='blok'?'Vanaf':'Aankomst')+'</label><input class="input" id="b-from" type="date" value="'+esc(from)+'"></div>'
    +'<div class="field"><label for="b-to">'+(kind==='blok'?'Tot en met':'Vertrek')+'</label><input class="input" id="b-to" type="date" value="'+esc(kind==='blok'?addDays(to,-1):to)+'">'+(kind==='blok'?'':'<small id="b-nights"></small>')+'</div></div>';
  if(kind==='gast'){
    h+='<div class="grid2"><div class="field"><label for="b-room">Kamernummer'+(act?'':' (als het al bekend is)')+'</label><input class="input" id="b-room" autocomplete="off" maxlength="20" inputmode="numeric" value="'+esc(b?b.room:'')+'"></div>'
      +'<div class="field"><label>Tijden (optioneel)</label><div class="rowflex" style="flex-wrap:nowrap"><input class="input" id="b-t1" type="time" aria-label="Aankomst vanaf" value="'+esc(b?b.t1:'')+'"><input class="input" id="b-t2" type="time" aria-label="Vertrek uiterlijk" value="'+esc(b?b.t2:'')+'"></div><small>Aankomst vanaf · vertrek uiterlijk</small></div></div>';
    h+=mewsBtn('b-mews',b&&b.mews);
    if(act){
      h+='<div class="grid2"><div class="field"><label for="b-plate">Kenteken</label><input class="input" id="b-plate" autocomplete="off" autocapitalize="characters" maxlength="20" value="'+esc(plateFmt(b.plate))+'"></div>'
        +'<div class="field"><label for="b-dep">Borg</label><select class="input" id="b-dep"><option value="">Nog niet ingevuld</option>'+Object.keys(DEP).map(function(k){return '<option value="'+k+'"'+(b.dep===k?' selected':'')+'>'+DEP[k]+'</option>'}).join('')+'</select></div></div>';
      h+='<div class="stack pchecks">'+chk('b-out','Geactiveerd: sleutel uitgegeven',true,stampText(b.keyOut))+chk('b-back','Parkeersleutel terug',b.keyBack,stampText(b.keyBack))+chk('b-depback',depBackLabel(b.dep),b.depBack,stampText(b.depBack))+'</div>';
    }else if(b)h+='<div class="stack pchecks">'+chk('b-noshow','Niet gekomen (plek komt vrij)',b.noshow,stampText(b.noshow))+'</div>'
      +(b.from<=today()&&!b.noshow?'<div class="note spread"><span>Is de gast er? Dan activeer je de plek met kenteken, borg en sleutel.</span><button type="button" class="btn" data-act="'+esc(b.id)+'">Activeren</button></div>':'');
  }
  h+='<div class="field"><label for="b-note">Opmerking</label><input class="input" id="b-note" autocomplete="off" maxlength="200" placeholder="'+(kind==='gast'?'bv. VIP, als laatste verkopen':'')+'" value="'+esc(b?b.note:'')+'"></div>';
  h+='<p class="gate-msg" id="b-msg" role="alert" style="min-height:0"></p><div class="spread" id="b-btns">'+(b?'<button class="btn danger" id="b-del">Verwijderen</button>':'<span></span>')+'<span class="rowflex"><button class="btn ghost" data-close>Annuleren</button><button class="btn primary" id="b-save">'+(b?'Opslaan':(kind==='blok'?'Blokkeren':'Reserveren'))+'</button></span></div>';
  openModal(h);
  var sheet=$('#modal .sheet');sheet.setAttribute('data-bid',bid||'');sheet.setAttribute('data-kind',kind);sheet.setAttribute('data-sid',sid||'');
  syncNights();
  if(!b)setTimeout(function(){var f=$('#b-name');if(f)f.focus()},50);
}
function syncNights(){
  var el=$('#b-nights');if(!el)return;
  var a=$('#b-from').value,b=$('#b-to').value;
  el.textContent=isDate(a)&&isDate(b)&&b>a?nights(a,b)+' '+(nights(a,b)===1?'nacht':'nachten')+'; de plek is weer vrij op '+dayLabel(b)+'.':'';
}
function doSaveBooking(){
  var sheet=$('#modal .sheet'),bid=sheet.getAttribute('data-bid'),kind=sheet.getAttribute('data-kind'),msg=$('#b-msg'),all=bookings(),old=bid?all.filter(function(x){return x.id===bid})[0]:null;
  msg.textContent='';
  if(!me()){closeModal();needName();return}
  var spot=$('#b-spot').value,name=$('#b-name').value.trim().replace(/\s+/g,' '),from=$('#b-from').value,to=$('#b-to').value;
  if(!name){msg.textContent=kind==='blok'?'Vul een reden in.':'Vul de naam van de gast in.';$('#b-name').focus();return}
  if(!isDate(from)||!isDate(to)){msg.textContent='Vul beide datums in.';return}
  if(kind==='blok')to=addDays(to,1);
  if(to<=from){msg.textContent=kind==='blok'?'De einddatum ligt vóór de begindatum.':'Het vertrek moet na de aankomst liggen.';$('#b-to').focus();return}
  if(nights(from,to)>365){msg.textContent='Dat is langer dan een jaar. Controleer de datums.';return}
  var f={kind:kind,spot:spot,name:name,from:from,to:to,note:$('#b-note').value.trim()};
  if(kind==='gast'){
    f.room=$('#b-room').value.trim();f.t1=$('#b-t1').value||'';f.t2=$('#b-t2').value||'';
    if($('#b-plate')){f.plate=plateFmt($('#b-plate').value);f.dep=$('#b-dep').value||null}
    [['b-out','keyOut'],['b-back','keyBack'],['b-depback','depBack'],['b-noshow','noshow']].forEach(function(x){
      var c=$('#'+x[0]);if(!c)return;
      f[x[1]]=c.checked?((old&&old[x[1]])||stamp()):null;
    });
    f.mews=$('#b-mews').getAttribute('aria-pressed')==='true'?((old&&old.mews)||stamp()):null;
    if($('#b-out')&&!f.keyOut&&(f.keyBack||f.depBack)){msg.textContent='Een plek die niet geactiveerd is, kan geen sleutel of borg terug hebben. Haal die vinkjes weg of laat de activering staan.';return}
  }
  if(!(kind==='gast'&&f.noshow)){
    var clash=all.filter(function(o){return o.id!==bid&&o.spot===spot&&!o.noshow&&o.from<to&&from<o.to})[0];
    if(clash){msg.textContent='Plek '+spotName(spot)+' is in die periode al '+(clash.kind==='blok'?'geblokkeerd ('+clash.name+')':'gereserveerd voor '+(clash.name||'een gast'))+', van '+dayLabel(clash.from)+' tot '+dayLabel(clash.to)+'. Kies een andere plek of andere datums.';return}
  }
  if(kind==='gast'&&!f.mews&&!f.noshow&&!sheet.hasAttribute('data-warned')){
    sheet.setAttribute('data-warned','');
    msg.textContent='De kosten zijn nog niet bevestigd in Mews. Bevestig ze met de knop hierboven, of tik nogmaals op '+$('#b-save').textContent+' om het later te doen; de reservering blijft dan in de controle staan.';
    $('#b-mews').focus();return;
  }
  var id=bid||uid('b'),doc=KEY+'_'+from.slice(0,7),b=$('#b-save'),lab=b.textContent;b.disabled=true;b.textContent='Opslaan…';
  if(!old){f.by=me();f.at=new Date().toISOString()}else f.editBy=me();
  var done=function(){closeModal();toast(kind==='blok'?'Blokkade opgeslagen.':old?'Opgeslagen.':'Plek gereserveerd.')},fail=function(){b.disabled=false;b.textContent=lab;msg.textContent='Opslaan lukt niet. Controleer je internetverbinding.'};
  /* verschuift de aankomst naar een andere maand, dan verhuist de verhuring mee naar het document van die maand */
  if(old&&old.doc!==doc){
    var full={};Object.keys(old).forEach(function(k){if(k!=='id'&&k!=='doc')full[k]=old[k]});Object.keys(f).forEach(function(k){full[k]=f[k]});
    saveBooking(doc,id,full).then(function(){return saveBooking(old.doc,id,{gone:true})}).then(done,fail);
  }else saveBooking(doc,id,f).then(done,fail);
}
/* stap 2, bij aankomst: de gereserveerde plek activeren */
function openActivate(bid){
  var b=bookings().filter(function(x){return x.id===bid})[0];if(!b)return;
  if(!needName())return;
  var h='<h2>Plek activeren</h2>'+summary(b)
    +'<div class="grid2"><div class="field"><label for="a-room">Kamernummer</label><input class="input" id="a-room" autocomplete="off" maxlength="20" inputmode="numeric" value="'+esc(b.room)+'"></div>'
    +'<div class="field"><label for="a-plate">Kenteken</label><input class="input" id="a-plate" autocomplete="off" autocapitalize="characters" maxlength="20" placeholder="bv. AB-123-C" value="'+esc(plateFmt(b.plate))+'"><label class="dchk" style="min-height:0;font-size:13px;font-weight:500"><input type="checkbox" id="a-noplate"><span>Kenteken onbekend</span></label></div></div>'
    +'<div class="field"><span class="flabel" id="a-dep-l">Borg</span><div class="seg soft" role="group" aria-labelledby="a-dep-l" id="a-dep">'+Object.keys(DEP).map(function(k){return '<button type="button" data-dep="'+k+'" aria-pressed="'+(b.dep===k)+'">'+DEP[k]+'</button>'}).join('')+'</div></div>'
    +(b.mews?'':mewsBtn('a-mews',null))
    +'<p class="note">Met Activeren leg je vast dat de sleutel nu is uitgegeven.</p>'
    +'<p class="gate-msg" id="a-msg" role="alert" style="min-height:0"></p><div class="spread"><button class="btn ghost" data-bid="'+esc(b.id)+'">Reservering aanpassen</button><span class="rowflex"><button class="btn ghost" data-close>Annuleren</button><button class="btn primary" id="a-save">Activeren</button></span></div>';
  openModal(h);$('#modal .sheet').setAttribute('data-bid',bid);
  setTimeout(function(){var f=$(b.room?'#a-plate':'#a-room');if(f)f.focus()},50);
}
function doActivate(){
  var bid=$('#modal .sheet').getAttribute('data-bid'),b=bookings().filter(function(x){return x.id===bid})[0],msg=$('#a-msg');if(!b)return;
  var room=$('#a-room').value.trim(),plate=$('#a-noplate').checked?'ONBEKEND':plateFmt($('#a-plate').value),depBtn=$('#a-dep [aria-pressed="true"]');
  if(!room){msg.textContent='Vul het kamernummer in.';$('#a-room').focus();return}
  if(!plate){msg.textContent='Vul het kenteken in, of vink aan dat het onbekend is.';$('#a-plate').focus();return}
  if(!depBtn){msg.textContent='Kies hoe de borg is betaald, of kies Geen borg.';return}
  var btn=$('#a-save');btn.disabled=true;btn.textContent='Activeren…';
  var fa={room:room,plate:plate,dep:depBtn.getAttribute('data-dep'),keyOut:stamp(),noshow:null},mb=$('#a-mews');
  if(mb&&mb.getAttribute('aria-pressed')==='true')fa.mews=stamp();
  saveBooking(b.doc,b.id,fa).then(function(){closeModal();toast('Plek '+spotName(b.spot)+' is geactiveerd.')},function(){btn.disabled=false;btn.textContent='Activeren';msg.textContent='Opslaan lukt niet. Controleer je internetverbinding.'});
}
/* stap 3, bij vertrek: afmelden */
function openCheckout(bid){
  var b=bookings().filter(function(x){return x.id===bid})[0];if(!b)return;
  if(!needName())return;
  var dep=b.dep==='cash'||b.dep==='cc';
  var h='<h2>Plek afmelden</h2>'+summary(b)+'<p class="muted" style="margin-top:-6px">Kamer '+esc(b.room||'?')+' · '+esc(plateFmt(b.plate)||'geen kenteken')+' · '+esc(b.dep==='geen'?'geen borg':b.dep?'borg '+DEP[b.dep].toLowerCase():'borg niet ingevuld')+'</p>'
    +'<div class="stack pchecks">'+chk('o-back','Parkeersleutel terug',true,stampText(b.keyBack))+(dep?chk('o-depback',depBackLabel(b.dep),true,stampText(b.depBack)):'')+'</div>'
    +'<p class="muted" style="font-size:13.5px">Haal een vinkje weg als dat nog niet is gebeurd; de plek blijft dan in de controle staan.</p>'
    +'<p class="gate-msg" id="o-msg" role="alert" style="min-height:0"></p><div class="spread"><button class="btn ghost" data-bid="'+esc(b.id)+'">Gegevens aanpassen</button><span class="rowflex"><button class="btn ghost" data-close>Annuleren</button><button class="btn primary" id="o-save">Afmelden</button></span></div>';
  openModal(h);$('#modal .sheet').setAttribute('data-bid',bid);
}
function doCheckout(){
  var bid=$('#modal .sheet').getAttribute('data-bid'),b=bookings().filter(function(x){return x.id===bid})[0];if(!b)return;
  var f={keyBack:$('#o-back').checked?(b.keyBack||stamp()):null},c=$('#o-depback');
  if(c)f.depBack=c.checked?(b.depBack||stamp()):null;
  var btn=$('#o-save');btn.disabled=true;btn.textContent='Afmelden…';
  saveBooking(b.doc,b.id,f).then(function(){closeModal();toast(f.keyBack&&(!c||f.depBack)?'Plek '+spotName(b.spot)+' is afgemeld.':'Opgeslagen. '+cap(afterOpen({keyBack:f.keyBack,dep:b.dep,depBack:c?f.depBack:b.depBack}).join(' en '))+'.')},function(){btn.disabled=false;btn.textContent='Afmelden';$('#o-msg').textContent='Opslaan lukt niet. Controleer je internetverbinding.'});
}
/* vanuit de controle: open meteen de stap die nodig is */
function openFor(bid){
  var b=bookings().filter(function(x){return x.id===bid})[0];if(!b)return;
  if(b.kind==='gast'&&!b.noshow&&!b.keyOut&&b.from<=today()&&today()<b.to)openActivate(bid);
  else if(b.kind==='gast'&&needsCheckout(b))openCheckout(bid);
  else openBooking(bid);
}
function askDeleteBooking(){
  $('#b-btns').outerHTML='<div class="note bad" id="b-btns"><p style="margin-bottom:10px"><b>Verwijderen?</b> De plek komt vrij voor deze periode. Is de gast niet komen opdagen, gebruik dan liever "Niet gekomen".</p><div class="rowflex"><button class="btn" data-close>Nee, laat staan</button><button class="btn danger" id="b-del2">Ja, verwijderen</button></div></div>';
}
function doDeleteBooking(){
  var b=bookings().filter(function(x){return x.id===$('#modal .sheet').getAttribute('data-bid')})[0],btn=$('#b-del2');if(!b)return;btn.disabled=true;
  saveBooking(b.doc,b.id,{gone:true,goneBy:me(),goneAt:new Date().toISOString()}).then(function(){closeModal();toast('Verwijderd.')},function(){btn.disabled=false;toast('Verwijderen lukt niet. Controleer je internetverbinding.')});
}

/* --- controle --- */
function renderCheck(is){
  var td=today(),st=dayState(td),now0=st.rows.filter(function(r){return r.stay&&r.stay.kind==='gast'&&r.stay.keyOut}).length;
  var h='<section class="stack"><div><h2>Controle</h2><span class="muted">'+esc(dayLabel(td))+' · '+st.sold+' van '+st.total+' plekken verhuurd, '+now0+' geactiveerd</span></div>';
  if(!is.length)h+='<div class="note good">Alles is geactiveerd en afgemeld. Er staat niemand zonder registratie, alle parkeersleutels zijn terug en alle borgen zijn terugbetaald of teruggestort.</div>';
  else{
    h+='<ul class="rows">'+is.map(function(i){
      return '<li><button type="button" class="hrow'+(i.sev==='bad'?' bad':'')+'" '+(i.b?'data-go="'+esc(i.b.id)+'"':'data-did="'+esc(i.d.id)+'"')+'><span class="hmain"><b>'+esc(i.title)+'</b><span class="'+(i.sev==='bad'?'hbad':'hsub')+'">'+esc(i.text)+'</span></span><span class="pill '+i.sev+'">'+(i.sev==='bad'?'Actie nodig':(i.tag||'Vandaag'))+'</span></button></li>';
    }).join('')+'</ul><p class="muted" style="font-size:13px">Tik op een regel om te activeren, af te melden of aan te vullen. Rood is te laat, geel hoort bij vandaag of bij een reservering die nog in Mews moet. Na het verblijf blijft een gast hier staan tot de parkeersleutel terug is en de borg is terugbetaald of teruggestort.</p>';
  }
  h+='<div class="stack"><h3>Wie staat er nu</h3>';
  var now=st.rows.filter(function(r){return r.stay&&r.stay.kind==='gast'&&r.stay.keyOut}),wait=st.rows.filter(function(r){return r.stay&&r.stay.kind==='gast'&&!r.stay.keyOut}).length;
  h+=now.length?'<div class="gridwrap"><table class="plist"><thead><tr><th>Plek</th><th>Gast</th><th>Kamer</th><th>Kenteken</th><th>Vertrek</th><th>Borg</th></tr></thead><tbody>'+now.map(function(r){var b=r.stay;
    return '<tr><td class="num"><b>'+esc(r.s.nr)+'</b></td><td>'+esc(b.name)+'</td><td class="num">'+(b.room?esc(b.room):'<span class="miss">?</span>')+'</td><td class="num">'+(b.plate?esc(plateFmt(b.plate)):'<span class="miss">?</span>')+'</td><td>'+esc(dayLabel(b.to))+'</td><td>'+(b.dep?esc(DEP[b.dep]):'<span class="miss">?</span>')+'</td></tr>'}).join('')+'</tbody></table></div>'
    :'<div class="card"><p class="muted">Er is nu geen plek geactiveerd.</p></div>';
  if(wait)h+='<p class="muted" style="font-size:13px">'+wait+' gereserveerde '+(wait===1?'plek is':'plekken zijn')+' nog niet geactiveerd en '+(wait===1?'staat':'staan')+' daarom niet in deze lijst.</p>';
  h+='</div>';
  /* na het verblijf: vertrekken van de laatste 14 dagen, plus alles van eerder dat nog openstaat */
  var lim=addDays(td,-14),gone=bookings().filter(function(b){return b.kind==='gast'&&!b.noshow&&b.keyOut&&b.to<=td&&(b.to>=lim||afterOpen(b).length)})
    .sort(function(x,y){var ox=afterOpen(x).length?0:1,oy=afterOpen(y).length?0:1;return ox-oy||(x.to<y.to?1:-1)});
  h+='<div class="stack"><div class="spread"><h3>Na het verblijf</h3><span class="muted" style="font-size:13px">sleutel terug en borg terug, per vertrokken gast</span></div>';
  h+=gone.length?'<ul class="rows">'+gone.map(function(b){
    var dep=b.dep==='cash'||b.dep==='cc',open=afterOpen(b).length;
    return '<li><button type="button" class="hrow'+(open&&b.to<td?' bad':'')+'" data-go="'+esc(b.id)+'"><span class="htime num">'+esc(spotName(b.spot))+'</span><span class="hmain"><b>'+esc(b.name||'Gast zonder naam')+'</b><span class="hsub">vertrek '+esc(dayLabel(b.to))+(b.room?' · kamer '+esc(b.room):'')+(b.plate?' · '+esc(plateFmt(b.plate)):'')+'</span>'
      +'<span class="pchips"><span class="pill '+(b.keyBack?'good':'bad')+'">'+(b.keyBack?'✓ Sleutel terug':'✗ Sleutel niet terug')+'</span>'
      +(dep?'<span class="pill '+(b.depBack?'good':'bad')+'">'+(b.depBack?'✓ Borg terug':'✗ Borg niet terug')+' ('+DEP[b.dep].toLowerCase()+')</span>':'<span class="pill">'+(b.dep==='geen'?'Geen borg':'Borg onbekend')+'</span>')+'</span></span></button></li>';
  }).join('')+'</ul>':'<div class="card"><p class="muted">Nog geen vertrokken gasten in de laatste 14 dagen.</p></div>';
  h+='</div><div class="rowflex"><button class="btn" id="csv">Download '+esc(monthLabel(td.slice(0,7)))+' (CSV)</button><span class="muted" style="font-size:13px">Alle verhuringen die deze maand lopen of liepen.</span></div></section>';
  $('#view').innerHTML=h;
}
function buildCsv(mo){
  var a=mo+'-01',z=addDays(mo+'-'+p2(daysIn(mo)),1),L=[['Plek','Soort','Naam of reden','Kamer','Kenteken','Aankomst','Vertrek','Nachten','Borg','Kosten in Mews','Geactiveerd (sleutel uit)','Parkeersleutel terug','Borg terugbetaald of teruggestort','Niet gekomen','Opmerking','Ingevoerd door']];
  function q(v){v=String(v==null?'':v);return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
  bookings().filter(function(b){return b.from<z&&a<b.to}).forEach(function(b){
    L.push([spotName(b.spot),b.kind==='blok'?'Blokkade':(b.keyOut?'Verhuring':'Reservering'),b.name,b.room,plateFmt(b.plate),b.from,b.to,nights(b.from,b.to),b.dep?DEP[b.dep]:'',b.kind==='gast'?(stampText(b.mews)||'nee'):'',stampText(b.keyOut),stampText(b.keyBack),stampText(b.depBack),b.noshow?'ja':'',b.note,b.by]);
  });
  return '﻿'+L.map(function(r){return r.map(q).join(';')}).join('\r\n');
}

/* --- kamerborg --- */
function renderDeposits(){
  var ds=deposits(),open=ds.filter(function(d){return !d.back}),done=ds.filter(function(d){return d.back}).sort(function(a,b){return a.back.at<b.back.at?1:-1}).slice(0,30),td=today();
  var h='<section class="stack"><div class="spread"><div><h2>Kamerborg</h2><span class="muted">'+open.length+' open</span></div><button class="btn primary" id="d-add">Borg toevoegen</button></div>';
  h+=open.length?'<ul class="rows">'+open.map(function(d){
    var late=d.to&&d.to<td,due=d.to===td;
    return '<li><button type="button" class="hrow'+(late?' bad':'')+'" data-did="'+esc(d.id)+'"><span class="htime num">K '+esc(d.room||'?')+'</span><span class="hmain"><b>'+esc(d.name||'Zonder naam')+'</b><span class="hsub">'+esc([d.amount,d.how?DEP[d.how].toLowerCase():'',d.to?'check-out '+dayLabel(d.to):''].filter(Boolean).join(' · '))+'</span>'+(d.note?'<span class="hsub">'+esc(d.note)+'</span>':'')+'</span><span class="pill '+(late?'bad':due?'warn':'')+'">'+(late?'Te laat':due?'Vandaag':'Open')+'</span></button></li>';
  }).join('')+'</ul>':'<div class="card"><p class="muted">Er staat geen kamerborg open.</p></div>';
  if(done.length)h+='<div class="stack"><h3>Teruggegeven</h3><ul class="rows">'+done.map(function(d){
    return '<li><button type="button" class="hrow" data-did="'+esc(d.id)+'"><span class="htime num">K '+esc(d.room||'?')+'</span><span class="hmain"><b>'+esc(d.name||'Zonder naam')+'</b><span class="hsub">'+esc([d.amount,d.how?DEP[d.how].toLowerCase():''].filter(Boolean).join(' · '))+' · terug: '+esc(stampText(d.back))+'</span></span><span class="pill good">Terug</span></button></li>';
  }).join('')+'</ul></div>';
  h+='</section>';
  $('#view').innerHTML=h;
}
function openDeposit(did){
  var d=did?deposits().filter(function(x){return x.id===did})[0]:null;if(did&&!d)return;
  var h='<h2>'+(d?'Kamerborg aanpassen':'Kamerborg toevoegen')+'</h2>'
    +'<div class="grid2"><div class="field"><label for="d-room">Kamernummer</label><input class="input" id="d-room" autocomplete="off" maxlength="20" inputmode="numeric" value="'+esc(d?d.room:'')+'"></div>'
    +'<div class="field"><label for="d-name">Naam gast</label><input class="input" id="d-name" autocomplete="off" maxlength="80" value="'+esc(d?d.name:'')+'"></div></div>'
    +'<div class="grid2"><div class="field"><label for="d-amount">Bedrag</label><input class="input" id="d-amount" autocomplete="off" maxlength="20" placeholder="bv. € 100" value="'+esc(d?d.amount:'')+'"></div>'
    +'<div class="field"><label for="d-how">Hoe betaald</label><select class="input" id="d-how"><option value="cash"'+(d&&d.how==='cash'?' selected':'')+'>Contant</option><option value="cc"'+(d&&d.how==='cc'?' selected':'')+'>Creditcard</option></select></div></div>'
    +'<div class="field"><label for="d-to">Check-out</label><input class="input" id="d-to" type="date" value="'+esc(d?d.to:addDays(today(),1))+'"></div>'
    +'<div class="pchecks">'+chk('d-back','Borg teruggegeven of geannuleerd',d&&d.back,d&&stampText(d.back))+'</div>'
    +'<div class="field"><label for="d-note">Opmerking</label><input class="input" id="d-note" autocomplete="off" maxlength="200" value="'+esc(d?d.note:'')+'"></div>'
    +'<p class="gate-msg" id="d-msg" role="alert" style="min-height:0"></p><div class="spread" id="d-btns">'+(d?'<button class="btn danger" id="d-del">Verwijderen</button>':'<span></span>')+'<span class="rowflex"><button class="btn ghost" data-close>Annuleren</button><button class="btn primary" id="d-save">Opslaan</button></span></div>';
  openModal(h);$('#modal .sheet').setAttribute('data-did',did||'');
  if(!d)setTimeout(function(){var f=$('#d-room');if(f)f.focus()},50);
}
function doSaveDeposit(){
  var did=$('#modal .sheet').getAttribute('data-did'),msg=$('#d-msg'),old=did?deposits().filter(function(x){return x.id===did})[0]:null;
  if(!me()){closeModal();toast('Vul eerst je naam in bij Kalender.');return}
  var room=$('#d-room').value.trim(),to=$('#d-to').value;
  if(!room){msg.textContent='Vul het kamernummer in.';$('#d-room').focus();return}
  if(!isDate(to)){msg.textContent='Vul de datum van check-out in.';$('#d-to').focus();return}
  var f={room:room,name:$('#d-name').value.trim(),amount:$('#d-amount').value.trim(),how:$('#d-how').value,to:to,note:$('#d-note').value.trim(),back:$('#d-back').checked?((old&&old.back)||stamp()):null};
  if(!old){f.by=me();f.at=new Date().toISOString()}
  var b=$('#d-save');b.disabled=true;b.textContent='Opslaan…';
  saveDeposit(old?old.doc:KEY+'_kb-'+to.slice(0,4),did||uid('d'),f).then(function(){closeModal();toast('Kamerborg opgeslagen.')},function(){b.disabled=false;b.textContent='Opslaan';msg.textContent='Opslaan lukt niet. Controleer je internetverbinding.'});
}
function doDeleteDeposit(){
  var d=deposits().filter(function(x){return x.id===$('#modal .sheet').getAttribute('data-did')})[0];if(!d)return;
  var btn=$('#d-del');
  if(!btn.hasAttribute('data-sure')){btn.setAttribute('data-sure','');btn.textContent='Zeker weten? Tik nogmaals';return}
  btn.disabled=true;
  saveDeposit(d.doc,d.id,{gone:true,goneBy:me()}).then(function(){closeModal();toast('Verwijderd.')},function(){btn.disabled=false;toast('Verwijderen lukt niet.')});
}

/* --- plekken beheren --- */
function renderSpots(){
  var ss=spots();
  var h='<section class="stack"><div class="spread"><div><h2>Plekken</h2><span class="muted">'+ss.length+' '+(ss.length===1?'parkeerplek':'parkeerplekken')+'</span></div><button class="btn primary" id="s-add">Plek toevoegen</button></div>';
  if(!ss.length)h+='<div class="card empty"><h3>Nog geen plekken</h3><p>Voeg de parkeerplekken toe die jullie verhuren.</p></div>';
  else{
    h+='<ul class="rows">'+ss.map(function(s,i){
      return '<li class="prow"><button type="button" class="pmain" data-sid="'+esc(s.id)+'"><b>'+esc(s.nr)+(s.garage?' <span class="muted" style="font-weight:500">'+esc(s.garage)+'</span>':'')+'</b><span class="muted" style="font-size:13px">'+esc(s.hold?'Vast voor '+s.hold:'Te verhuren')+(s.note?' · '+esc(s.note):'')+'</span></button>'
        +'<button type="button" class="mv" data-move="-1" data-id="'+esc(s.id)+'" aria-label="Plek '+esc(s.nr)+' omhoog"'+(i===0?' disabled':'')+'>▲</button><button type="button" class="mv" data-move="1" data-id="'+esc(s.id)+'" aria-label="Plek '+esc(s.nr)+' omlaag"'+(i===ss.length-1?' disabled':'')+'>▼</button></li>';
    }).join('')+'</ul><p class="muted" style="font-size:13px">Een plek die "vast voor" iemand is, telt als geblokkeerd tot je hem voor een periode toch verhuurt.</p>';
  }
  $('#view').innerHTML=h+'</section>';
}
function openSpot(sid){
  var s=sid?spots().filter(function(x){return x.id===sid})[0]:null;if(sid&&!s)return;
  var h='<h2>'+(s?'Plek aanpassen':'Plek toevoegen')+'</h2><div class="grid2"><div class="field"><label for="s-nr">Nummer</label><input class="input" id="s-nr" autocomplete="off" maxlength="12" value="'+esc(s?s.nr:'')+'" placeholder="bv. 260"></div>'
    +'<div class="field"><label for="s-garage">Garage of locatie (optioneel)</label><input class="input" id="s-garage" autocomplete="off" maxlength="20" value="'+esc(s?s.garage:'')+'" placeholder="bv. J"></div></div>'
    +'<div class="field"><label for="s-hold">Vast voor (optioneel)</label><input class="input" id="s-hold" autocomplete="off" maxlength="40" value="'+esc(s?s.hold:'')+'" placeholder="bv. directie"><small>Laat leeg als de plek gewoon te verhuren is.</small></div>'
    +'<div class="field"><label for="s-note">Opmerking (optioneel)</label><input class="input" id="s-note" autocomplete="off" maxlength="80" value="'+esc(s?s.note:'')+'" placeholder="bv. als laatste verkopen, geen sleutel"></div>'
    +'<p class="gate-msg" id="s-msg" role="alert" style="min-height:0"></p><div class="spread" id="s-btns">'+(s?'<button class="btn danger" id="s-del">Verwijderen</button>':'<span></span>')+'<span class="rowflex"><button class="btn ghost" data-close>Annuleren</button><button class="btn primary" id="s-save">Opslaan</button></span></div>';
  openModal(h);$('#modal .sheet').setAttribute('data-sid',sid||'');
  if(!s)setTimeout(function(){var f=$('#s-nr');if(f)f.focus()},50);
}
function doSaveSpot(){
  var sid=$('#modal .sheet').getAttribute('data-sid'),msg=$('#s-msg'),nr=$('#s-nr').value.trim();
  if(!nr){msg.textContent='Vul het nummer van de plek in.';$('#s-nr').focus();return}
  if(spots().some(function(s){return s.id!==sid&&s.nr===nr})){msg.textContent='Plek '+nr+' bestaat al.';$('#s-nr').focus();return}
  var f={nr:nr,garage:$('#s-garage').value.trim(),hold:$('#s-hold').value.trim(),note:$('#s-note').value.trim()};
  if(!sid){sid=uid('s');f.ord=spots(true).reduce(function(a,s){return Math.max(a,s.ord<999?s.ord:0)},0)+1}
  var b=$('#s-save');b.disabled=true;b.textContent='Opslaan…';
  saveSpot(sid,f).then(function(){closeModal();toast('Plek opgeslagen.')},function(){b.disabled=false;b.textContent='Opslaan';msg.textContent='Opslaan lukt niet. Controleer je internetverbinding.'});
}
function doDeleteSpot(){
  var sid=$('#modal .sheet').getAttribute('data-sid'),btn=$('#s-del'),td=today();
  if(bookings().some(function(b){return b.spot===sid&&!b.noshow&&b.to>td})){$('#s-msg').textContent='Op deze plek staan nog lopende of toekomstige verhuringen. Verplaats of verwijder die eerst.';return}
  if(!btn.hasAttribute('data-sure')){btn.setAttribute('data-sure','');btn.textContent='Zeker weten? Tik nogmaals';return}
  btn.disabled=true;
  saveSpot(sid,{gone:td}).then(function(){closeModal();toast('Plek verwijderd.')},function(){btn.disabled=false;toast('Verwijderen lukt niet.')});
}
function moveSpot(id,dir){
  var ss=spots(),i=ss.map(function(s){return s.id}).indexOf(id),j=i+dir;
  if(i<0||j<0||j>=ss.length)return;
  var t=ss[i];ss[i]=ss[j];ss[j]=t;
  var o={};ss.forEach(function(s,k){if(s.ord!==k+1)o[s.id]={ord:k+1}});
  write('park/'+KEY,{page:KEY,spots:o}).then(null,function(){toast('Volgorde opslaan lukt niet.')});
}

/* ---------- bediening ---------- */
var VIEWS=['kalender','controle','kamerborg','plekken'];
function setView(v){if(VIEWS.indexOf(v)<0)v='kalender';S.view=v;render();window.scrollTo(0,0)}
function setDay(day,scroll){S.day=day;S.month=day.slice(0,7);render();if(scroll){var d=$('#dag');if(d)d.scrollIntoView({behavior:'smooth',block:'start'})}}
document.addEventListener('click',function(ev){
  var el=ev.target.closest('a[href^="#"]');
  if(el){ev.preventDefault();var v=el.getAttribute('href').slice(1);try{history.replaceState(null,'',location.pathname+location.search+'#'+v)}catch(e){}setView(v);return}
  el=ev.target.closest('button');if(!el)return;
  if(el.hasAttribute('data-close')){closeModal();return}
  if(el.id==='mprev'){S.month=addMonths(S.month,-1);render();return}
  if(el.id==='mnext'){S.month=addMonths(S.month,1);render();return}
  if(el.id==='totoday'){setDay(today());return}
  if(el.hasAttribute('data-day')){setDay(el.getAttribute('data-day'),true);return}
  if(el.hasAttribute('data-newb')){if(needName())openBooking(null,el.getAttribute('data-newb'),'gast');return}
  if(el.hasAttribute('data-act')){openActivate(el.getAttribute('data-act'));return}
  if(el.hasAttribute('data-out')){openCheckout(el.getAttribute('data-out'));return}
  if(el.hasAttribute('data-go')){openFor(el.getAttribute('data-go'));return}
  if(el.id==='a-save'){doActivate();return}
  if(el.id==='o-save'){doCheckout();return}
  if(el.classList.contains('mews')){
    var on=el.getAttribute('aria-pressed')!=='true';el.setAttribute('aria-pressed',on?'true':'false');
    $('small',el).textContent=on?'Bevestigd door '+me()+'.':'Tik om te bevestigen dat de parkeerkosten op de kamer of reservering staan.';
    var mm=$('#b-msg');if(mm&&on)mm.textContent='';return;
  }
  if(el.hasAttribute('data-dep')){$all('button',el.parentNode).forEach(function(b){b.setAttribute('aria-pressed',b===el?'true':'false')});return}
  if(el.hasAttribute('data-bid')){
    var bk=bookings().filter(function(x){return x.id===el.getAttribute('data-bid')})[0];
    if(bk&&S.view==='kalender'&&S.q.trim()){S.q='';S.day=bk.from<=today()&&today()<bk.to?today():bk.from;S.month=S.day.slice(0,7);render()}
    openBooking(el.getAttribute('data-bid'));return;
  }
  if(el.hasAttribute('data-kind')){
    /* wisselen tussen verhuren en blokkeren: plek en begindatum blijven staan */
    var keep={spot:$('#b-spot').value,from:$('#b-from').value};
    openBooking(null,keep.spot,el.getAttribute('data-kind'),isDate(keep.from)?keep.from:null);return;
  }
  if(el.id==='b-save'){doSaveBooking();return}
  if(el.id==='b-del'){askDeleteBooking();return}
  if(el.id==='b-del2'){doDeleteBooking();return}
  if(el.id==='d-add'){openDeposit(null);return}
  if(el.hasAttribute('data-did')){openDeposit(el.getAttribute('data-did'));return}
  if(el.id==='d-save'){doSaveDeposit();return}
  if(el.id==='d-del'){doDeleteDeposit();return}
  if(el.id==='s-add'){openSpot(null);return}
  if(el.hasAttribute('data-sid')){openSpot(el.getAttribute('data-sid'));return}
  if(el.id==='s-save'){doSaveSpot();return}
  if(el.id==='s-del'){doDeleteSpot();return}
  if(el.hasAttribute('data-move')){moveSpot(el.getAttribute('data-id'),+el.getAttribute('data-move'));return}
  if(el.id==='csv'){
    var mo=today().slice(0,7);
    (S.dl?S.dl.save({filename:'parkeren-'+mo+'.csv',data:buildCsv(mo)}):Promise.reject()).then(null,function(){toast('Downloaden lukt niet op dit apparaat.')});
  }
});
document.addEventListener('change',function(ev){
  var el=ev.target;
  if(el.id==='naam'){var v=el.value.trim();el.value=v;ls('naam',v);if(v)$('#toast').hidden=true;return}
  if(el.id==='a-noplate'){var pl=$('#a-plate');pl.disabled=el.checked;if(el.checked)pl.value='';return}
  if(el.id==='b-from'||el.id==='b-to'){
    if(el.id==='b-from'&&$('#b-nights')&&isDate(el.value)&&$('#b-to').value<=el.value)$('#b-to').value=addDays(el.value,1);
    syncNights();
  }
});
var qT;
document.addEventListener('input',function(ev){
  if(ev.target.id==='zoek'){S.q=ev.target.value;clearTimeout(qT);qT=setTimeout(render,200)}
});
document.addEventListener('keydown',function(ev){
  if(ev.key==='Escape'&&modalOpen()){closeModal();return}
  if(ev.key!=='Enter')return;
  var el=ev.target;
  if(el.id==='naam'||el.id==='zoek'){ev.preventDefault();el.blur();return}
  if(modalOpen()&&el.tagName==='INPUT'&&el.type!=='checkbox'){ev.preventDefault();var b=$('#b-save')||$('#a-save')||$('#d-save')||$('#s-save');if(b)b.click()}
});
$('#modal').addEventListener('click',function(ev){if(ev.target===this)closeModal()});
window.addEventListener('hashchange',function(){var v=location.hash.slice(1);if(v&&v!==S.view)setView(v)});
/* een scherm dat openstaat werkt de controle bij en springt om middernacht naar de nieuwe dag */
var lastDay=null;
setInterval(function(){
  var td=today();if(lastDay&&lastDay!==td&&S.day===lastDay){S.day=td;S.month=td.slice(0,7)}lastDay=td;
  if(!modalOpen()&&!/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||''))render();
},60000);

/* ---------- start ---------- */
function fail(t,p){$('#view').innerHTML='<div class="empty"><h3>'+esc(t)+'</h3><p>'+esc(p)+'</p></div>'}
if(!P){fail('Deze pagina bestaat niet','Kies Parkeren in het menu.');$('.tabs').hidden=true;$('#where').hidden=true;return}
document.body.setAttribute('data-page',KEY);document.body.setAttribute('data-loc',P.loc.toLowerCase());
document.title=document.title.replace('Parkeren','Parkeren '+P.loc);
$('#where').textContent=P.loc+' · '+P.area;
S.day=today();S.month=S.day.slice(0,7);lastDay=S.day;
var hv=location.hash.slice(1);if(VIEWS.indexOf(hv)>0)S.view=hv;
if(!window.claude||!window.claude.use){fail('De website is niet goed geladen','Laad de pagina opnieuw. Blijft dit terugkomen, meld het bij de eigenaar.');return}
render();
Promise.all([window.claude.use('db'),window.claude.use('downloads')]).then(function(r){
  S.db=r[0];S.dl=r[1];
  if(!S.db){fail('De website is niet goed geladen','Laad de pagina opnieuw. Blijft dit terugkomen, meld het bij de eigenaar.');return}
  S.db.doc('park/'+KEY).onSnapshot(function(s){S.cfg=s.exists?s.data():null;S.cfgLoaded=true;if(!s.exists)seed();render()});
  S.db.collection('parklog').limit(1000).onSnapshot(function(qs){
    var o={};qs.docs.forEach(function(d){if(d.id.indexOf(KEY+'_')===0)o[d.id]=d.data()});
    S.logs=o;S.logsLoaded=true;render();
  });
});
})();
