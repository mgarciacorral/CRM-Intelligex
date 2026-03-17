require('dotenv').config({ path: '/root/CRM/.mail.env' });
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');

const ids = process.argv.slice(2).map(Number).filter(Boolean);
if (!ids.length) {
  console.error('Usage: node send_outreach.js <leadId> [leadId...]');
  process.exit(1);
}

const db = new Database('/root/CRM/data/crm.sqlite');
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

const subject = 'Propuesta de mejora para vuestra presencia online';

function buildText(lead) {
  return `Hola,\n\nSoy Matias Garcia, de Intelligex.\n\nHe estado revisando vuestra presencia online y creo que hay margen para mejorar tanto la imagen del despacho como la forma en la que la web transmite confianza y convierte visitas en contactos.\n\nEn muchos despachos, pequeños ajustes en la estructura, el mensaje y la optimización SEO básica ya marcan bastante diferencia a la hora de captar potenciales clientes de forma más profesional.\n\nSi te parece, puedo echar un vistazo rápido a vuestro caso y mandarte una propuesta breve con lo que mejoraría primero, sin compromiso.\n\nMatias Garcia\nIntelligex\nhttps://intelligex.es`;
}

(async () => {
  for (const id of ids) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    if (!lead) continue;
    if (!lead.contact_email) {
      console.log(`SKIP ${id} no-email`);
      continue;
    }
    const info = await transport.sendMail({
      from: `Matias Garcia - Intelligex <${process.env.EMAIL_ADDRESS}>`,
      to: lead.contact_email,
      subject,
      text: buildText(lead),
      headers: {
        'X-Intelligex-Lead-Id': String(lead.id)
      }
    });
    db.prepare("UPDATE leads SET status = ?, last_outreach_at = datetime('now'), updated_at = datetime('now'), notes = COALESCE(notes,'') || ? WHERE id = ?")
      .run('contactado', `\n\n[OUTREACH] Email enviado a ${lead.contact_email} (${info.messageId})`, id);
    console.log(`SENT ${id} ${lead.contact_email}`);
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
