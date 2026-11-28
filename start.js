/* Startpagina: na het inloggen zie je hier wat bij jouw afdeling hoort. Management ziet alles.
   Wie er is ingelogd staat in window.DV_SESSION (backend.js); de plekken komen uit plekken.js. */
(function(){
'use strict';
var SES=window.DV_SESSION||null,PLEKKEN=window.DV_PLEKKEN||[];
var view=document.getElementById('view'),where=document.getElementById('where');
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
if(!SES){view.innerHTML='';if(where)where.hidden=true;return}   /* niet ingelogd: het inlogscherm staat ervoor */
if(where)where.textContent=SES.label;
if(SES.loc)document.body.setAttribute('data-loc',SES.loc);
function tile(href,title,sub){return '<a class="tile" href="'+href+'"><span><b>'+esc(title)+'</b><small>'+esc(sub)+'</small></span><span class="menu-go" aria-hidden="true">›</span></a>'}
function plekTiles(p){
  var h='';
  if(p.park)h+=tile('parkeren/?p='+p.key,'Parkeren','Plekken, kentekens, borg en sleutels');
  h+=tile('checklijst/?p='+p.key,'Checklijsten','Openen, sluiten en schoonmaak');
  if(p.temp)h+=tile(p.key+'/','Temperaturen','Koelingen en vriezers, elke dag');
  if(p.haccp)h+=tile('haccp/?p='+p.key,'HACCP','Leveringen, kerntemperaturen, terugkoelen en frituur');
  return h;
}
var h='';
if(!SES.mgmt){
  var p=PLEKKEN.filter(function(x){return x.key===SES.plek})[0];
  h='<section class="stack"><div><h2>'+esc(SES.label)+'</h2><span class="muted">Kies wat je wilt doen.</span></div>'
    +'<div class="tiles">'+plekTiles(p)+tile('voorraad/','Voorraad','Tellen, bestellen en de producten van je afdeling')+'</div></section>';
}else{
  h='<section class="stack"><div><h2>Management</h2><span class="muted">Alle locaties en afdelingen.</span></div>'
    +'<div class="tiles">'+tile('voorraad/','Voorraad','Tellen, bestellen en producten, per locatie en afdeling')+tile('inkoop/','Inkoop uit facturen','Nieuwe producten en prijzen beoordelen')+'</div></section>';
  var loc='';
  PLEKKEN.forEach(function(p,i){
    if(p.loc!==loc){if(loc)h+='</div></section>';loc=p.loc;h+='<section class="stack"><h3>'+esc(loc)+'</h3><div class="card plekcard">'}
    h+='<div class="menu-plek"><b>'+esc(p.area)+'</b><span class="menu-chips">'
      +(p.park?'<a class="menu-chip" href="parkeren/?p='+p.key+'">Parkeren</a>':'')
      +'<a class="menu-chip" href="checklijst/?p='+p.key+'">Checklijsten</a>'
      +(p.temp?'<a class="menu-chip" href="'+p.key+'/">Temperaturen</a>':'')
      +(p.haccp?'<a class="menu-chip" href="haccp/?p='+p.key+'">HACCP</a>':'')
      +'</span></div>';
  });
  if(loc)h+='</div></section>';
}
h+='<p class="muted startfoot">Ingelogd als <b>'+esc(SES.label)+'</b>. <button type="button" class="linkbtn" id="uitloggen">Uitloggen of andere afdeling</button></p>';
view.innerHTML=h;
document.getElementById('uitloggen').addEventListener('click',function(){SES.logout()});
/* controleren of de sessie nog geldig is: zo niet, dan komt het inlogscherm */
if(window.claude&&window.claude.use)window.claude.use('db').then(function(db){if(db)db.doc('geen/x').get().catch(function(){})});
})();
