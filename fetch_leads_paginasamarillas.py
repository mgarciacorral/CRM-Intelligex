#!/usr/bin/env python3
import json, re, html, sqlite3, sys, requests
from urllib.parse import urlsplit, urlunsplit

sector = sys.argv[1] if len(sys.argv) > 1 else 'abogados'
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
what = 'abogados' if sector == 'abogados' else 'inmobiliarias'
city_slugs = [
    ('madrid', 'Madrid'), ('barcelona', 'Barcelona'), ('valencia', 'Valencia'), ('sevilla', 'Sevilla'),
    ('malaga', 'Málaga'), ('bilbao', 'Bilbao'), ('zaragoza', 'Zaragoza'), ('alicante-alacant', 'Alicante'),
    ('murcia', 'Murcia'), ('palma-de-mallorca', 'Palma')
]
headers = {'User-Agent': 'Mozilla/5.0'}
email_re = re.compile(r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', re.I)

conn = sqlite3.connect('/root/CRM/data/crm.sqlite')
existing = set((row[0].strip().lower(), row[1]) for row in conn.execute('SELECT lower(name), sector FROM leads'))
leads = []
seen = set()

for city_slug, city_label in city_slugs:
    search_url = f'https://www.paginasamarillas.es/search/{what}/all-ma/{city_slug}/all-is/{city_slug}/all-ba/all-pu/all-nc/1?what={what}&where={city_label}'
    try:
        resp = requests.get(search_url, headers=headers, timeout=30)
        resp.raise_for_status()
    except Exception:
        continue
    text = resp.text
    for p in text.split('<div class="listado-item')[1:]:
        durl = re.search(r'href="(https://www\.paginasamarillas\.es/f/[^\"]+\.html)" title="ver detalles', p)
        if not durl:
            continue
        detail = durl.group(1)
        citym = re.search(r'/f/([^/]+)/', detail)
        city = citym.group(1).replace('-', ' ').title() if citym else city_label
        name = re.search(r'itemprop="name">(.*?)</span>', p, re.S)
        if not name:
            continue
        name = html.unescape(name.group(1)).strip()
        key = (name.lower(), sector)
        if key in existing or key in seen:
            continue
        seen.add(key)
        phone = re.search(r'itemprop="telephone">(.*?)</span>', p, re.S)
        phone = html.unescape(phone.group(1)).strip() if phone else ''
        webm = re.search(r'<a href="(https?://[^\"]+)" class="imagen" target="_blank" data-omniclick="logo\|web"', p)
        web = webm.group(1) if webm else ''
        if not web:
            wm = re.findall(r'href="(https?://[^\"]+)"', p)
            for cand in wm:
                if 'paginasamarillas.es' not in cand and 'google' not in cand and 'adsContentSrv' not in cand:
                    web = cand
                    break
        email = ''
        if web:
            try:
                parts = urlsplit(web)
                clean = urlunsplit((parts.scheme, parts.netloc, parts.path, '', ''))
                wr = requests.get(clean, headers=headers, timeout=20, allow_redirects=True)
                emails = sorted(set(e.lstrip('%20') for e in email_re.findall(wr.text[:600000])))
                emails = [e for e in emails if 'example' not in e.lower()]
                if emails:
                    email = emails[0]
            except Exception:
                pass
        opp = 'web mejorable' if web else 'sin web'
        channel = 'email' if email else ('teléfono' if phone else 'formulario')
        reason = 'Tiene web propia y margen claro de mejora en presencia/SEO' if web else 'No se detecta web propia; oportunidad clara para ofrecer landing desde cero'
        leads.append({
            'name': name,
            'sector': sector,
            'city': city,
            'website': web,
            'contact': phone or detail,
            'contact_email': email,
            'status': 'nuevo',
            'notes': f'Tipo de oportunidad: {opp}\nCanal recomendado: {channel}\nMotivo: {reason}\nFuente: {detail}'
        })
        if len(leads) >= limit:
            break
    if len(leads) >= limit:
        break

inserted = 0
for lead in leads:
    conn.execute("INSERT INTO leads (name, sector, city, website, contact, contact_email, status, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
                 (lead['name'], lead['sector'], lead['city'], lead['website'], lead['contact'], lead['contact_email'], lead['status'], lead['notes']))
    inserted += 1
conn.commit()
print(json.dumps({'sector': sector, 'inserted': inserted, 'with_email': sum(1 for x in leads if x['contact_email'])}, ensure_ascii=False))
