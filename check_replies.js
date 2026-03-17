require('dotenv').config({ path: '/root/CRM/.mail.env' });
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');

const db = new Database('/root/CRM/data/crm.sqlite');
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

function looksPositive(text = '') {
  const t = text.toLowerCase();
  const positives = [
    'me interesa', 'interesa', 'hablemos', 'llámame', 'llamame', 'cuéntame', 'cuentame',
    'envíame', 'enviame', 'manda', 'mandame', 'propuesta', 'presupuesto', 'cuando puedes',
    'agendar', 'reunión', 'reunion', 'hablamos', 'ok', 'sí', 'si'
  ];
  return positives.some(p => t.includes(p));
}

(async () => {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT),
    secure: true,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASS }
  });
  await client.connect();
  await client.mailboxOpen('INBOX');
  for await (const msg of client.fetch('1:*', { uid: true, flags: true, envelope: true, source: true })) {
    if (msg.flags.has('\\Seen')) continue;
    const parsed = await simpleParser(msg.source);
    const fromEmail = parsed.from?.value?.[0]?.address?.toLowerCase() || '';
    const subject = parsed.subject || '';
    const text = (parsed.text || parsed.html || '').slice(0, 4000);
    const lead = db.prepare('SELECT * FROM leads WHERE lower(contact_email) = lower(?) LIMIT 1').get(fromEmail);
    if (!lead) continue;

    db.prepare("UPDATE leads SET last_reply_at = datetime('now'), updated_at = datetime('now'), status = ?, notes = COALESCE(notes,'') || ? WHERE id = ?")
      .run('respondió', `\n\n[REPLY] ${new Date().toISOString()} | ${subject}\n${text.slice(0, 1200)}`, lead.id);

    const positive = looksPositive(`${subject}\n${text}`);
    if (positive && !lead.notification_sent_at) {
      await transport.sendMail({
        from: `Intelligex Alerts <${process.env.EMAIL_ADDRESS}>`,
        to: 'matiasgarciacorral@gmail.com',
        subject: `Lead interesado: ${lead.name}`,
        text: `Ha respondido un lead con señales de interés.\n\nNegocio: ${lead.name}\nEmail: ${lead.contact_email}\nWeb: ${lead.website || '-'}\nContacto alternativo: ${lead.contact || '-'}\nAsunto: ${subject}\n\nMensaje:\n${text}\n\nRecomendación: responder hoy y ofrecer revisión rápida + propuesta breve.`
      });
      db.prepare("UPDATE leads SET notification_sent_at = datetime('now'), status = ?, updated_at = datetime('now') WHERE id = ?")
        .run('respondió', lead.id);
      console.log(`ALERT ${lead.id} ${lead.name}`);
    }

    await client.messageFlagsAdd(msg.uid, ['\\Seen']);
  }
  await client.logout();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
