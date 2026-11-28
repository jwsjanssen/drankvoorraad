/* De plekken (afdeling per locatie) en wat er per plek is. Gebruikt door het menu en de checklijsten.
   Een plek toevoegen: hier een regel erbij. temp:true = er is ook een temperatuurpagina (map <key>/);
   haccp:true = er zijn HACCP-registraties (leveringen, kerntemperaturen, terugkoelen, frituur);
   park:true = hier worden de parkeerplekken beheerd. */
window.DV_PLEKKEN=[
  {key:'floats-keuken',loc:'FLOATS',area:'Keuken',temp:true,haccp:true},
  {key:'floats-bar',loc:'FLOATS',area:'Bar',temp:true},
  {key:'floats-receptie',loc:'FLOATS',area:'Receptie',park:true},
  {key:'floats-housekeeping',loc:'FLOATS',area:'Housekeeping'},
  {key:'altstadt-keuken',loc:'ALTSTADT',area:'Keuken',temp:true,haccp:true},
  {key:'altstadt-bar',loc:'ALTSTADT',area:'Bar',temp:true}
];

/* Afdelingen en productcategorieën, gedeeld door de voorraad en de inkoop uit facturen.
   Een product zonder afdeling hoort bij de bar (zo is de drankvoorraad begonnen). */
window.DV_DEPTS=[
  {key:'bar',label:'Bar'},{key:'keuken',label:'Keuken'},{key:'housekeeping',label:'Housekeeping'},
  {key:'receptie',label:'Receptie'},{key:'algemeen',label:'Algemeen'}
];
window.DV_CATGROUPS=[
  {label:'Dranken',cats:['Tapbier','Flesbier','Alcoholvrij bier & kombucha','Fris & mixers','Water','Sappen & zuivel','Wijn wit','Wijn rosé','Wijn rood','Bubbels & dessertwijn','Gedistilleerd','Likeuren & aperitief','Koffie & thee','Siropen & bar']},
  {label:'Eten',cats:['Groente & fruit','Vlees & gevogelte','Vis & schaaldieren','Zuivel & eieren','Kaas','Brood & banket','Droogwaren & conserven','Oliën, sauzen & kruiden','Diepvries','Snacks & zoetwaren']},
  {label:'Non-food',cats:['Disposables & verpakking','Schoonmaak & hygiëne','Servies, glas & keukengerei','Kantoor & kassa','Gastenkamer & amenities','Onderhoud & techniek','Inventaris & apparatuur','Decoratie & bloemen','Overig']}
];
window.DV_CATS=[].concat.apply([],window.DV_CATGROUPS.map(function(g){return g.cats}));
