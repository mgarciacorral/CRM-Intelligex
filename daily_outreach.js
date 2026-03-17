require('dotenv').config({ path: '/root/CRM/.mail.env' });
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');

const db = new Database('/root/CRM/data/crm.sqlite');
const statePath = '/root/CRM/data/outreach_state.json';
const today = new Date().toISOString();

function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch { return { lastSector: 'inmobiliarias' }; }
}
function saveState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
function nextSector(last) {
  return last === 'abogados' ? 'inmobiliarias' : 'abogados';
}
function personalizedBody(lead) {
  const hasWeb = !!lead.website;
  const sectorWord = lead.sector === 'abogados' ? 'despacho' : 'inmobiliaria';
  const angle = hasWeb
    ? `He estado revisando vuestra presencia online y creo que hay margen para mejorar cómo la web transmite confianza y convierte visitas en contactos.`
    : `He visto que tenéis margen para mejorar vuestra presencia online y creo que os encajaría muy bien una landing clara y profesional para captar contactos.`;
  const second = hasWeb
    ? `En negocios como el vuestro, pequeños ajustes en estructura, mensaje y SEO básico suelen marcar bastante diferencia.`
    : `En negocios como el vuestro, tener una página simple pero bien planteada suele ayudar mucho a transmitir confianza y generar oportunidades.`;
  return `Hola,\n\nSoy Matias Garcia, de Intelligex.\n\nHe visto ${lead.name} y ${angle}\n\n${second}\n\nSi te parece, puedo echar un vistazo rápido a vuestro caso y mandarte una propuesta breve con lo que mejoraría primero, sin compromiso.\n\nMatias Garcia\nIntelligex\nhttps://intelligex.es`;
}

async function main() {
  const state = loadState();
  const sector = process.argv[2] || nextSector(state.lastSector);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const leads = db.prepare(`
    SELECT * FROM leads
    WHERE sector = ?
      AND contact_email <> ''
      AND (last_outreach_at IS NULL OR date(last_outreach_at) <> date('now'))
      AND (status = 'nuevo' OR status = 'contactado')
    ORDER BY CASE WHEN website <> '' THEN 0 ELSE 1 END, id ASC
    LIMIT 20
  `).all(sector);

  let sent = 0;
  for (const lead of leads) {
    const info = await transport.sendMail({
      from: `Matias Garcia - Intelligex <${process.env.EMAIL_ADDRESS}>`,
      to: lead.contact_email,
      subject: sector === 'abogados' ? 'Propuesta de mejora para vuestra presencia online' : 'Idea para mejorar vuestra captación online',
      text: personalizedBody(lead),
      headers: { 'X-Intelligex-Lead-Id': String(lead.id) }
    });
    db.prepare("UPDATE leads SET status = ?, last_outreach_at = datetime('now'), updated_at = datetime('now'), notes = COALESCE(notes,'') || ? WHERE id = ?")
      .run('contactado', `\n\n[OUTREACH] Daily email enviado a ${lead.contact_email} (${info.messageId})`, lead.id);
    sent++;
  }

  state.lastSector = sector;
  state.lastRunAt = today;
  state.lastSent = sent;
  saveState(state);
  console.log(JSON.stringify({ sector, sent }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
