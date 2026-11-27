/* Koppeling tussen de app en Supabase.
   De app werkt met documenten op een pad ("catalog/floats", "counts/floats_2026-W47").
   Dit bestand biedt daarvoor: doc(pad).get/set/update/onSnapshot en collection(pad).onSnapshot.
   Alles staat in één tabel `voorraad_docs` (pad + json). Zie supabase/schema.sql.
   Toegang: eerst inloggen met de toegangscode. De database controleert de code en geeft een
   sessiesleutel terug; lezen en schrijven kan alleen met die sleutel (functies voorraad_*). */
(function(){
'use strict';
var cfg=window.DV_CONFIG||{};
var sb=(cfg.url&&cfg.key&&window.supabase)?window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
var cache={},stamp={},busy={},ver={},subs=[],waiters=[],loaded=false,loading=false,started=false,maxStamp=null;
var PRE=(cfg.prefix||'voorraad')+'_';   /* voorraad_ op de echte site, voorraadtest_ op de testsite */
var TOKEN_KEY=cfg.test?'dv.testtoken':'dv.token',token=null,gate=null;
try{token=localStorage.getItem(TOKEN_KEY)||null}catch(e){}

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
  token=null;try{localStorage.removeItem(TOKEN_KEY)}catch(e){}
  showGate('Je bent uitgelogd. Voer de toegangscode opnieuw in.');
}
function showGate(msg){
  if(gate){if(msg)gate.querySelector('.gate-msg').textContent=msg;return}
  gate=document.createElement('div');gate.className='gate';gate.setAttribute('role','dialog');gate.setAttribute('aria-modal','true');gate.setAttribute('aria-labelledby','gate-h');
  gate.innerHTML='<form class="gate-card" novalidate>'
    +'<span class="brand-mark" aria-hidden="true"></span>'
    +'<h1 id="gate-h">'+(window.DV_TITLE||'Drankvoorraad')+'</h1>'
    +'<p class="muted">FLOATS &amp; ALTSTADT. Voer de toegangscode in om verder te gaan.</p>'
    +(cfg.test?'<p class="note warn">Dit is de testversie. Wat je hier invult, komt niet op de echte site.</p>':'')
    +'<div class="field"><label for="gate-code">Toegangscode</label>'
    +'<input class="input" id="gate-code" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" maxlength="64" required></div>'
    +'<p class="gate-msg" role="alert"></p>'
    +'<button class="btn primary" type="submit">Inloggen</button>'
    +'</form>';
  document.body.appendChild(gate);
  var form=gate.querySelector('form'),inp=gate.querySelector('#gate-code'),out=gate.querySelector('.gate-msg'),btn=gate.querySelector('button');
  if(msg)out.textContent=msg;
  form.addEventListener('submit',function(ev){
    ev.preventDefault();
    var code=inp.value.trim();
    if(!code){out.textContent='Vul de toegangscode in.';inp.focus();return}
    btn.disabled=true;btn.textContent='Controleren…';out.textContent='';
    function again(t){btn.disabled=false;btn.textContent='Inloggen';out.textContent=t;inp.value='';inp.focus()}
    sb.rpc(PRE+'login',{p_code:code}).then(function(r){
      if(r.error)throw r.error;
      var d=r.data||{};
      if(d.ok&&d.token){
        token=d.token;try{localStorage.setItem(TOKEN_KEY,token)}catch(e){}
        gate.remove();gate=null;load(true);return;
      }
      again(d.reason==='locked'?'Te veel foute pogingen. Probeer het over een kwartier opnieuw.':'Die code klopt niet. Probeer het opnieuw.');
    }).then(null,function(){again('Inloggen lukt nu niet. Controleer je internetverbinding en probeer het opnieuw.')});
  });
  setTimeout(function(){try{inp.focus()}catch(e){}},50);
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
window.claude={use:function(n){return Promise.resolve(caps[n]||null)}};
})();
