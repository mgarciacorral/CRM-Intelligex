#!/usr/bin/env python3
import re, sqlite3, requests
from urllib.parse import urljoin, urlsplit, urlunsplit

conn = sqlite3.connect('/root/CRM/data/crm.sqlite')
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT id, name, website, notes FROM leads WHERE (contact_email IS NULL OR contact_email = '') AND website <> '' ORDER BY id DESC LIMIT 100").fetchall()
headers = {'User-Agent': 'Mozilla/5.0'}

href_re = re.compile(r'href=["\']([^"\']+)["\']', re.I)
form_re = re.compile(r'<form\b', re.I)
contact_words = ['contacto', 'contact', 'contactar', 'solicita', 'solicitar', 'consulta', 'habla', 'escribenos', 'escríbenos']

updated = 0
for row in rows:
    website = row['website'].strip()
    try:
        parts = urlsplit(website)
        clean = urlunsplit((parts.scheme, parts.netloc, parts.path, '', ''))
        r = requests.get(clean, headers=headers, timeout=20, allow_redirects=True)
        html = r.text[:600000]
        found_url = ''
        found_kind = ''
        if form_re.search(html):
            found_url = r.url
            found_kind = 'formulario en home'
        else:
            links = href_re.findall(html)
            for link in links:
                label = link.lower()
                if any(w in label for w in contact_words):
                    found_url = urljoin(r.url, link)
                    try:
                        rc = requests.get(found_url, headers=headers, timeout=20, allow_redirects=True)
                        if form_re.search(rc.text[:600000]):
                            found_url = rc.url
                            found_kind = 'formulario en página de contacto'
                            break
                    except Exception:
                        pass
        if found_url:
            note = f"\n\n[FORM] Detectado {found_kind}: {found_url}"
            if note.strip() not in (row['notes'] or ''):
                conn.execute("UPDATE leads SET notes = COALESCE(notes,'') || ?, updated_at = datetime('now') WHERE id = ?", (note, row['id']))
                updated += 1
    except Exception:
        continue
conn.commit()
print({'updated': updated})
