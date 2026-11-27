/* Adres en publieke sleutel van het Supabase-project. De publieke sleutel hoort in de website te staan;
   wat ermee mag, wordt in de database zelf geregeld (zie supabase/schema.sql).

   Twee omgevingen in hetzelfde project:
   - echt: alleen op www.kadehoreca.nl, tabellen en functies met voorvoegsel voorraad_
   - test: overal anders (de testsite en je eigen computer), voorvoegsel voorraadtest_
   De testomgeving heeft eigen gegevens, eigen sessies en een eigen toegangscode. */
(function(){
  var live=/^(www\.)?kadehoreca\.nl$/.test(location.hostname);
  window.DV_CONFIG={
    url:"https://pxsnwlndpizepylzxfym.supabase.co",
    key:"sb_publishable_2xfGiDDZ80UKW2Ipw_1miA_abskCGdZ",
    test:!live,
    prefix:live?"voorraad":"voorraadtest"
  };
})();
