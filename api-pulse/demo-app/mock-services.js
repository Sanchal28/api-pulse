// mock-services.js
// Stand-ins for Stripe / Twilio / Google Maps, running locally so the demo
// can make *real* outgoing HTTP calls without needing internet access.
// The apipulse-sdk in server.js genuinely captures these as outgoing traffic.
const express = require('express');
const app = express();
app.use(express.json());

function delay(min, max) {
  return new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
}

// payment gateway — occasionally fails, to give the flags engine something to catch
app.post('/charges', async (req, res) => {
  await delay(250, 450);
  if (Math.random() < 0.08) {
    return res.status(500).json({ error: 'charge_failed' });
  }
  res.status(200).json({ chargeId: 'ch_' + Date.now(), status: 'succeeded' });
});

// SMS/notification gateway
app.post('/messages', async (req, res) => {
  await delay(100, 220);
  res.status(200).json({ messageId: 'sm_' + Date.now(), status: 'sent' });
});

// geocoding lookup
app.get('/geocode', async (req, res) => {
  await delay(180, 350);
  res.status(200).json({ lat: 18.5204, lng: 73.8567 });
});

const PORT = process.env.MOCK_PORT || 5001;
app.listen(PORT, () => console.log(`Mock external services running on http://localhost:${PORT}`));
