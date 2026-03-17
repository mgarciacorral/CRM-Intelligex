require('dotenv').config({ path: '/root/CRM/.mail.env' });
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');

const db = new Database('/root/CRM/data/crm.sqlite');
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

(async () => {
  const emailsSent = db.prepare(`SELECT COUNT(*) AS c FROM leads WHERE last_outreach_at IS NOT NULL AND date(last_outreach_at) = date('now')`).get().c;
  const formsDetected = db.prepare(`SELECT COUNT(*) AS c FROM leads WHERE notes LIKE '%[FORM]%' AND date(updated_at) = date('now')`).get().c;
  const repliesReceived = db.prepare(`SELECT COUNT(*) AS c FROM leads WHERE last_reply_at IS NOT NULL AND date(last_reply_at) = date('now')`).get().c;

  const body = `Reporte diario Intelligex CRM\n\nFecha: ${new Date().toISOString()}\n\nCorreos enviados hoy: ${emailsSent}\nFormularios detectados/registrados hoy: ${formsDetected}\nCorreos recibidos hoy en el buzón y asociados a leads: ${repliesReceived}\n\nResumen:\n- Emails enviados: ${emailsSent}\n- Formularios: ${formsDetected}\n- Respuestas recibidas: ${repliesReceived}`;

  const info = await transport.sendMail({
    from: `Intelligex Reports <${process.env.EMAIL_ADDRESS}>`,
    to: 'matiasgarciacorral@gmail.com',
    subject: 'Reporte diario - Intelligex CRM',
    text: body
  });

  console.log(JSON.stringify({ emailsSent, formsDetected, repliesReceived, messageId: info.messageId }, null, 2));
})().catch(err => {
  console.error(err);
  process.exit(1);
});
