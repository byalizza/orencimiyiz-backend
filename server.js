const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

let transporter = null;
let smtpConfigured = false;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  smtpConfigured = true;
  console.log('SMTP configured for', process.env.SMTP_USER);
} else {
  console.warn('SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS');
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', smtpConfigured, message: 'Öğrenci Asistanı backend running' });
});

app.get('/test-smtp', async (req, res) => {
  if (!transporter) {
    return res.json({ ok: false, error: 'SMTP not configured' });
  }
  try {
    const testResult = await transporter.sendMail({
      from: `"Öğrenci Asistanı" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER,
      subject: 'SMTP Test',
      text: 'Bu bir test mailidir. SMTP çalışıyor.',
    });
    res.json({ ok: true, messageId: testResult.messageId, message: 'Test email sent to ' + process.env.SMTP_USER });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post('/send-verification', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'email and code are required' });
    }
    if (!transporter) {
      return res.status(500).json({ error: 'SMTP not configured' });
    }

    const info = await transporter.sendMail({
      from: `"Öğrenci Asistanı" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'E-posta Doğrulama Kodu',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; background-color: #0F1115; border-radius: 18px;">
          <h2 style="color: #4F8CFF; text-align: center;">Öğrenci Asistanı</h2>
          <p style="color: #E0E0E0; text-align: center;">E-posta doğrulama kodunuz:</p>
          <div style="background: #1E222B; border: 1px solid #2D323D; border-radius: 16px; padding: 24px; text-align: center; margin: 16px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #4F8CFF;">${code}</span>
          </div>
          <p style="color: #888; text-align: center; font-size: 12px;">Bu kod 10 dakika geçerlidir.</p>
        </div>
      `,
    });

    console.log(`Verification code sent to ${email}, messageId: ${info.messageId}`);
    res.json({ success: true, message: 'Verification code sent', messageId: info.messageId });
  } catch (err) {
    console.error('Email send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
