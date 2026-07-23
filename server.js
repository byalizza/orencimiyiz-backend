const express = require('express');
const cors = require('cors');
const https = require('https');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// Firebase Admin SDK (FCM V1)
let messaging = null;
function initFirebase() {
  try {
    let serviceAccount;
    // 1) Try Secret File (Render)
    const fs = require('fs');
    const secretPath = '/etc/secrets/firebase-service-account.json';
    if (fs.existsSync(secretPath)) {
      serviceAccount = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
      console.log('Loaded service account from Secret File');
    }
    // 2) Fallback: env var (minified JSON on one line)
    else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      console.log('Loaded service account from env var');
    }
    if (serviceAccount) {
      const admin = require('firebase-admin');
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      messaging = admin.messaging();
      console.log('Firebase Admin initialized for FCM V1');
    }
  } catch (e) {
    console.warn('Firebase Admin init failed:', e.message);
  }
}
initFirebase();

const PORT = process.env.PORT || 3000;

let emailer = null;

if (process.env.BREVO_API_KEY) {
  emailer = async ({ to, subject, html }) => {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        sender: { email: process.env.FROM_EMAIL || process.env.BREVO_API_KEY.split('-')[0] + '@brevo.com' },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      });
      const req = https.request({
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'Content-Length': Buffer.byteLength(data),
        },
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 201) resolve(body);
          else reject(new Error(`Brevo API error: ${res.statusCode} ${body}`));
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  };
  console.log('Brevo API configured');
} else {
  console.warn('BREVO_API_KEY not set!');
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', brevoConfigured: !!emailer, message: 'Öğrenci Asistanı backend running' });
});

app.get('/test-smtp', async (req, res) => {
  if (!emailer) return res.json({ ok: false, error: 'Brevo not configured' });
  try {
    const result = await emailer({
      to: process.env.FROM_EMAIL || 'alininsiteleri27@gmail.com',
      subject: 'SMTP Test',
      html: '<p>Test maili başarılı.</p>',
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post('/send-verification', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'email and code are required' });
    if (!emailer) return res.status(500).json({ error: 'Brevo not configured' });

    await emailer({
      to: email,
      subject: 'E-posta Doğrulama Kodu - Öğrenci Asistanı',
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

    console.log(`Verification code sent to ${email}`);
    res.json({ success: true, message: 'Verification code sent' });
  } catch (err) {
    console.error('Email send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});

app.post('/send-notification', async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

    if (!messaging) return res.status(500).json({ error: 'FCM not configured' });

    // Fetch tokens from RTDB
    const dbUrl = process.env.FIREBASE_DB_URL || 'https://ogrencimiyiz-default-rtdb.firebaseio.com';
    const tokens = await new Promise((resolve, reject) => {
      https.get(`${dbUrl}/fcm_tokens.json`, (tRes) => {
        let data = '';
        tRes.on('data', chunk => data += chunk);
        tRes.on('end', () => {
          try {
            const obj = data ? JSON.parse(data) : {};
            resolve(Object.values(obj).filter(t => typeof t === 'string' && t.length > 0));
          } catch (e) { resolve([]); }
        });
      }).on('error', reject);
    });

    if (tokens.length === 0) return res.json({ success: true, sent: 0, total: 0, message: 'No tokens' });

    const message = {
      notification: { title, body },
      data: { title, body },
    };

    // Send in batches of 500 (FCM limit)
    let sent = 0;
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const response = await messaging.sendEachForMulticast({ ...message, tokens: batch });
      sent += response.successCount;
    }

    console.log(`FCM: ${sent}/${tokens.length} delivered`);
    res.json({ success: true, sent, total: tokens.length });
  } catch (err) {
    console.error('FCM error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
