#!/usr/bin/env python3
"""Maakt de SQL voor de testomgeving: dezelfde structuur als schema.sql, maar met voorvoegsel voorraadtest_.
Zo kun je een wijziging in schema.sql eerst op de testgegevens uitproberen.

  python3 supabase/maak-test-sql.py            structuur van de testomgeving (opnieuw uitvoeren kan zonder schade)
  python3 supabase/maak-test-sql.py --kopie    daarna: testgegevens vervangen door een verse kopie van de echte

Plak de uitvoer in de SQL Editor van Supabase. De echte tabellen (voorraad_) worden alleen gelezen, nooit gewijzigd.
De toegangscode van de testsite stel je apart in:  select public.voorraadtest_code_instellen('....');
"""
import os, sys
here = os.path.dirname(os.path.abspath(__file__))
sql = open(os.path.join(here, 'schema.sql'), encoding='utf-8').read().replace('voorraad_', 'voorraadtest_')
if '--kopie' in sys.argv:
    sql = """-- Testgegevens vervangen door een verse kopie van de echte gegevens.
delete from public.voorraadtest_docs_history;
delete from public.voorraadtest_docs;
insert into public.voorraadtest_docs (path, data) select path, data from public.voorraad_docs;
select count(*) as gekopieerd from public.voorraadtest_docs;
"""
print(sql)
