const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 8087);
const HOST = '127.0.0.1';
const COOKIE_NAME = 'crm_auth';
const COOKIE_SECRET = 'intelligex-crm-cookie-secret-v1';
const PASSWORD_HASH = fs.readFileSync(path.join(__dirname, '.password_hash'), 'utf8').trim();
const DB_PATH = path.join(__dirname, 'data', 'crm.sqlite');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sector TEXT NOT NULL,
    city TEXT,
    website TEXT,
    contact TEXT,
    status TEXT NOT NULL DEFAULT 'nuevo',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const extraColumns = {
  contact_email: "TEXT DEFAULT ''",
  last_outreach_at: "TEXT",
  last_reply_at: "TEXT",
  notification_sent_at: "TEXT"
};
const columns = db.prepare("PRAGMA table_info(leads)").all().map(c => c.name);
for (const [name, type] of Object.entries(extraColumns)) {
  if (!columns.includes(name)) {
    db.exec(`ALTER TABLE leads ADD COLUMN ${name} ${type}`);
  }
}

const count = db.prepare("SELECT COUNT(*) as total FROM leads").get().total;
if (count === 0) {
  const seed = db.prepare(`INSERT INTO leads (name, sector, city, website, contact, status, notes)
    VALUES (@name,@sector,@city,@website,@contact,@status,@notes)`);
  [
    { name: 'Bufete Ejemplo', sector: 'abogados', city: 'Madrid', website: 'https://ejemplo-abogados.es', contact: 'hola@ejemplo-abogados.es', status: 'nuevo', notes: 'Lead de ejemplo' },
    { name: 'Inmo Prime', sector: 'inmobiliarias', city: 'Valencia', website: 'https://inmoprime.es', contact: '+34 600 000 000', status: 'contactado', notes: 'Interesados en mejorar captación' }
  ].forEach(row => seed.run(row));
}

function sign(value) {
  return crypto.createHmac('sha256', COOKIE_SECRET).update(value).digest('hex');
}
function makeToken() {
  const payload = `ok.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}
function isValidToken(token = '') {
  const parts = token.split('.');
  if (parts.length < 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  return sign(payload) === parts.slice(2).join('.');
}
function requireAuth(req, res, next) {
  if (isValidToken(req.cookies[COOKIE_NAME])) return next();
  return res.redirect('/login');
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/public', express.static(path.join(__dirname, 'public')));

function layout(title, content) {
  return `<!doctype html>
  <html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body{background:linear-gradient(180deg,#0b1020,#111827)}
      .glass{backdrop-filter: blur(18px); background: rgba(17,24,39,.72)}
    </style>
  </head>
  <body class="min-h-screen text-slate-100">${content}</body></html>`;
}

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/login', (req, res) => {
  res.send(layout('Login CRM', `
    <div class="min-h-screen flex items-center justify-center p-6">
      <div class="glass w-full max-w-md rounded-3xl border border-white/10 shadow-2xl p-8">
        <div class="mb-8">
          <p class="text-sm uppercase tracking-[0.3em] text-cyan-300/80">Intelligex</p>
          <h1 class="text-3xl font-semibold mt-2">CRM privado</h1>
          <p class="text-slate-400 mt-2">Acceso protegido para gestionar leads y seguimiento comercial.</p>
        </div>
        <form method="post" action="/login" class="space-y-4">
          <div>
            <label class="text-sm text-slate-300">Contraseña</label>
            <input type="password" name="password" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400" placeholder="••••••••" required />
          </div>
          <button class="w-full rounded-2xl bg-cyan-400 text-slate-900 font-semibold py-3 hover:bg-cyan-300 transition">Entrar</button>
        </form>
      </div>
    </div>
  `));
});
app.post('/login', (req, res) => {
  const { password = '' } = req.body;
  if (!bcrypt.compareSync(password, PASSWORD_HASH)) {
    return res.status(401).send(layout('Login CRM', `
      <div class="min-h-screen flex items-center justify-center p-6">
        <div class="glass w-full max-w-md rounded-3xl border border-white/10 shadow-2xl p-8">
          <h1 class="text-3xl font-semibold">CRM privado</h1>
          <p class="text-rose-300 mt-4">Contraseña incorrecta.</p>
          <a href="/login" class="inline-block mt-6 rounded-2xl bg-cyan-400 text-slate-900 font-semibold px-5 py-3">Volver</a>
        </div>
      </div>
    `));
  }
  res.cookie(COOKIE_NAME, makeToken(), { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 24 * 14 });
  res.redirect('/');
});
app.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

app.get('/', requireAuth, (req, res) => {
  const leads = db.prepare("SELECT * FROM leads ORDER BY datetime(updated_at) DESC, id DESC").all();
  const statuses = ['nuevo','contactado','respondió','propuesta enviada','cerrado','descartado'];
  const sectors = ['abogados','inmobiliarias'];
  const cards = statuses.map(status => ({ status, total: leads.filter(l => l.status === status).length }));
  const rows = leads.map(lead => `
    <tr class="border-b border-white/5 align-top">
      <td class="px-4 py-4 font-medium text-white">${lead.name}</td>
      <td class="px-4 py-4 text-slate-300">${lead.sector}</td>
      <td class="px-4 py-4 text-slate-300">${lead.city || '-'}</td>
      <td class="px-4 py-4 text-slate-300 break-all">${lead.website ? `<a class="text-cyan-300 hover:text-cyan-200" target="_blank" href="${lead.website}">${lead.website}</a>` : '-'}</td>
      <td class="px-4 py-4 text-slate-300">${lead.contact_email || lead.contact || '-'}</td>
      <td class="px-4 py-4"><span class="rounded-full bg-white/10 px-3 py-1 text-sm">${lead.status}</span></td>
      <td class="px-4 py-4 max-w-xs whitespace-pre-wrap text-slate-400">${lead.notes || ''}</td>
      <td class="px-4 py-4 text-slate-500 text-sm">${String(lead.updated_at).replace('T',' ').slice(0,16)}</td>
      <td class="px-4 py-4">
        <div class="flex flex-col gap-2">
          <a class="text-cyan-300 hover:text-cyan-200" href="/leads/${lead.id}/edit">Editar</a>
          <form method="post" action="/leads/${lead.id}/delete" onsubmit="return confirm('¿Eliminar lead?')">
            <button class="text-rose-300 hover:text-rose-200">Eliminar</button>
          </form>
        </div>
      </td>
    </tr>
  `).join('');

  res.send(layout('Intelligex CRM', `
    <div class="max-w-7xl mx-auto p-6 md:p-10">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <p class="text-sm uppercase tracking-[0.3em] text-cyan-300/80">Intelligex</p>
          <h1 class="text-4xl font-semibold mt-2">CRM comercial</h1>
          <p class="text-slate-400 mt-2">Leads de abogados e inmobiliarias, simple y rápido.</p>
        </div>
        <form method="post" action="/logout">
          <button class="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 hover:bg-white/10">Salir</button>
        </form>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        ${cards.map(card => `<div class="glass rounded-3xl border border-white/10 p-5"><p class="text-slate-400 text-sm">${card.status}</p><p class="text-3xl font-semibold mt-2">${card.total}</p></div>`).join('')}
      </div>

      <div class="grid xl:grid-cols-[420px_1fr] gap-6">
        <div class="glass rounded-3xl border border-white/10 p-6 h-fit">
          <h2 class="text-2xl font-semibold">Nuevo lead</h2>
          <p class="text-slate-400 mt-2 mb-6">Carga rápida para empezar a mover outreach.</p>
          <form method="post" action="/leads" class="space-y-4">
            <div>
              <label class="text-sm text-slate-300">Nombre del negocio</label>
              <input name="name" required class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400" />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="text-sm text-slate-300">Sector</label>
                <select name="sector" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400">${sectors.map(s=>`<option value="${s}">${s}</option>`).join('')}</select>
              </div>
              <div>
                <label class="text-sm text-slate-300">Estado</label>
                <select name="status" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400">${statuses.map(s=>`<option value="${s}">${s}</option>`).join('')}</select>
              </div>
            </div>
            <div>
              <label class="text-sm text-slate-300">Ciudad</label>
              <input name="city" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400" />
            </div>
            <div>
              <label class="text-sm text-slate-300">Web</label>
              <input name="website" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400" placeholder="https://..." />
            </div>
            <div>
              <label class="text-sm text-slate-300">Contacto</label>
              <input name="contact" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400" placeholder="teléfono o formulario" />
            </div>
            <div>
              <label class="text-sm text-slate-300">Email</label>
              <input name="contact_email" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400" placeholder="email@dominio.com" />
            </div>
            <div>
              <label class="text-sm text-slate-300">Notas</label>
              <textarea name="notes" rows="4" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400"></textarea>
            </div>
            <button class="w-full rounded-2xl bg-cyan-400 text-slate-900 font-semibold py-3 hover:bg-cyan-300 transition">Guardar lead</button>
          </form>
        </div>

        <div class="glass rounded-3xl border border-white/10 overflow-hidden">
          <div class="p-6 border-b border-white/10 flex items-center justify-between">
            <div>
              <h2 class="text-2xl font-semibold">Pipeline</h2>
              <p class="text-slate-400 mt-1">${leads.length} leads totales</p>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="bg-white/5 text-slate-300">
                <tr>
                  <th class="px-4 py-3">Negocio</th>
                  <th class="px-4 py-3">Sector</th>
                  <th class="px-4 py-3">Ciudad</th>
                  <th class="px-4 py-3">Web</th>
                  <th class="px-4 py-3">Contacto</th>
                  <th class="px-4 py-3">Estado</th>
                  <th class="px-4 py-3">Notas</th>
                  <th class="px-4 py-3">Actualizado</th>
                  <th class="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `));
});

app.post('/leads', requireAuth, (req, res) => {
  const stmt = db.prepare(`INSERT INTO leads (name, sector, city, website, contact, contact_email, status, notes, updated_at)
    VALUES (@name, @sector, @city, @website, @contact, @contact_email, @status, @notes, datetime('now'))`);
  stmt.run({
    name: req.body.name || '',
    sector: req.body.sector || 'abogados',
    city: req.body.city || '',
    website: req.body.website || '',
    contact: req.body.contact || '',
    contact_email: req.body.contact_email || '',
    status: req.body.status || 'nuevo',
    notes: req.body.notes || ''
  });
  res.redirect('/');
});

app.get('/leads/:id/edit', requireAuth, (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).send('Lead no encontrado');
  const statuses = ['nuevo','contactado','respondió','propuesta enviada','cerrado','descartado'];
  const sectors = ['abogados','inmobiliarias'];
  res.send(layout('Editar lead', `
    <div class="max-w-3xl mx-auto p-6 md:p-10">
      <div class="flex items-center justify-between gap-4 mb-8">
        <div>
          <p class="text-sm uppercase tracking-[0.3em] text-cyan-300/80">Intelligex</p>
          <h1 class="text-4xl font-semibold mt-2">Editar lead</h1>
          <p class="text-slate-400 mt-2">Actualiza estado, contacto y notas sin perder contexto.</p>
        </div>
        <a href="/" class="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 hover:bg-white/10">Volver</a>
      </div>
      <div class="glass rounded-3xl border border-white/10 p-6">
        <form method="post" action="/leads/${lead.id}/edit" class="space-y-4">
          <div>
            <label class="text-sm text-slate-300">Nombre del negocio</label>
            <input name="name" value="${lead.name || ''}" required class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-sm text-slate-300">Sector</label>
              <select name="sector" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400">${sectors.map(s=>`<option value="${s}" ${lead.sector===s?'selected':''}>${s}</option>`).join('')}</select>
            </div>
            <div>
              <label class="text-sm text-slate-300">Estado</label>
              <select name="status" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400">${statuses.map(s=>`<option value="${s}" ${lead.status===s?'selected':''}>${s}</option>`).join('')}</select>
            </div>
          </div>
          <div>
            <label class="text-sm text-slate-300">Ciudad</label>
            <input name="city" value="${lead.city || ''}" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400" />
          </div>
          <div>
            <label class="text-sm text-slate-300">Web</label>
            <input name="website" value="${lead.website || ''}" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400" />
          </div>
          <div>
            <label class="text-sm text-slate-300">Contacto</label>
            <input name="contact" value="${lead.contact || ''}" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400" />
          </div>
          <div>
            <label class="text-sm text-slate-300">Email</label>
            <input name="contact_email" value="${lead.contact_email || ''}" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400" />
          </div>
          <div>
            <label class="text-sm text-slate-300">Notas</label>
            <textarea name="notes" rows="6" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-400">${lead.notes || ''}</textarea>
          </div>
          <button class="w-full rounded-2xl bg-cyan-400 text-slate-900 font-semibold py-3 hover:bg-cyan-300 transition">Guardar cambios</button>
        </form>
      </div>
    </div>
  `));
});

app.post('/leads/:id/edit', requireAuth, (req, res) => {
  db.prepare(`UPDATE leads
    SET name = @name,
        sector = @sector,
        city = @city,
        website = @website,
        contact = @contact,
        contact_email = @contact_email,
        status = @status,
        notes = @notes,
        updated_at = datetime('now')
    WHERE id = @id`).run({
      id: req.params.id,
      name: req.body.name || '',
      sector: req.body.sector || 'abogados',
      city: req.body.city || '',
      website: req.body.website || '',
      contact: req.body.contact || '',
      contact_email: req.body.contact_email || '',
      status: req.body.status || 'nuevo',
      notes: req.body.notes || ''
    });
  res.redirect('/');
});

app.post('/leads/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.redirect('/');
});

app.listen(PORT, HOST, () => {
  console.log(`CRM listening on http://${HOST}:${PORT}`);
});
