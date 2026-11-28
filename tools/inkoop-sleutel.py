#!/usr/bin/env python3
"""Maakt de sleutel waarmee de dagelijkse inkoopronde facturen mag aanleveren.

  python3 tools/inkoop-sleutel.py          sleutel voor de testomgeving
  python3 tools/inkoop-sleutel.py --live   sleutel voor de echte site

De sleutel zelf komt alleen op deze computer te staan, in ~/.kadehoreca/ (niet in de projectmap,
dus ook nooit in de openbare code). Het script toont alleen de hash en de SQL-regel waarmee je die
hash in de database zet (SQL Editor van Supabase). Bestaat de sleutel al, dan blijft hij staan.
"""
import hashlib, os, secrets, sys

live = '--live' in sys.argv
naam = 'live' if live else 'test'
voorvoegsel = 'voorraad' if live else 'voorraadtest'
map_ = os.path.expanduser('~/.kadehoreca')
pad = os.path.join(map_, f'inkoop-{naam}.key')
os.makedirs(map_, mode=0o700, exist_ok=True)
if os.path.exists(pad):
    sleutel = open(pad).read().strip()
    print(f'Sleutel bestond al: {pad}')
else:
    sleutel = secrets.token_hex(32)
    fd = os.open(pad, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as fh:
        fh.write(sleutel + '\n')
    print(f'Nieuwe sleutel gemaakt: {pad}')
h = hashlib.sha256(sleutel.encode()).hexdigest()
print('Voer dit uit in de SQL Editor:')
print(f"select public.{voorvoegsel}_inkoopsleutel_instellen('{h}');")
