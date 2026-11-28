/* Menu bovenaan elke pagina: één knop linksboven met alle onderdelen.
   Opbouw: de voorraad (tellen en inkoop), en daaronder per locatie de plekken met wat er per plek is (temperaturen, checklijsten, HACCP, parkeren).
   De plekken komen uit plekken.js; de opmaak staat in menu.css. */
(function(){
'use strict';
var top=document.querySelector('.top'),brand=document.querySelector('.top .brand');
if(!top||!brand)return;
var PLEKKEN=window.DV_PLEKKEN||[];
var here=document.body.getAttribute('data-page')||(/[?&]p=([a-z0-9-]+)/.exec(location.search)||[])[1]||'';
var mod=document.body.getAttribute('data-module')||(here?'temp':'voorraad');   /* start | voorraad | inkoop | temp | check | haccp | park */
var base=mod==='start'?'':'../';
/* wie is er ingelogd: een afdeling ziet alleen haar eigen plek, management alles */
var SES=window.DV_SESSION||null,mgmt=!SES||SES.mgmt;
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

var btn=document.createElement('button');
btn.type='button';btn.id='menu-btn';btn.className='menu-btn';
btn.setAttribute('aria-expanded','false');btn.setAttribute('aria-controls','menu-panel');
btn.innerHTML='<span class="menu-ico" aria-hidden="true"><i></i><i></i><i></i></span><span class="menu-txt">Menu</span>';
brand.insertBefore(btn,brand.firstChild);
top.classList.add('has-menu');

function chip(label,href,cur){return '<a class="menu-chip" href="'+href+'"'+(cur?' aria-current="page"':'')+'>'+label+'</a>'}
function link(href,title,sub,cur){return '<a class="menu-link" href="'+href+'"'+(cur?' aria-current="page"':'')+'><span><b>'+title+'</b><small>'+sub+'</small></span>'+(cur?'<span class="menu-here">Je bent hier</span>':'<span class="menu-go" aria-hidden="true">›</span>')+'</a>'}
var h='<div class="wrap"><nav class="menu-card" aria-label="Alle onderdelen">'
  +link(base||'./','Start',SES?esc(SES.label):'Overzicht',mod==='start')
  +'<div class="menu-group">Voorraad</div>'
  +link(base+'voorraad/','Voorraad tellen en bestellen',mgmt?'FLOATS en ALTSTADT':'Van je eigen afdeling',mod==='voorraad')
  +(mgmt?link(base+'inkoop/','Inkoop uit facturen','Nieuwe producten en prijzen beoordelen',mod==='inkoop'):'');
var loc='';
PLEKKEN.forEach(function(p){
  if(!mgmt&&p.key!==SES.plek)return;
  if(p.loc!==loc){loc=p.loc;h+='<div class="menu-group">'+esc(loc)+'</div>'}
  var cur=p.key===here;
  h+='<div class="menu-plek'+(cur?' cur':'')+'"><b>'+esc(p.area)+'</b><span class="menu-chips">'
    +(p.park?chip('Parkeren',base+'parkeren/?p='+p.key,cur&&mod==='park'):'')
    +chip('Checklijsten',base+'checklijst/?p='+p.key,cur&&mod==='check')
    +(p.temp?chip('Temperaturen',base+p.key+'/',cur&&mod==='temp'):'')
    +(p.haccp?chip('HACCP',base+'haccp/?p='+p.key,cur&&mod==='haccp'):'')
    +'</span></div>';
});
if(SES)h+='<div class="menu-foot"><span>Ingelogd als <b>'+esc(SES.label)+'</b></span><button type="button" class="menu-out" id="menu-out">Uitloggen</button></div>';
h+='</nav></div>';
var panel=document.createElement('div');
panel.id='menu-panel';panel.className='menu-panel';panel.hidden=true;panel.innerHTML=h;
top.appendChild(panel);

function isOpen(){return !panel.hidden}
function open(){panel.hidden=false;btn.setAttribute('aria-expanded','true');var f=panel.querySelector('a');if(f)f.focus()}
function close(focusBtn){if(!isOpen())return;panel.hidden=true;btn.setAttribute('aria-expanded','false');if(focusBtn)btn.focus()}
btn.addEventListener('click',function(ev){ev.stopPropagation();if(isOpen())close();else open()});
panel.addEventListener('click',function(ev){
  if(ev.target.closest('#menu-out')){if(SES&&SES.logout)SES.logout();return}
  var a=ev.target.closest('a');
  /* buiten de kaart getikt, of op de pagina waar je al bent: alleen sluiten */
  if(!a){if(!ev.target.closest('.menu-card'))close();return}
  ev.stopPropagation();
  if(a.getAttribute('aria-current')==='page'){ev.preventDefault();close(true)}
});
document.addEventListener('click',function(ev){if(isOpen()&&!ev.target.closest('.top'))close()});
document.addEventListener('keydown',function(ev){if(ev.key==='Escape'&&isOpen()){ev.stopPropagation();close(true)}},true);
})();
