# API Pulse

Real-time incoming + outgoing API monitoring dashboard, with a drop-in SDK and a
rule-based security-flag engine. Built for individual developers who want
visibility into a service's traffic without setting up Datadog/New Relic.

## Project layout

```
api-pulse/
  backend/        Express API + JWT auth + rule-based flag engine + serves the dashboard UI
  sdk/apipulse-sdk/  The npm package developers install in their own app
  demo-app/       A sample Express app wired with the SDK, its mock external services,
                   plus a traffic simulator
  frontend/       The dashboard UI (plain HTML/CSS/JS, served by the backend)
```

## 1. Run the backend + dashboard

```bash
cd backend
npm install
npm start
```

This starts everything on **http://localhost:4000** — the API *and* the dashboard UI
(the backend serves the frontend as static files, so there's only one thing to run).

Open **http://localhost:4000** in your browser, sign up with any email/password,
then click **+ New Project**. You'll get a Project Key and a 2-line setup snippet.

## 2. Generate traffic to watch it work

You have two options — use one or both:

### Option A — the real demo app (real incoming + outgoing tracking)

The demo app makes **real** HTTP calls to `mock-services.js` (local stand-ins for
Stripe/Twilio/Google Maps), so both incoming and outgoing traffic are genuinely
tracked — nothing here is faked.

```bash
cd demo-app
npm install

# terminal A — the mock external services (payment, SMS, geocode)
npm run mocks

# terminal B — the app itself, with your project key
# Windows CMD:   set APIPULSE_PROJECT_KEY=pk_live_xxxxxxxx && npm start
# PowerShell:    $env:APIPULSE_PROJECT_KEY="pk_live_xxxxxxxx"; npm start
# macOS/Linux:   APIPULSE_PROJECT_KEY=pk_live_xxxxxxxx npm start
```

Then hit its routes (a 3rd terminal, or Postman):
```bash
# creates an order — internally calls the payment + SMS mock services
curl -X POST http://localhost:5000/api/orders

# tracks an order — internally calls the geocode mock service
curl http://localhost:5000/api/orders/123/track

# login — hit this 5-6 times with the wrong password to trigger the
# "repeated auth failures" security flag yourself
curl -X POST http://localhost:5000/api/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"wrong\"}"
```
(PowerShell: use `Invoke-WebRequest -Uri ... -Method POST` or `curl.exe` instead of `curl`.)

Each call shows up in the Live Feed within ~3 seconds — orders/track as incoming,
the calls to the mock services as outgoing.

### Option B — the traffic simulator (bulk/background traffic)

This seeds a steady stream of realistic-looking traffic and rotates through each
of the 5 security-flag scenarios automatically, useful if you just want the
dashboard to look "alive" without manually curling things:

```bash
cd demo-app
node simulate-traffic.js pk_live_xxxxxxxx
```

Leave it running — it sends a new batch every 3 seconds. Ctrl+C to stop.

Use your own Project Key (shown in the dashboard, or in the setup modal after
creating a project) in place of `pk_live_xxxxxxxx` above.

## How it's wired together

- **backend/** stores everything in a single `backend/data.json` file (auto-created)
  — no external database to set up.
- **sdk/apipulse-sdk** is a real npm-style package. It:
  - adds an Express middleware to time every incoming request
  - monkey-patches `http.request` / `https.request` to time every outgoing call
  - POSTs each event to `/api/ingest` on the backend, fire-and-forget (it will
    never throw or slow down the host app)
- **backend/security-flags.js** runs 5 fixed-threshold rules on every incoming
  event (HTTP-not-HTTPS, repeated auth failures, traffic spikes, repeated 5xx,
  abnormal response size) and stores any matches as flags.
- **frontend/** polls `/api/dashboard/:projectKey/{feed,summary,flags}` every
  3 seconds and renders the live feed, the per-API summary table, and the flags rail.

## Notes

- JWT secret defaults to a dev value — set `JWT_SECRET` in the environment for
  anything beyond local testing.
- `backend/data.json` is the whole database. Delete it to reset everything.
