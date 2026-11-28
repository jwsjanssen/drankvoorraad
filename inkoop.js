/* Inkoop uit facturen: elke dag leest een ronde de facturen uit de mail en levert de regels hier aan.
   Op deze pagina beoordeel je ze per factuur: een regel hoort bij een bestaand product (prijs wordt bijgewerkt),
   wordt een nieuw product (met afdeling, categorie en tel-eenheid) of is geen voorraad. Er gaat niets ongezien de productlijst in.
   Gegevens (zie backend.js):
     catalog/<locatie>               productlijst; per product o.a. dept (afdeling), count (meetellen in de telling),
                                     refs:{<leverancier~artikel>:{f}} = onder welke factuurregels dit product bekend is,
                                     f = aantal tel-eenheden per factuureenheid; pdate = datum van de factuur waar de prijs van komt
     inkoop/<locatie>                {skip:{<leverancier~artikel>:{d,at}}} = regels die geen voorraad zijn (onthouden)
     inkooplog/<locatie>_<JJJJ>-W<ww> facturen in de week van de factuurdatum; locatie kan ook 'onbekend' zijn:
        {f:{<id>:{sup,no,date,sent,cust,dept,kind:'p'|'c'|'d'|'x',st:'n'|'v'|'o',total,subj,at,by,
                  L:{<nr>:{d,a,q,e,n,v,p,c,t:'p'|'e'|'t', sg:{name,cat,dept,unit,f,count}, r:'new'|'link'|'skip',pid,f,rem}}}}}
        kind: producten, creditnota, dienst, onleesbaar. st: nieuw, verwerkt, overgeslagen.
        Regel: d omschrijving, a artikelnummer, q aantal, e prijs per eenheid, n regelbedrag excl., v btw, p verpakking, c inhoud,
        t soort (product, emballage, toeslag), sg voorstel van de ronde, r/pid/f de keuze van de beoordelaar. */
(function(){
'use strict';
var LOCS={floats:'FLOATS',altstadt:'ALTSTADT',onbekend:'Geen locatie'};
var DEPTS=window.DV_DEPTS||[{key:'bar',label:'Bar'},{key:'keuken',label:'Keuken'}];
var GROUPS=window.DV_CATGROUPS||[],CATS=window.DV_CATS||[];
var VIEWS=['beoordelen','verwerkt','overig'];
var MND=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
var ALIAS={'g-b-yerseke':'g-b','heineken-en-sligro':'sligro','heineken':'sligro','rombouts-den-leeuw':'rombouts'};
var ABBR={FL:'fles',BL:'blik',ZK:'zak',PK:'pak',DS:'doos',PT:'pot',EM:'emmer',KP:'pak',BK:'bak',ST:'stuk',VT:'fust',KR:'krat',TR:'tray',RL:'rol',TB:'tube',BS:'bus',KK:'koker',CN:'can'};

var S={db:null,view:'beoordelen',loc:'floats',cat:{},catOk:{},cfg:{},logs:{},logsOk:false,open:null,busy:false,pq:''};
var chain={},toastT,idxCache={};

/* ---------- hulpjes ---------- */
function $(s,r){return (r||document).querySelector(s)}
function $all(s,r){return [].slice.call((r||document).querySelectorAll(s))}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function ls(k,v){try{if(v===undefined)return localStorage.getItem('dv.'+k);localStorage.setItem('dv.'+k,v)}catch(e){return null}}
function toast(msg){var t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true},4500)}
function openModal(html){var m=$('#modal');m.innerHTML='<div class="sheet" role="dialog" aria-modal="true" tabindex="-1">'+html+'</div>';m.hidden=false;var f=$('.sheet',m);if(f)f.focus()}
function closeModal(){var m=$('#modal');m.hidden=true;m.innerHTML=''}
function modalOpen(){return !$('#modal').hidden}
function me(){return (ls('naam')||'').trim()}
function slug(s){return String(s==null?'':s).normalize('NFKD').replace(/[^\x00-\x7F]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}
function r4(n){return Math.round(n*10000)/10000}
var nf=new Intl.NumberFormat('nl-NL',{maximumFractionDigits:3});
function num(n){return n==null||isNaN(n)?'–':nf.format(n)}
function eur(n){if(n==null||isNaN(n))return '–';return new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:Math.abs(n)<1?3:2}).format(n)}
function inStr(n){return n==null?'':String(n).replace('.',',')}
function parseNum(s){s=String(s).trim().replace(',','.');if(s==='')return null;if(!/^\d*\.?\d*$/.test(s)||s==='.')return undefined;var n=parseFloat(s);return isNaN(n)?undefined:n}
function dateLabel(s){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s||'');return m?(+m[3])+' '+MND[+m[2]-1]+(m[1]!==String(new Date().getFullYear())?' '+m[1]:''):''}
function deptLabel(k){var d=DEPTS.filter(function(x){return x.key===k})[0];return d?d.label:(k||'')}
function supKey(s){var k=slug(s);return ALIAS[k]||k}
function refKey(sup,a,d){a=String(a||'').replace(/^0+/,'');return supKey(sup)+'~'+(a?'a'+a:'d'+slug(d).slice(0,60))}
function sentence(s){s=String(s||'').toLowerCase().replace(/\s+/g,' ').trim();return s.charAt(0).toUpperCase()+s.slice(1)}

/* ---------- gegevens ---------- */
function items(loc){var c=S.cat[loc];return (c&&c.items)||{}}
function index(loc){
  var c=S.cat[loc];if(!c)return {};
  if(idxCache[loc]&&idxCache[loc].src===c)return idxCache[loc].map;
  var map={},it=items(loc);
  Object.keys(it).forEach(function(pid){var p=it[pid];if(!p||typeof p!=='object')return;
    if(p.sup&&p.art)map[refKey(p.sup,p.art,'')]=pid;
    if(p.refs)Object.keys(p.refs).forEach(function(rk){map[rk]=pid});
  });
  idxCache[loc]={src:c,map:map};return map;
}
function skips(loc){return (S.cfg[loc]&&S.cfg[loc].skip)||{}}
function invoices(){
  var a=[];
  Object.keys(S.logs).forEach(function(doc){
    var loc=doc.split('_')[0],f=(S.logs[doc]&&S.logs[doc].f)||{};
    Object.keys(f).forEach(function(fid){var v=f[fid];if(!v||typeof v!=='object'||v.gone)return;a.push({doc:doc,loc:LOCS[loc]?loc:'onbekend',fid:fid,v:v})});
  });
  a.sort(function(x,y){var dx=x.v.date||x.v.sent||'',dy=y.v.date||y.v.sent||'';return dx<dy?-1:dx>dy?1:x.fid<y.fid?-1:1});
  return a;
}
function findInv(fid){return invoices().filter(function(x){return x.fid===fid})[0]||null}
function lines(inv){var L=inv.v.L||{};return Object.keys(L).sort().map(function(id){return {id:id,l:L[id]||{}}})}
function prodLines(inv){return lines(inv).filter(function(x){return x.l.t==='p'||!x.l.t})}
function guessF(l){var m=/^(\d+)\s*[A-Za-z]/.exec(l.p||'');return m&&+m[1]>1&&l.c?+m[1]:1}
function proposal(inv,l){
  var sg=l.sg||{},m=/^(\d+)\s*([A-Za-z]+)/.exec(l.p||''),w=m?ABBR[m[2].toUpperCase()]:'';
  var unit=sg.unit||((w||'stuk')+(l.c&&!/stuks/i.test(l.c)?' '+String(l.c).toLowerCase():''));
  return {name:sg.name||sentence(l.d),cat:sg.cat||'Overig',dept:sg.dept||inv.v.dept||(inv.loc==='onbekend'?'algemeen':'keuken'),
    unit:unit,f:sg.f>0?sg.f:guessF(l),count:sg.count!==false};
}
/* wat gebeurt er met deze regel: gekozen door de beoordelaar, of anders automatisch bepaald */
function decide(inv,l){
  var it=items(inv.loc),rk=refKey(inv.v.sup,l.a,l.d);
  if(l.r==='skip')return {r:'skip',rem:l.rem!==false,rk:rk};
  if(l.r==='link'&&l.pid&&it[l.pid])return {r:'link',pid:l.pid,f:l.f>0?l.f:guessF(l),rk:rk};
  if(l.r==='new')return {r:'new',sg:proposal(inv,l),rk:rk};
  var pid=index(inv.loc)[rk];
  if(pid&&it[pid]){var rf=it[pid].refs&&it[pid].refs[rk];return {r:'link',pid:pid,f:rf&&rf.f>0?rf.f:(l.sg&&l.sg.f>0?l.sg.f:guessF(l)),rk:rk,auto:true}}
  if(skips(inv.loc)[rk])return {r:'skip',rem:false,rk:rk,auto:true};
  return {r:'new',sg:proposal(inv,l),rk:rk,auto:true};
}
/* inkoopprijs per tel-eenheid uit de regel: regelbedrag ÷ aantal (dan zit korting erin), anders de stuksprijs */
function unitCost(l,f){
  f=f>0?f:1;
  if(typeof l.n==='number'&&typeof l.q==='number'&&l.q>0&&l.n>0)return r4(l.n/l.q/f);
  if(typeof l.e==='number'&&l.e>0&&!(l.q<0))return r4(l.e/f);
  return null;
}
function odd(oldP,newP){return typeof oldP==='number'&&oldP>0&&newP!=null&&(newP/oldP>3||newP/oldP<1/3)}
function tally(inv){
  /* neu = aantal verschillende nieuwe producten (hetzelfde product kan op meerdere regels staan); keys = welke dat zijn */
  var t={link:0,neu:0,skip:0,odd:0,other:0,keys:{}};
  lines(inv).forEach(function(x){
    if(x.l.t&&x.l.t!=='p'){t.other++;return}
    var d=decide(inv,x.l);
    if(d.r==='link'){t.link++;if(odd(items(inv.loc)[d.pid].price,unitCost(x.l,d.f)))t.odd++}else if(d.r==='skip')t.skip++;else if(!t.keys[d.rk]){t.keys[d.rk]=1;t.neu++}
  });
  return t;
}
/* een creditnota hoort alleen bij de voorraad als er een bekend product op staat; anders is het een creditnota voor een dienst */
function isOther(x){
  var v=x.v;if(v.st==='v')return false;
  if(v.st==='o'||v.kind==='d'||v.kind==='x')return true;
  if(v.kind==='c'&&v.st!=='n2'){var t=tally(x);return t.link+t.skip===0}
  return false;
}
function pending(loc){return invoices().filter(function(x){return x.loc===loc&&x.v.st!=='v'&&!isOther(x)})}

/* ---------- schrijven: per document één schrijfactie tegelijk ---------- */
function write(path,patch){
  var ref=S.db.doc(path);
  function once(){return ref.get().then(function(s){return s.exists?ref.update(patch):ref.set(patch)})}
  chain[path]=(chain[path]||Promise.resolve()).catch(function(){}).then(function(){
    return once().catch(function(e){if(e&&e.code==='unavailable')return new Promise(function(r){setTimeout(r,1500)}).then(once);throw e});
  });
  return chain[path];
}
function patchInv(inv,p){var f={};f[inv.fid]=p;return write('inkooplog/'+inv.doc,{f:f})}
function saveErr(){toast('Opslaan is niet gelukt. Controleer je verbinding en probeer het opnieuw.')}

/* ---------- goedkeuren ---------- */
function packName(l,f){if(!(f>1))return 'stuk';var m=/^\d+\s*([A-Za-z]+)/.exec(l.p||'');var w=m?m[1].toUpperCase():'';return w==='VT'?'fust':w==='KR'?'krat':'doos'}
function buildApprove(inv){
  var loc=inv.loc,it=items(loc),P={},SK={},L={},made={},now=new Date().toISOString(),n={neu:0,upd:0,skip:0},date=inv.v.date||inv.v.sent||'',i=0;
  prodLines(inv).forEach(function(x){
    var l=x.l,d=decide(inv,l),rk=d.rk;
    if(d.r==='skip'){if(d.rem)SK[rk]={d:String(l.d||'').slice(0,80),at:now};L[x.id]={r:'skip'};n.skip++;return}
    var pid,f,cost;
    if(d.r==='link'){
      pid=d.pid;f=d.f;cost=unitCost(l,f);
      var cur=it[pid],p=P[pid]||(P[pid]={});
      p.refs=p.refs||{};p.refs[rk]={f:f};
      if(cost!=null&&inv.v.kind!=='c'&&(!cur.pdate||date>=cur.pdate)&&!(p.pdate&&p.pdate>date)){
        if(typeof cur.price==='number'&&cur.price!==cost)p.pprev=cur.price;
        p.price=cost;p.pdate=date;p.est=false;
      }
      if(!cur.sup)p.sup=inv.v.sup;
      n.upd++;
    }else{
      var sg=d.sg;f=sg.f>0?sg.f:1;cost=unitCost(l,f);pid=made[rk];
      if(!pid){
        pid=made[rk]=loc.charAt(0)+'-'+(slug(sg.name+' '+sg.unit)||'product').slice(0,60)+'-'+Math.random().toString(36).slice(2,6);
        var refs={};refs[rk]={f:f};
        P[pid]={name:String(sg.name||sentence(l.d)).slice(0,80),cat:sg.cat||'Overig',unit:String(sg.unit||'stuk').slice(0,40),price:cost,par:null,
          pack:f>1?Math.round(f):1,packName:packName(l,f),sup:String(inv.v.sup||'').slice(0,40),art:String(l.a||'').slice(0,30),
          dept:sg.dept||'keuken',count:sg.count!==false,active:true,ord:(Date.now()+(i++))%1e9,refs:refs,pdate:date,src:'factuur'};
        n.neu++;
      }else if(cost!=null&&P[pid].price==null)P[pid].price=cost;
    }
    L[x.id]={r:d.r,pid:pid,f:f};
  });
  return {loc:loc,P:P,SK:SK,L:L,n:n,now:now};
}
function approve(inv){
  var a=buildApprove(inv),jobs=Promise.resolve();
  if(Object.keys(a.P).length)jobs=jobs.then(function(){return write('catalog/'+a.loc,{loc:a.loc,items:a.P})});
  if(Object.keys(a.SK).length)jobs=jobs.then(function(){return write('inkoop/'+a.loc,{skip:a.SK})});
  return jobs.then(function(){return patchInv(inv,{st:'v',at:a.now,by:me(),L:a.L})}).then(function(){return a.n});
}
function needName(){if(me())return false;toast('Vul eerst je naam in, bovenaan de pagina.');var el=$('#naam');if(el)el.focus();return true}
function doApprove(fid){
  var inv=findInv(fid);if(!inv||S.busy||needName())return;
  if(inv.loc==='onbekend'){toast('Kies eerst de locatie van deze factuur.');return}
  S.busy=true;render();
  approve(inv).then(function(n){S.busy=false;S.open=null;render();
    toast('Factuur verwerkt: '+n.neu+' nieuw, '+n.upd+' bijgewerkt'+(n.skip?', '+n.skip+' geen voorraad':'')+'.');
  },function(){S.busy=false;render();saveErr()});
}
/* in één keer: alle facturen waar niets meer te kiezen valt (alles bekend of geen voorraad, geen vreemde prijzen) */
function easy(loc){return pending(loc).filter(function(inv){var t=tally(inv);return t.neu===0&&t.odd===0&&(t.link+t.skip)>0})}
function doApproveEasy(){
  if(S.busy||needName())return;
  var list=easy(S.loc),done=0;if(!list.length)return;
  S.busy=true;render();
  var p=Promise.resolve();
  list.forEach(function(inv){p=p.then(function(){var cur=findInv(inv.fid);return cur?approve(cur).then(function(){done++}):null})});
  p.then(function(){S.busy=false;render();toast(done+' facturen verwerkt.')},function(){S.busy=false;render();saveErr()});
}
function moveTo(fid,loc){
  var inv=findInv(fid);if(!inv||S.busy)return;
  var week=inv.doc.split('_').slice(1).join('_'),copy=JSON.parse(JSON.stringify(inv.v)),f={};f[fid]=copy;
  S.busy=true;
  write('inkooplog/'+loc+'_'+week,{f:f}).then(function(){return patchInv(inv,{gone:new Date().toISOString(),L:null,sup:inv.v.sup})})
    .then(function(){S.busy=false;render();toast('Factuur staat nu bij '+LOCS[loc]+'.')},function(){S.busy=false;render();saveErr()});
}

/* ---------- weergave ---------- */
function setChrome(){
  var h='';Object.keys(LOCS).forEach(function(l){
    var n=pending(l).length;if(l==='onbekend'&&!n&&S.loc!=='onbekend')return;
    h+='<button type="button" data-loc="'+l+'" aria-pressed="'+(l===S.loc)+'">'+esc(LOCS[l])+(n?' <span class="tcount">'+n+'</span>':'')+'</button>'});
  $('#locseg').innerHTML=h;
  document.body.setAttribute('data-loc',S.loc==='altstadt'?'altstadt':'floats');
  $all('.tabs a').forEach(function(a){if(a.getAttribute('href')==='#'+S.view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
}
function ready(){return S.logsOk&&S.catOk.floats&&S.catOk.altstadt}
function render(){
  if(!ready())return;
  var ae=document.activeElement;
  if(ae&&$('#view').contains(ae)&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))return;
  setChrome();
  var y=window.scrollY;
  $('#view').innerHTML=S.view==='verwerkt'?viewDone():S.view==='overig'?viewOther():viewReview();
  window.scrollTo(0,y);
}
function invHead(inv,extra){
  var v=inv.v;
  return '<span class="ititle"><b>'+esc(v.sup||'Onbekende leverancier')+'</b>'+(v.kind==='c'?' <span class="pill warn">creditnota</span>':'')
    +'<span class="isub">'+esc([v.no?'nr. '+v.no:'',dateLabel(v.date||v.sent),v.cust?v.cust.split(/\s{2,}|,/)[0].slice(0,40):''].filter(Boolean).join(' · '))+'</span>'
    +(extra?'<span class="isub">'+extra+'</span>':'')+'</span>'
    +'<span class="itotal num">'+(typeof v.total==='number'?eur(v.total):'')+'</span>';
}
function lineHtml(inv,x,ro){
  var l=x.l,loc=inv.loc,d=ro?{r:l.r,pid:l.pid,f:l.f}:decide(inv,l),it=items(loc),pill,name,sub='';
  var qty=typeof l.q==='number'?num(l.q)+' × ':'',fact=esc(l.d||'')+(l.a?' · art. '+esc(l.a):'')+([l.p,l.c].filter(Boolean).length?' · '+esc([l.p,l.c].filter(Boolean).join(' '))+'':'');
  var money=(typeof l.e==='number'?qty+eur(l.e):'')+(typeof l.n==='number'?' = '+eur(l.n):'');
  if(d.r==='skip'){pill='<span class="pill">Geen voorraad</span>';name=esc(sentence(l.d))}
  else if(d.r==='link'&&it[d.pid]){
    var p=it[d.pid],c=unitCost(l,d.f),ch=c!=null&&typeof p.price==='number'&&Math.abs(c-p.price)>0.004;
    pill='<span class="pill good">Bekend</span>';name=esc(p.name)+' <span class="muted">'+esc(p.unit||'')+'</span>';
    sub=ro?'':(c==null?'Geen prijs op deze regel':('Prijs per '+esc(p.unit||'stuk')+': '+eur(c)+(ch?' <span class="'+(odd(p.price,c)?'ibad':'iwarn')+'">(was '+eur(p.price)+(odd(p.price,c)?', controleer de eenheid':'')+')</span>':'')));
  }else if(d.r==='link'){pill='<span class="pill">Product verwijderd</span>';name=esc(sentence(l.d))}
  else{
    var sg=d.sg||proposal(inv,l),c2=unitCost(l,sg.f);
    pill='<span class="pill warn">Nieuw</span>';name=esc(sg.name)+' <span class="muted">'+esc(sg.unit)+'</span>';
    sub=esc(deptLabel(sg.dept))+' · '+esc(sg.cat)+(c2!=null?' · '+eur(c2)+' per '+esc(sg.unit):'')+(sg.count===false?' · telt niet mee':'');
  }
  return '<li class="iline">'+(ro?'<div class="imain">':'<button type="button" class="imain" data-line="'+esc(x.id)+'" data-fid="'+esc(inv.fid)+'">')
    +'<span class="iname">'+pill+' '+name+'</span>'+(sub?'<span class="isub2">'+sub+'</span>':'')
    +'<span class="ifact">'+fact+(money?' · <span class="num">'+money+'</span>':'')+'</span>'
    +(ro?'</div>':'</button><span class="chev" aria-hidden="true">›</span>')+'</li>';
}
function invCard(inv,ro){
  var t=tally(inv),open=S.open===inv.fid,v=inv.v,h,extra;
  if(ro){var np=prodLines(inv).length;extra=np+' product'+(np===1?'':'en')+(v.by?' · verwerkt door '+esc(v.by):'')+(v.at?' op '+dateLabel(v.at):'')}
  else extra=[t.neu?'<b class="iwarn">'+t.neu+' nieuw</b>':'',t.link?t.link+' bekend':'',t.skip?t.skip+' geen voorraad':'',t.odd?'<b class="ibad">'+t.odd+' prijs controleren</b>':''].filter(Boolean).join(' · ')||'geen productregels';
  h='<section class="inv'+(open?' open':'')+'"><button type="button" class="ihead" data-open="'+esc(inv.fid)+'" aria-expanded="'+open+'"><span class="chev" aria-hidden="true">›</span>'+invHead(inv,extra)+'</button>';
  if(open){
    h+='<div class="ibody">';
    if(v.note)h+='<p class="inote muted">'+esc(v.note)+'</p>';
    if(!ro&&inv.loc==='onbekend')h+='<div class="note warn spread"><span>Op deze factuur staat geen locatie. Voor welke locatie is dit?</span><span class="rowflex"><button class="btn" data-move="floats" data-fid="'+esc(inv.fid)+'">FLOATS</button><button class="btn" data-move="altstadt" data-fid="'+esc(inv.fid)+'">ALTSTADT</button></span></div>';
    var pl=prodLines(inv);
    h+=pl.length?'<ul class="ilines">'+pl.map(function(x){return lineHtml(inv,x,ro||inv.loc==='onbekend')}).join('')+'</ul>':'<p class="inote muted">Op deze factuur staan geen productregels.</p>';
    if(t.other)h+='<p class="inote muted">'+t.other+' regel'+(t.other===1?'':'s')+' emballage, statiegeld of toeslag (niet in de voorraad).</p>';
    if(!ro)h+='<div class="ifoot spread"><button class="btn ghost" data-nostock="'+esc(inv.fid)+'"'+(S.busy?' disabled':'')+'>Hele factuur is geen voorraad</button>'
      +(inv.loc==='onbekend'?'':'<button class="btn primary" data-approve="'+esc(inv.fid)+'"'+(S.busy?' disabled':'')+'>Goedkeuren'+(t.neu?' · '+t.neu+' nieuw':'')+'</button>')+'</div>';
    else if(v.st==='v')h+='<div class="ifoot"><span class="muted" style="font-size:13px">De producten staan in de productlijst van '+esc(LOCS[inv.loc])+'.</span></div>';
    h+='</div>';
  }
  return h+'</section>';
}
function nameRow(){return '<div class="field" style="max-width:320px"><label for="naam">Je naam</label><input class="input" id="naam" autocomplete="name" value="'+esc(me())+'" placeholder="Wie beoordeelt er?"></div>'}
function viewReview(){
  var list=pending(S.loc),h='<section class="stack">',tot={neu:0,link:0,skip:0};
  var uniq={};list.forEach(function(inv){var t=tally(inv);Object.keys(t.keys).forEach(function(k){uniq[k]=1});tot.link+=t.link;tot.skip+=t.skip});tot.neu=Object.keys(uniq).length;
  h+='<div class="spread"><div><h2>Te beoordelen · '+esc(LOCS[S.loc])+'</h2><span class="muted">'+(list.length?list.length+' factu'+(list.length===1?'ur':'ren')+' · '+tot.neu+' nieuwe product'+(tot.neu===1?'':'en')+', '+tot.link+' regel'+(tot.link===1?'':'s')+' van bekende producten':'Niets te doen')+'</span></div></div>';
  if(!list.length){h+='<div class="card empty"><h3>Alles is beoordeeld</h3><p>Nieuwe facturen verschijnen hier vanzelf na de dagelijkse ronde van 12:00.</p></div></section>';return h}
  h+=nameRow();
  if(S.loc==='onbekend')h+='<div class="note">Op deze bonnen en facturen staat niet voor welke locatie ze zijn. Open er één en kies FLOATS of ALTSTADT; daarna kun je hem daar beoordelen.</div>';
  else{
    h+='<details class="help card"><summary>Zo werkt het</summary><ol><li><b>Open een factuur.</b> Bij elke regel staat wat ermee gebeurt: bekend product (de prijs wordt bijgewerkt), nieuw product, of geen voorraad.</li>'
      +'<li><b>Tik op een regel om het aan te passen:</b> naam, afdeling, categorie, tel-eenheid, of koppel hem aan een product dat al bestaat.</li>'
      +'<li><b>Goedkeuren.</b> Pas dan komen de producten en prijzen in de productlijst. De volgende keer wordt dezelfde regel vanzelf herkend.</li></ol></details>';
    var e=easy(S.loc);
    if(e.length)h+='<div class="note good spread"><span>'+e.length+' factu'+(e.length===1?'ur bevat':'ren bevatten')+' alleen bekende producten.</span><button class="btn" id="easy"'+(S.busy?' disabled':'')+'>In één keer verwerken</button></div>';
  }
  h+='</section><div class="invs">'+list.map(function(inv){return invCard(inv,false)}).join('')+'</div>';
  return h;
}
function viewDone(){
  var list=invoices().filter(function(x){return x.loc===S.loc&&x.v.st==='v'}).reverse();
  var h='<section class="stack"><div><h2>Verwerkt · '+esc(LOCS[S.loc])+'</h2><span class="muted">'+list.length+' factu'+(list.length===1?'ur':'ren')+'</span></div>';
  if(!list.length)return h+'<div class="card empty"><h3>Nog niets verwerkt</h3><p>Goedgekeurde facturen komen hier te staan.</p></div></section>';
  return h+'</section><div class="invs">'+list.slice(0,150).map(function(inv){return invCard(inv,true)}).join('')+'</div>';
}
function viewOther(){
  var all=invoices().filter(function(x){return x.loc===S.loc&&isOther(x)}).reverse();
  var d=all.filter(function(x){return x.v.kind!=='x'}),xl=all.filter(function(x){return x.v.kind==='x'});
  var h='<section class="stack"><div><h2>Overig · '+esc(LOCS[S.loc])+'</h2><span class="muted">Wat niet in de voorraad komt</span></div>';
  function rows(list,btn){return '<ul class="rows">'+list.map(function(inv){var v=inv.v;return '<li class="orow"><span class="ititle"><b>'+esc(v.sup||v.subj||'Onbekend')+'</b><span class="isub">'+esc([v.no?'nr. '+v.no:'',dateLabel(v.date||v.sent),v.subj&&!v.no?v.subj:''].filter(Boolean).join(' · '))+'</span></span><span class="itotal num">'+(typeof v.total==='number'?eur(v.total):'')+'</span>'+(btn?'<button class="btn" data-review="'+esc(inv.fid)+'">Toch beoordelen</button>':'')+'</li>'}).join('')+'</ul>'}
  if(xl.length)h+='<h3>Niet te lezen ('+xl.length+')</h3><p class="muted" style="max-width:65ch">Scans en foto\'s van kassabonnen waar de ronde geen regels uit kon halen. Staat er iets op dat in de voorraad hoort, voeg het product dan met de hand toe bij Voorraad › Producten.</p>'+rows(xl,false);
  if(d.length)h+='<h3>Diensten en overgeslagen facturen ('+d.length+')</h3><p class="muted" style="max-width:65ch">Schoonmaak, linnen, software, energie en dergelijke: geen producten voor de voorraad.</p>'+rows(d,true);
  if(!all.length)h+='<div class="card empty"><h3>Niets</h3><p>Hier komen diensten en onleesbare bonnen te staan.</p></div>';
  return h+'</section>';
}

/* ---------- een regel aanpassen ---------- */
function catOptions(sel,loc){
  var extra=[];Object.keys(items(loc)).forEach(function(k){var c=items(loc)[k].cat;if(c&&CATS.indexOf(c)<0&&extra.indexOf(c)<0)extra.push(c)});
  if(sel&&CATS.indexOf(sel)<0&&extra.indexOf(sel)<0)extra.push(sel);
  function o(c){return '<option'+(c===sel?' selected':'')+'>'+esc(c)+'</option>'}
  return GROUPS.map(function(g){return '<optgroup label="'+esc(g.label)+'">'+g.cats.map(o).join('')+'</optgroup>'}).join('')+(extra.length?'<optgroup label="Eigen">'+extra.map(o).join('')+'</optgroup>':'');
}
function openLine(fid,lid){
  var inv=findInv(fid);if(!inv)return;var l=(inv.v.L||{})[lid];if(!l)return;
  var d=decide(inv,l),sg=d.sg||proposal(inv,l),f=d.r==='link'?d.f:sg.f;
  S.pq='';S.edit={fid:fid,lid:lid,mode:d.r,pid:d.pid||null};
  var h='<h2>Factuurregel</h2><p class="muted" style="margin:0">'+esc(l.d||'')+(l.a?' · art. '+esc(l.a):'')+'<br>'+esc([l.p,l.c].filter(Boolean).join(' '))
    +(typeof l.q==='number'?' · geleverd '+num(l.q):'')+(typeof l.e==='number'?' · '+eur(l.e)+' per eenheid':'')+(typeof l.n==='number'?' · regel '+eur(l.n):'')+'</p>'
    +'<div class="seg soft" id="l-mode" role="group" aria-label="Wat is dit"><button type="button" data-mode="new" aria-pressed="'+(d.r==='new')+'">Nieuw product</button><button type="button" data-mode="link" aria-pressed="'+(d.r==='link')+'">Bestaand product</button><button type="button" data-mode="skip" aria-pressed="'+(d.r==='skip')+'">Geen voorraad</button></div>'
    +'<div id="l-new" class="stack"'+(d.r==='new'?'':' hidden')+'>'
    +'<div class="field"><label for="l-name">Naam</label><input class="input" id="l-name" autocomplete="off" value="'+esc(sg.name)+'"></div>'
    +'<div class="grid2"><div class="field"><label for="l-dept">Afdeling</label><select class="input" id="l-dept">'+DEPTS.map(function(x){return '<option value="'+x.key+'"'+(x.key===sg.dept?' selected':'')+'>'+esc(x.label)+'</option>'}).join('')+'</select></div>'
    +'<div class="field"><label for="l-cat">Categorie</label><select class="input" id="l-cat">'+catOptions(sg.cat,inv.loc)+'</select></div></div>'
    +'<div class="field"><label for="l-unit">Tel-eenheid</label><input class="input" id="l-unit" value="'+esc(sg.unit)+'" placeholder="bv. fles 50 cl, zak 1 kg, kg"><small>Wat je in de voorraad als 1 telt.</small></div>'
    +'<label class="rowflex"><input type="checkbox" id="l-count"'+(sg.count===false?'':' checked')+' style="width:20px;height:20px"> <span>Meetellen in de voorraadtelling</span></label></div>'
    +'<div id="l-link" class="stack"'+(d.r==='link'?'':' hidden')+'><div class="field"><label for="l-q">Zoek het product in '+esc(LOCS[inv.loc]||'')+'</label><input class="input" id="l-q" type="search" placeholder="bv. cola of gin" autocomplete="off"></div><div id="l-list" class="picklist"></div></div>'
    +'<div id="l-f" class="field"'+(d.r==='skip'?' hidden':'')+'><label for="l-fval">Aantal tel-eenheden per factuureenheid</label><input class="input" id="l-fval" inputmode="decimal" value="'+esc(inStr(f))+'"><small id="l-cost"></small></div>'
    +'<div id="l-skip" class="stack"'+(d.r==='skip'?'':' hidden')+'><label class="rowflex"><input type="checkbox" id="l-rem"'+(d.rem===false&&!d.auto?'':' checked')+' style="width:20px;height:20px"> <span>Onthouden: deze regel is ook op volgende facturen geen voorraad</span></label></div>'
    +'<div class="note bad" id="l-err" hidden></div>'
    +'<div class="spread"><button class="btn ghost" data-close>Annuleren</button><button class="btn primary" id="l-save">Opslaan</button></div>';
  openModal(h);pickList();costHint();
}
function pickList(){
  var el=$('#l-list');if(!el||!S.edit)return;var inv=findInv(S.edit.fid);if(!inv)return;
  var it=items(inv.loc),q=S.pq.trim().toLowerCase(),a=Object.keys(it).map(function(id){return {id:id,p:it[id]}}).filter(function(x){return x.p&&x.p.active!==false&&(!q||(x.p.name+' '+(x.p.unit||'')+' '+(x.p.sup||'')+' '+(x.p.cat||'')).toLowerCase().indexOf(q)>=0)});
  a.sort(function(x,y){return (x.id===S.edit.pid?-1:0)-(y.id===S.edit.pid?-1:0)||String(x.p.name).localeCompare(String(y.p.name),'nl')});
  el.innerHTML=a.length?a.slice(0,40).map(function(x){return '<button type="button" class="pick" data-pick="'+esc(x.id)+'" aria-pressed="'+(x.id===S.edit.pid)+'"><b>'+esc(x.p.name)+'</b><span class="muted">'+esc([x.p.unit,deptLabel(x.p.dept||'bar'),x.p.sup].filter(Boolean).join(' · '))+'</span></button>'}).join('')+(a.length>40?'<p class="muted" style="font-size:13px">Meer dan 40 producten: typ om te zoeken.</p>':''):'<p class="muted">Geen product gevonden.</p>';
}
function costHint(){
  var el=$('#l-cost');if(!el||!S.edit)return;var inv=findInv(S.edit.fid);if(!inv)return;var l=inv.v.L[S.edit.lid],f=parseNum($('#l-fval').value);
  var c=f>0?unitCost(l,f):null,unit=S.edit.mode==='link'&&S.edit.pid&&items(inv.loc)[S.edit.pid]?items(inv.loc)[S.edit.pid].unit:$('#l-unit').value;
  el.textContent='Voorbeeld: doos van 24 flesjes = 24. '+(c!=null?'Inkoopprijs wordt '+eur(c)+' per '+(unit||'tel-eenheid')+'.':'');
}
function setMode(m){
  S.edit.mode=m;$all('#l-mode button').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.mode===m?'true':'false')});
  $('#l-new').hidden=m!=='new';$('#l-link').hidden=m!=='link';$('#l-skip').hidden=m!=='skip';$('#l-f').hidden=m==='skip';costHint();
}
function saveLine(){
  var e=S.edit,inv=findInv(e.fid),err=$('#l-err');if(!inv)return;
  function bad(m){err.textContent=m;err.hidden=false}
  var p={r:e.mode},f=parseNum($('#l-fval').value);
  if(e.mode!=='skip'&&!(f>0))return bad('Vul in hoeveel tel-eenheden er in één factuureenheid zitten, bv. 1 of 24.');
  if(e.mode==='new'){
    var name=$('#l-name').value.trim(),unit=$('#l-unit').value.trim();
    if(!name)return bad('Vul een naam in.');if(!unit)return bad('Vul de tel-eenheid in, bv. fles 50 cl.');
    p.sg={name:name.slice(0,80),cat:$('#l-cat').value,dept:$('#l-dept').value,unit:unit.slice(0,40),f:f,count:$('#l-count').checked};p.pid=null;
  }else if(e.mode==='link'){
    if(!e.pid)return bad('Kies het product waar deze regel bij hoort.');
    p.pid=e.pid;p.f=f;
  }else p.rem=$('#l-rem').checked;
  var L={};L[e.lid]=p;var b=$('#l-save');b.disabled=true;b.textContent='Opslaan…';
  patchInv(inv,{L:L}).then(function(){closeModal();render()},function(){b.disabled=false;b.textContent='Opslaan';bad('Opslaan is niet gelukt. Controleer je verbinding en probeer het opnieuw.')});
}

/* ---------- gebeurtenissen ---------- */
function setView(v){if(VIEWS.indexOf(v)<0)return;S.view=v;S.open=null;render();window.scrollTo(0,0)}
document.addEventListener('click',function(ev){
  var t=ev.target,b;
  if((b=t.closest('.tabs a[href^="#"]'))){var hv=b.getAttribute('href').slice(1);if(VIEWS.indexOf(hv)>=0){ev.preventDefault();setView(hv);try{if(location.hash!=='#'+hv)location.hash=hv}catch(x){}}return}
  if((b=t.closest('#locseg button'))){S.loc=b.dataset.loc;ls('inkooploc',S.loc);S.open=null;if(document.activeElement)document.activeElement.blur();render();return}
  if(t.closest('[data-close]')){closeModal();return}
  if((b=t.closest('[data-open]'))){var id=b.getAttribute('data-open');S.open=S.open===id?null:id;render();return}
  if((b=t.closest('[data-line]'))){openLine(b.getAttribute('data-fid'),b.getAttribute('data-line'));return}
  if((b=t.closest('[data-approve]'))){doApprove(b.getAttribute('data-approve'));return}
  if((b=t.closest('[data-move]'))){moveTo(b.getAttribute('data-fid'),b.getAttribute('data-move'));return}
  if((b=t.closest('[data-nostock]'))){var inv=findInv(b.getAttribute('data-nostock'));if(inv)patchInv(inv,{st:'o'}).then(function(){S.open=null;render();toast('Factuur staat nu onder Overig.')},saveErr);return}
  if((b=t.closest('[data-review]'))){var iv=findInv(b.getAttribute('data-review'));if(iv)patchInv(iv,iv.v.kind==='c'?{st:'n2'}:{st:'n',kind:'p'}).then(function(){toast('Factuur staat weer bij Te beoordelen.');render()},saveErr);return}
  if(t.closest('#easy')){doApproveEasy();return}
  if((b=t.closest('#l-mode button'))){setMode(b.dataset.mode);if(b.dataset.mode==='link')pickList();return}
  if((b=t.closest('[data-pick]'))){S.edit.pid=b.getAttribute('data-pick');pickList();costHint();return}
  if(t.closest('#l-save')){saveLine();return}
});
document.addEventListener('change',function(ev){var el=ev.target;if(el.id==='naam'){var v=el.value.trim();el.value=v;ls('naam',v);if(v)$('#toast').hidden=true}});
var qT;
document.addEventListener('input',function(ev){
  var el=ev.target;
  if(el.id==='l-q'){S.pq=el.value;clearTimeout(qT);qT=setTimeout(pickList,150);return}
  if(el.id==='l-fval'||el.id==='l-unit'){costHint()}
});
document.addEventListener('keydown',function(ev){
  if(ev.key==='Escape'&&modalOpen()){closeModal();return}
  if(ev.key==='Enter'&&ev.target.id==='naam'){ev.preventDefault();ev.target.blur()}
});
$('#modal').addEventListener('click',function(ev){if(ev.target===this)closeModal()});
window.addEventListener('hashchange',function(){var v=location.hash.slice(1);if(v&&v!==S.view)setView(v)});

/* ---------- start ---------- */
function fail(t,p){$('#view').innerHTML='<div class="empty"><h3>'+esc(t)+'</h3><p>'+esc(p)+'</p></div>'}
var hv0=location.hash.slice(1);if(VIEWS.indexOf(hv0)>=0)S.view=hv0;
if(LOCS[ls('inkooploc')])S.loc=ls('inkooploc');
if(!window.claude||!window.claude.use){fail('De website is niet goed geladen','Laad de pagina opnieuw. Blijft dit terugkomen, meld het bij de eigenaar.');return}
window.claude.use('db').then(function(db){
  S.db=db;
  if(!db){fail('De website is niet goed geladen','Laad de pagina opnieuw. Blijft dit terugkomen, meld het bij de eigenaar.');return}
  ['floats','altstadt'].forEach(function(loc){
    db.doc('catalog/'+loc).onSnapshot(function(s){S.cat[loc]=s.exists?s.data():{items:{}};S.catOk[loc]=true;render()});
    db.doc('inkoop/'+loc).onSnapshot(function(s){S.cfg[loc]=s.exists?s.data():null;render()});
  });
  db.collection('inkooplog').limit(1000).onSnapshot(function(qs){
    var o={};qs.docs.forEach(function(d){o[d.id]=d.data()});
    S.logs=o;S.logsOk=true;
    if(!pending(S.loc).length&&S.view==='beoordelen'){var alt=['floats','altstadt','onbekend'].filter(function(l){return pending(l).length})[0];if(alt&&!S.switched){S.loc=alt}}
    S.switched=true;render();
  });
});
})();
