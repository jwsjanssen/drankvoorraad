/* Menu bovenaan elke pagina: één knop linksboven met alle onderdelen (drankvoorraad en de vier temperatuurpagina's).
   Wordt op elke pagina geladen; de opmaak staat in menu.css. */
(function(){
'use strict';
var top=document.querySelector('.top'),brand=document.querySelector('.top .brand');
if(!top||!brand)return;
var here=document.body.getAttribute('data-page')||'',base=here?'../':'';
var ITEMS=[
  {group:'Drankvoorraad'},
  {key:'',href:base||'./',label:'Voorraad tellen en bestellen',sub:'FLOATS en ALTSTADT'},
  {group:'Temperaturen'},
  {key:'floats-keuken',href:base+'floats-keuken/',label:'FLOATS keuken',sub:'Koelingen en vriezers'},
  {key:'floats-bar',href:base+'floats-bar/',label:'FLOATS bar',sub:'Koelingen'},
  {key:'altstadt-keuken',href:base+'altstadt-keuken/',label:'ALTSTADT keuken',sub:'Koelingen en vriezers'},
  {key:'altstadt-bar',href:base+'altstadt-bar/',label:'ALTSTADT bar',sub:'Koelingen'}
];

var btn=document.createElement('button');
btn.type='button';btn.id='menu-btn';btn.className='menu-btn';
btn.setAttribute('aria-expanded','false');btn.setAttribute('aria-controls','menu-panel');
btn.innerHTML='<span class="menu-ico" aria-hidden="true"><i></i><i></i><i></i></span><span class="menu-txt">Menu</span>';
brand.insertBefore(btn,brand.firstChild);
top.classList.add('has-menu');

var h='<div class="wrap"><nav class="menu-card" aria-label="Alle onderdelen">';
ITEMS.forEach(function(it){
  if(it.group){h+='<div class="menu-group">'+it.group+'</div>';return}
  var cur=it.key===here;
  h+='<a class="menu-link" href="'+it.href+'"'+(cur?' aria-current="page"':'')+'><span><b>'+it.label+'</b><small>'+it.sub+'</small></span>'
    +(cur?'<span class="menu-here">Je bent hier</span>':'<span class="menu-go" aria-hidden="true">›</span>')+'</a>';
});
h+='</nav></div>';
var panel=document.createElement('div');
panel.id='menu-panel';panel.className='menu-panel';panel.hidden=true;panel.innerHTML=h;
top.appendChild(panel);

function isOpen(){return !panel.hidden}
function open(){panel.hidden=false;btn.setAttribute('aria-expanded','true');var f=panel.querySelector('a');if(f)f.focus()}
function close(focusBtn){if(!isOpen())return;panel.hidden=true;btn.setAttribute('aria-expanded','false');if(focusBtn)btn.focus()}
btn.addEventListener('click',function(ev){ev.stopPropagation();if(isOpen())close();else open()});
panel.addEventListener('click',function(ev){
  var a=ev.target.closest('a');
  /* buiten de kaart getikt, of op de pagina waar je al bent: alleen sluiten */
  if(!a){if(!ev.target.closest('.menu-card'))close();return}
  if(a.getAttribute('aria-current')==='page'){ev.preventDefault();close(true)}
});
document.addEventListener('click',function(ev){if(isOpen()&&!ev.target.closest('.top'))close()});
document.addEventListener('keydown',function(ev){if(ev.key==='Escape'&&isOpen()){ev.stopPropagation();close(true)}},true);
})();
