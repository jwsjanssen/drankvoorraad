#!/usr/bin/env python3
"""Levert uitgelezen factuurregels aan bij het voorraadsysteem (de dagelijkse inkoopronde gebruikt dit).

  python3 tools/inkoop-aanleveren.py facturen.json [meer.json ...]   aanleveren aan de TESTomgeving
  python3 tools/inkoop-aanleveren.py --live facturen.json            aanleveren aan de echte site
  python3 tools/inkoop-aanleveren.py --bekend                        tonen wat al bekend is (producten, facturen)
  python3 tools/inkoop-aanleveren.py --droog facturen.json           alleen controleren, niets versturen

De sleutel staat in ~/.kadehoreca/inkoop-test.key of inkoop-live.key (maken: tools/inkoop-sleutel.py).
Een factuur die al is aangeleverd wordt overgeslagen; opnieuw uitvoeren kan dus zonder schade.

Invoer: een JSON-array met per document
  {"sent": "2026-11-28", "subject": "...", "supplier": "Sligro", "invoiceNo": "...", "invoiceDate": "2026-11-28",
   "customer": "FLOATS KEUKEN", "location": "floats|altstadt|onbekend", "dept": "keuken|bar|...|onbekend",
   "kind": "producten|dienst|creditnota|onleesbaar", "total": 334.46,
   "lines": [{"art": "108605", "desc": "...", "qty": 2, "pack": "1 BL", "content": "2,50 KG", "price": 3.29,
              "net": 6.58, "vat": 9, "type": "product|emballage|toeslag",
              "sug": {"name": "...", "cat": "...", "dept": "...", "unit": "...", "f": 1, "count": true}}]}
"sug" is het voorstel voor een product dat nog niet bekend is; weglaten mag.
"""
import datetime, hashlib, json, os, re, sys, unicodedata, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = {a for a in sys.argv[1:] if a.startswith('--')}
LIVE = '--live' in flags
PREFIX = 'voorraad' if LIVE else 'voorraadtest'

cfg = open(os.path.join(HERE, '..', 'config.js'), encoding='utf-8').read()
URL = re.search(r'url:"([^"]+)"', cfg).group(1)
PUB = re.search(r'key:"([^"]+)"', cfg).group(1)


def sleutel():
    pad = os.path.expanduser('~/.kadehoreca/inkoop-%s.key' % ('live' if LIVE else 'test'))
    if not os.path.exists(pad):
        sys.exit('Geen sleutel gevonden (%s). Maak hem met tools/inkoop-sleutel.py%s.' % (pad, ' --live' if LIVE else ''))
    return open(pad).read().strip()


def rpc(naam, body):
    req = urllib.request.Request('%s/rest/v1/rpc/%s_%s' % (URL, PREFIX, naam), data=json.dumps(body).encode(),
                                 headers={'apikey': PUB, 'Authorization': 'Bearer ' + PUB, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        sys.exit('Aanleveren mislukt (%s): %s' % (e.code, e.read().decode()[:300]))


def slug(s):
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def num(v):
    return round(float(v), 4) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def week_of(iso):
    try:
        d = datetime.date.fromisoformat(str(iso)[:10])
    except Exception:
        return None
    y, w, _ = d.isocalendar()
    return '%d-W%02d' % (y, w)


KIND = {'producten': 'p', 'dienst': 'd', 'creditnota': 'c', 'onleesbaar': 'x'}
TYPE = {'product': 'p', 'emballage': 'e', 'toeslag': 't'}
DEPTS = ('bar', 'keuken', 'housekeeping', 'receptie', 'algemeen')


def omzetten(d):
    """Document uit de ronde -> (pad, factuur-id, compact document)."""
    sup = str(d.get('supplier') or '').strip()[:60]
    no = str(d.get('invoiceNo') or '').strip()[:40]
    date = str(d.get('invoiceDate') or '')[:10]
    sent = str(d.get('sent') or '')[:10]
    loc = d.get('location') if d.get('location') in ('floats', 'altstadt') else 'onbekend'
    week = week_of(date) or week_of(sent) or week_of(datetime.date.today().isoformat())
    if no:
        fid = (slug(sup) or 'onbekend')[:40] + '_' + slug(no)[:40]
    else:  # bonnen zonder nummer: herkenbaar aan leverancier, datum, bedrag en onderwerp
        h = hashlib.sha1(('%s|%s|%s|%s' % (sup, date or sent, d.get('total'), d.get('subject'))).encode()).hexdigest()[:10]
        fid = (slug(sup) or 'onbekend')[:40] + '_' + (date or sent or 'zonder-datum') + '_' + h
    L = {}
    for i, l in enumerate(d.get('lines') or []):
        r = {'d': str(l.get('desc') or '')[:120], 't': TYPE.get(l.get('type'), 'p')}
        if l.get('art'):
            r['a'] = str(l['art'])[:30]
        for k, src in (('q', 'qty'), ('e', 'price'), ('n', 'net'), ('v', 'vat')):
            v = num(l.get(src))
            if v is not None:
                r[k] = v
        if l.get('pack'):
            r['p'] = str(l['pack'])[:20]
        if l.get('content'):
            r['c'] = str(l['content'])[:20]
        s = l.get('sug')
        if isinstance(s, dict) and r['t'] == 'p':
            sg = {'name': str(s.get('name') or '')[:80], 'cat': str(s.get('cat') or '')[:40], 'unit': str(s.get('unit') or '')[:40],
                  'f': num(s.get('f')) or 1, 'count': s.get('count') is not False}
            if s.get('dept') in DEPTS:
                sg['dept'] = s['dept']
            r['sg'] = sg
        L['%03d' % i] = r
    doc = {'sup': sup, 'no': no, 'date': date, 'sent': sent, 'cust': str(d.get('customer') or '')[:120],
           'kind': KIND.get(d.get('kind'), 'p'), 'st': 'n', 'subj': str(d.get('subject') or '')[:120], 'L': L}
    if d.get('dept') in DEPTS:
        doc['dept'] = d['dept']
    if num(d.get('total')) is not None:
        doc['total'] = num(d['total'])
    if d.get('note'):
        doc['note'] = str(d['note'])[:300]
    return 'inkooplog/%s_%s' % (loc, week), fid, doc


if '--bekend' in flags:
    print(json.dumps(rpc('inkoop_bekend', {'p_sleutel': sleutel()}), ensure_ascii=False))
    sys.exit(0)
if not args:
    sys.exit(__doc__)

docs = []
for f in args:
    docs += json.load(open(f, encoding='utf-8'))
tel = {'toegevoegd': 0, 'bestaat': 0}
key = None if '--droog' in flags else sleutel()
gezien = set()
for d in docs:
    pad, fid, doc = omzetten(d)
    if fid in gezien:
        tel['bestaat'] += 1
        continue
    gezien.add(fid)
    if key is None:
        print(pad, fid, len(doc['L']), 'regels')
        continue
    r = rpc('inkoop_aanleveren', {'p_sleutel': key, 'p_path': pad, 'p_fid': fid, 'p_doc': doc})
    tel[r.get('status', '?')] = tel.get(r.get('status', '?'), 0) + 1
print(('TEST' if not LIVE else 'ECHT') + ': %d documenten, %d toegevoegd, %d bestonden al' % (len(docs), tel['toegevoegd'], tel['bestaat']))
