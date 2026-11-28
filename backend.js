/* Koppeling tussen de app en Supabase.
   De app werkt met documenten op een pad ("catalog/floats", "counts/floats_2026-W47").
   Dit bestand biedt daarvoor: doc(pad).get/set/update/onSnapshot en collection(pad).onSnapshot.
   Alles staat in één tabel `voorraad_docs` (pad + json). Zie supabase/schema.sql.
   Toegang: eerst inloggen. Je kiest je locatie en afdeling (de plek, bv. floats-keuken) of management,
   en voert de code van die plek in. De database controleert de code en geeft een sessiesleutel terug;
   lezen en schrijven kan alleen met die sleutel (functies voorraad_*), en de database geeft een afdeling
   alleen haar eigen documenten. window.DV_SESSION zegt aan de pagina's wie er is ingelogd. */
(function(){
'use strict';
var cfg=window.DV_CONFIG||{};
var sb=(cfg.url&&cfg.key&&window.supabase)?window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
var cache={},stamp={},busy={},ver={},subs=[],waiters=[],loaded=false,loading=false,started=false,maxStamp=null;
var PRE=(cfg.prefix||'voorraad')+'_';   /* voorraad_ op de echte site, voorraadtest_ op de testsite */
var TOKEN_KEY=cfg.test?'dv.testtoken':'dv.token',PLEK_KEY=cfg.test?'dv.testplek':'dv.plek',token=null,plek=null,gate=null;
try{token=localStorage.getItem(TOKEN_KEY)||null;plek=localStorage.getItem(PLEK_KEY)||null}catch(e){}
var PLEKKEN=window.DV_PLEKKEN||[];
function plekOk(k){return k==='management'||PLEKKEN.some(function(p){return p.key===k})}
if(!plekOk(plek))plek=null;
if(!plek)token=null;   /* een sessie van vóór het kiezen van een afdeling: opnieuw inloggen */

/* ---- wie is er ingelogd en wat mag die zien ---- */
function mkSession(k){
  if(!k)return null;
  if(k==='management')return {plek:k,mgmt:true,loc:null,dept:null,label:'Management'};
  var p=PLEKKEN.filter(function(x){return x.key===k})[0];
  return {plek:k,mgmt:false,loc:p.loc.toLowerCase(),dept:k.slice(k.indexOf('-')+1),label:p.loc+' · '+p.area};
}
var bodyEl=document.body,MODULE=bodyEl.getAttribute('data-module')||(bodyEl.getAttribute('data-page')?'temp':'voorraad');
var ROOT=MODULE==='start'?'./':'../';
function pagePlek(){
  var k=bodyEl.getAttribute('data-page')||(/[?&]p=([a-z0-9-]+)/.exec(location.search)||[])[1]||'';
  if(!k&&MODULE==='park'){var o=PLEKKEN.filter(function(p){return p.park});if(o.length===1)k=o[0].key}
  return k;
}
/* een afdeling ziet de startpagina, haar eigen voorraad en de pagina's van haar eigen plek; management alles */
function allowed(ses){
  if(!ses)return false;
  if(ses.mgmt||MODULE==='start'||MODULE==='voorraad')return true;
  if(MODULE==='inkoop')return false;
  return pagePlek()===ses.plek;
}
function forget(all){token=null;try{localStorage.removeItem(TOKEN_KEY);if(all)localStorage.removeItem(PLEK_KEY)}catch(e){}}
var session=token?mkSession(plek):null;
if(session&&!allowed(session)){location.replace(ROOT);return}
if(session){session.logout=function(){forget(true);location.replace(ROOT)};session.root=ROOT}
window.DV_SESSION=session;

function clone(o){return JSON.parse(JSON.stringify(o))}
function merge(t,s){Object.keys(s).forEach(function(k){var v=s[k];if(v&&typeof v==='object'&&!Array.isArray(v)){if(!t[k]||typeof t[k]!=='object'||Array.isArray(t[k]))t[k]={};merge(t[k],v)}else t[k]=v});return t}
function prefixOf(path){return path.slice(0,path.lastIndexOf('/'))}
function touch(path){ver[path]=(ver[path]||0)+1;var p='#'+prefixOf(path);ver[p]=(ver[p]||0)+1}
function emit(){if(!loaded)return;subs.slice().forEach(function(f){try{f()}catch(e){console.error(e)}})}
function noAccess(e){return !!(e&&e.code==='28000')}
function toErr(e){
  var m=(e&&e.message)||String(e||'');
  if(noAccess(e)){expire();return {code:'unavailable',message:m}}
  if(e&&(e.code==='42501'||e.status===401||e.status===403))return {code:'invalid_argument',message:m};
  if(!e||!e.code||/fetch|network|timeout|load failed/i.test(m))return {code:'unavailable',message:m};
  return {code:'failed',message:m};
}
function newer(a,b){if(!b)return true;var x=Date.parse(a),y=Date.parse(b);return isNaN(x)||isNaN(y)?a!==b:x>=y}
function apply(row){
  if(!row||!row.path||busy[row.path])return false;
  if(stamp[row.path]===row.updated_at||!newer(row.updated_at,stamp[row.path]))return false;
  cache[row.path]=row.data;stamp[row.path]=row.updated_at;touch(row.path);
  if(!maxStamp||Date.parse(row.updated_at)>Date.parse(maxStamp))maxStamp=row.updated_at;
  return true;
}
function load(full){
  if(!sb||loading||!token)return;
  loading=true;
  var args={p_token:token};
  if(!full&&loaded&&maxStamp)args.p_since=maxStamp;
  /* elke pagina haalt alleen haar eigen soort documenten op (voorraad: catalog+counts, temperaturen: temp+templog) */
  if(window.DV_PREFIXES)args.p_prefixes=window.DV_PREFIXES;
  sb.rpc(PRE+'lezen',args).then(function(r){
    loading=false;
    if(r.error)throw r.error;
    var changed=false,seen={};
    (r.data||[]).forEach(function(row){seen[row.path]=1;if(apply(row))changed=true});
    if(full||!loaded)Object.keys(cache).forEach(function(p){if(!seen[p]&&!busy[p]){delete cache[p];delete stamp[p];touch(p);changed=true}});
    var first=!loaded;loaded=true;
    if(first){waiters.forEach(function(w){w()});waiters=[]}
    if(changed||first)emit();
  }).then(null,function(e){
    loading=false;
    if(noAccess(e)){expire();return}
    if(window.console)console.warn('Voorraad laden lukt niet:',e&&e.message);
    if(!loaded)setTimeout(function(){load(true)},4000);
  });
}
function start(){
  if(started||!sb)return;started=true;
  if(token)load(true);else showGate();
  /* Wijzigingen van collega's komen binnen door elke 10 seconden te vragen wat er nieuw is. */
  setInterval(function(){if(!document.hidden)load(false)},10000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)load(false)});
  window.addEventListener('online',function(){load(true)});
}
function whenLoaded(){start();return loaded?Promise.resolve():new Promise(function(res){waiters.push(res)})}
function snap(path){
  var d=cache[path];
  return {id:path.slice(path.lastIndexOf('/')+1),exists:d!==undefined,data:function(){return d},metadata:{fromCache:false,hasPendingWrites:!!busy[path]}};
}
function begin(p){busy[p]=(busy[p]||0)+1}
function end(p){busy[p]--;if(!busy[p])delete busy[p]}
function finish(path,r){
  end(path);
  if(r.error){setTimeout(function(){load(true)},1500);throw toErr(r.error)}
  var row=r.data;
  if(row&&row.updated_at&&!busy[path]){
    stamp[path]=row.updated_at;
    if(!maxStamp||Date.parse(row.updated_at)>Date.parse(maxStamp))maxStamp=row.updated_at;
    if(row.data){cache[path]=row.data;touch(path);emit()}
  }
}
function failed(path,e){end(path);setTimeout(function(){load(true)},1500);throw toErr(e)}

function doc(path){
  return {
    id:path.slice(path.lastIndexOf('/')+1),path:path,
    get:function(){return whenLoaded().then(function(){return snap(path)})},
    set:function(d){
      if(!sb)return Promise.reject({code:'unavailable'});
      cache[path]=clone(d);touch(path);begin(path);emit();
      return sb.rpc(PRE+'schrijven',{p_token:token,p_path:path,p_data:d})
        .then(function(r){finish(path,r)},function(e){failed(path,e)});
    },
    update:function(d){
      if(!sb)return Promise.reject({code:'unavailable'});
      if(cache[path]===undefined)return Promise.reject({code:'invalid_argument',message:'document bestaat niet'});
      cache[path]=merge(clone(cache[path]),clone(d));touch(path);begin(path);emit();
      return sb.rpc(PRE+'bijwerken',{p_token:token,p_path:path,p_patch:d}).then(function(r){
        /* document is intussen verwijderd: zet het hele document terug */
        if(r.error&&r.error.code==='P0002')return sb.rpc(PRE+'schrijven',{p_token:token,p_path:path,p_data:cache[path]});
        return r;
      }).then(function(r){finish(path,r)},function(e){failed(path,e)});
    },
    onSnapshot:function(next){
      var seen=-1;
      function f(){var v=ver[path]||0;if(v===seen)return;seen=v;next(snap(path))}
      subs.push(f);start();if(loaded)setTimeout(f,0);
      return function(){var i=subs.indexOf(f);if(i>=0)subs.splice(i,1)};
    }
  };
}
function collection(path){
  var q={path:path,limit:function(){return q},doc:function(id){return doc(path+'/'+id)},
    onSnapshot:function(next){
      var seen=-1,key='#'+path;
      function f(){
        var v=ver[key]||0;if(v===seen)return;seen=v;
        var docs=Object.keys(cache).filter(function(k){return prefixOf(k)===path}).sort().map(snap);
        next({docs:docs,size:docs.length,empty:!docs.length,metadata:{fromCache:false,hasPendingWrites:false}});
      }
      subs.push(f);start();if(loaded)setTimeout(f,0);
      return function(){var i=subs.indexOf(f);if(i>=0)subs.splice(i,1)};
    }};
  return q;
}

/* Inlogscherm: dekt de hele pagina af tot de juiste code is ingevoerd. */
function expire(){
  if(!token)return;
  forget(false);
  showGate('Je bent uitgelogd. Voer de code opnieuw in.');
}
/* Drie stappen: locatie (of management), afdeling, code. De laatst gekozen plek wordt onthouden,
   zodat je op een vast apparaat alleen nog de code hoeft in te voeren. */
var ORDER=['receptie','keuken','bar','housekeeping'];
function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function showGate(msg){
  if(gate){if(msg){var m=gate.querySelector('.gate-msg');if(m)m.textContent=msg}return}
  var pick=plekOk(plek)?plek:null,loc=null,note=msg||'';
  gate=document.createElement('div');gate.className='gate';gate.setAttribute('role','dialog');gate.setAttribute('aria-modal','true');gate.setAttribute('aria-labelledby','gate-h');
  document.body.appendChild(gate);
  function locs(){var a=[];PLEKKEN.forEach(function(p){if(a.indexOf(p.loc)<0)a.push(p.loc)});return a}
  function areas(l){return PLEKKEN.filter(function(p){return p.loc===l}).sort(function(a,b){var x=ORDER.indexOf(a.key.slice(a.key.indexOf('-')+1)),y=ORDER.indexOf(b.key.slice(b.key.indexOf('-')+1));return (x<0?99:x)-(y<0?99:y)})}
  function head(t,sub){return '<span class="brand-mark" aria-hidden="true"></span><h1 id="gate-h">'+t+'</h1>'+(sub?'<p class="muted">'+sub+'</p>':'')
    +(cfg.test?'<p class="note warn">Dit is de testversie. Wat je hier invult, komt niet op de echte site.</p>':'')}
  function draw(){
    var h;
    if(pick){
      var ses=mkSession(pick);
      h='<form class="gate-card" novalidate>'+head('Inloggen','')
        +'<div class="gate-who"><b>'+esc(ses.label)+'</b><button type="button" class="gate-back" data-back>Andere afdeling</button></div>'
        +'<div class="field"><label for="gate-code">Code'+(ses.mgmt?' van management':' van je afdeling')+'</label>'
        +'<input class="input" id="gate-code" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="64" required></div>'
        +'<p class="gate-msg" role="alert">'+esc(note)+'</p><button class="btn primary" type="submit">Inloggen</button></form>';
    }else if(loc){
      h='<div class="gate-card">'+head(esc(loc),'Op welke afdeling werk je?')
        +'<div class="gate-opts">'+areas(loc).map(function(p){return '<button type="button" class="btn gate-opt" data-plek="'+p.key+'">'+esc(p.area)+'</button>'}).join('')+'</div>'
        +'<button type="button" class="gate-back" data-back>‹ Terug</button></div>';
    }else{
      h='<div class="gate-card">'+head('Inloggen','Kies eerst waar je werkt.')
        +(note?'<p class="gate-msg" role="alert">'+esc(note)+'</p>':'')
        +'<div class="gate-opts">'+locs().map(function(l){return '<button type="button" class="btn gate-opt gate-loc" data-gloc="'+esc(l)+'" data-loc="'+esc(l.toLowerCase())+'">'+esc(l)+'</button>'}).join('')
        +'<button type="button" class="btn gate-opt gate-mgmt" data-plek="management">Management</button></div></div>';
    }
    gate.innerHTML=h;
    var f=gate.querySelector('#gate-code')||gate.querySelector('.gate-opt');
    setTimeout(function(){try{if(f)f.focus()}catch(e){}},50);
  }
  gate.addEventListener('click',function(ev){
    var b=ev.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-back')){if(pick){var s0=mkSession(pick);loc=s0.mgmt?null:PLEKKEN.filter(function(p){return p.key===pick})[0].loc;pick=null}else loc=null;note='';draw();return}
    if(b.hasAttribute('data-gloc')){loc=b.getAttribute('data-gloc');note='';draw();return}
    if(b.hasAttribute('data-plek')){pick=b.getAttribute('data-plek');note='';draw();return}
  });
  gate.addEventListener('submit',function(ev){
    ev.preventDefault();
    var inp=gate.querySelector('#gate-code'),out=gate.querySelector('.gate-msg'),btn=gate.querySelector('button[type=submit]'),code=inp.value.trim(),want=pick;
    if(!code){out.textContent='Vul de code in.';inp.focus();return}
    btn.disabled=true;btn.textContent='Controleren…';out.textContent='';
    function again(t){btn.disabled=false;btn.textContent='Inloggen';out.textContent=t;inp.value='';inp.focus()}
    sb.rpc(PRE+'login',{p_code:code,p_plek:want}).then(function(r){
      if(r.error)throw r.error;
      var d=r.data||{};
      if(d.ok&&d.token){
        try{localStorage.setItem(TOKEN_KEY,d.token);localStorage.setItem(PLEK_KEY,want)}catch(e){}
        /* opnieuw laden, zodat elke pagina weet wie er is ingelogd; een pagina die niet bij deze afdeling hoort gaat naar de startpagina */
        if(allowed(mkSession(want)))location.reload();else location.replace(ROOT);
        return;
      }
      again(d.reason==='locked'?'Te veel foute pogingen. Probeer het over een kwartier opnieuw.':'Die code klopt niet. Probeer het opnieuw.');
    }).then(null,function(){again('Inloggen lukt nu niet. Controleer je internetverbinding en probeer het opnieuw.')});
  });
  draw();
}

/* Geen persoonlijke accounts: wie de code heeft mag lezen en schrijven; wie telt vult zijn naam in bij het afronden. */
var user={
  me:function(){return Promise.resolve({id:null,name:'',email:null,isOwner:false,canEdit:false})},
  can:function(){return Promise.resolve(true)},
  profiles:function(ids){var o={};[].concat(ids||[]).forEach(function(i){o[i]={id:i,name:/^naam:/.test(i)?i.slice(5):''}});return Promise.resolve(o)}
};
var downloads={
  save:function(req){
    try{
      var blob=req.data instanceof Blob?req.data:new Blob([req.data],{type:/\.csv$/i.test(req.filename)?'text/csv;charset=utf-8':'application/octet-stream'});
      var url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=req.filename;document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(url);a.remove()},2000);
      return Promise.resolve({status:'saved'});
    }catch(e){return Promise.reject({code:'unavailable'})}
  }
};
/* Testversie: vaste balk bovenin, zodat niemand de testsite voor de echte aanziet. */
if(cfg.test){
  var topEl=document.querySelector('.top');
  if(topEl){var tb=document.createElement('div');tb.className='testbar';tb.textContent='Testversie · wat je hier invult, komt niet op de echte site';topEl.insertBefore(tb,topEl.firstChild)}
  document.title='TEST · '+document.title;
}
var caps={db:sb?{doc:doc,collection:collection}:null,user:user,downloads:downloads};
/* niet ingelogd: meteen het inlogscherm, ook op een pagina die zelf geen gegevens ophaalt */
if(sb&&!token)showGate();
window.claude={use:function(n){return Promise.resolve(caps[n]||null)}};
})();
