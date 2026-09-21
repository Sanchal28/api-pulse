// A tiny "someone else's" Express app that has installed apipulse-sdk,
// exactly as described in the onboarding flow: npm install + 2 lines + restart.
//
// This app makes REAL outgoing calls to mock-services.js (a local stand-in for
// Stripe/Twilio/Google Maps), so apipulse-sdk's http/https patch genuinely
// captures them — no fake/simulated data needed for this part.
const express = require('express');
const http = require('http');
const apipulse = require('apipulse-sdk');

const app = express();
app.use(express.json());

// ---- paste-in setup (this is step 4/5 from the onboarding flow) ----
const PROJECT_KEY = process.env.APIPULSE_PROJECT_KEY || 'PASTE_YOUR_PROJECT_KEY_HERE';
const BACKEND_URL = process.env.APIPULSE_BACKEND_URL || 'http://localhost:4000';
apipulse.init(app, { projectKey: PROJECT_KEY, backendUrl: BACKEND_URL });
// ----------------------------------------------------------------------

const MOCK_PORT = process.env.MOCK_PORT || 5001;

// small helper to call the mock services with plain http.request
// (must use http.request so apipulse-sdk's outgoing patch picks it up)
function callMock(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port: MOCK_PORT, path, method, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    if (method === 'POST') req.write('{}');
    req.end();
  });
}

// 1. Create an order — internally charges the card and sends a confirmation SMS.
//    Two real outgoing calls happen here, tracked automatically.
app.post('/api/orders', async (req, res) => {
  try {
    const charge = await callMock('/charges', 'POST');
    await callMock('/messages', 'POST');
    if (charge.status >= 500) {
      return res.status(502).json({ error: 'payment_failed' });
    }
    res.status(200).json({ orderId: 'ord_' + Date.now(), status: 'created' });
  } catch (e) {
    res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/api/orders/:id', (req, res) => {
  res.status(200).json({ orderId: req.params.id, status: 'created' });
});

// 2. Track an order — looks up a geocoded location for the delivery address.
app.get('/api/orders/:id/track', async (req, res) => {
  try {
    const geo = await callMock('/geocode', 'GET');
    res.status(200).json({ orderId: req.params.id, location: JSON.parse(geo.body) });
  } catch (e) {
    res.status(500).json({ error: 'internal_error' });
  }
});

// 3. Login — a real endpoint you can deliberately hit with wrong credentials
//    a few times to trigger the "repeated auth failures" security flag yourself.
const VALID_USER = { username: 'admin', password: 'admin123' };
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === VALID_USER.username && password === VALID_USER.password) {
    return res.status(200).json({ token: 'demo-session-token' });
  }
  res.status(401).json({ error: 'invalid_credentials' });
});

const PORT = process.env.DEMO_PORT || 5000;
app.listen(PORT, () => {
  console.log(`Demo app running on http://localhost:${PORT}`);
  console.log('Try:');
  console.log(`  curl -X POST http://localhost:${PORT}/api/orders`);
  console.log(`  curl http://localhost:${PORT}/api/orders/123/track`);
  console.log(`  curl -X POST http://localhost:${PORT}/api/login -H "Content-Type: application/json" -d "{\\"username\\":\\"admin\\",\\"password\\":\\"wrong\\"}"`);
});
