# API Pulse: Complete Codebase Guide

This document explains the complete API Pulse project in Hinglish: folder structure, technology choices, runtime flow, SDK behavior, backend APIs, frontend behavior, demo setup, current limitations, and the path from final-year prototype to a real product.

## 1. Project Overview

API Pulse is a lightweight API observability and security-flagging platform.

The application has three main responsibilities:

1. Instrument an Express application through a drop-in Node.js SDK.
2. Receive and analyze incoming and outgoing API telemetry in a backend service.
3. Display traffic, latency, success rate, and rule-based security flags in a dashboard.

The current project is a working prototype. It is suitable for demonstration, academic evaluation, and early real-user validation. It is not yet production-grade SaaS infrastructure because it still uses a local JSON data store, polling, basic account controls, and a single-process architecture.

## 2. Top-Level Folder Structure

```text
api-pulse/
├── backend/
│   ├── server.js
│   ├── db.js
│   ├── auth-middleware.js
│   ├── config.js
│   ├── security-flags.js
│   ├── data.json
│   ├── package.json
│   └── package-lock.json
├── frontend/
│   ├── index.html
│   ├── dashboard.html
│   ├── app.js
│   ├── dashboard.js
│   └── style.css
├── sdk/
│   └── apipulse-sdk/
│       ├── index.js
│       └── package.json
├── demo-app/
│   ├── server.js
│   ├── mock-services.js
│   ├── simulate-traffic.js
│   ├── package.json
│   └── package-lock.json
├── README.md
└── PROJECT_CODEBASE_GUIDE.md
```

The `node_modules` folders are installed dependencies and are not application source code. They should not be treated as project modules or committed to source control.

## 3. Technology Stack

| Layer | Technology | Why it is used |
|---|---|---|
| Runtime | Node.js | Same language across backend, SDK, demo app, and scripts |
| Backend framework | Express.js | Lightweight HTTP server and middleware model |
| Authentication | JWT + bcryptjs | Stateless signed sessions plus password hashing |
| Storage | JSON file | Zero setup for a final-year prototype and local demo |
| SDK target | Node.js Express | Easy drop-in instrumentation for common backend apps |
| HTTP interception | Node `http` and `https` modules | Captures outgoing calls without requiring changes in every route |
| Frontend | Plain HTML, CSS, JavaScript | Minimal dependencies and easy hosting from Express |
| Dashboard refresh | Browser polling every 3 seconds | Simple near-real-time behavior without a WebSocket server |
| Demo services | Express mock services | Demonstrates real outgoing calls without paid APIs |
| IDs and keys | Node `crypto` | Generates project keys and entity IDs |

### Why JavaScript everywhere?

The project uses JavaScript end to end because the SDK is intended for Node.js applications, the demo app is Express-based, and using one language reduces setup and explanation overhead for a student project. It also makes the instrumentation code directly compatible with the demo server.

## 4. Runtime Architecture

```text
Developer's Express App
        │
        │ apipulse-sdk middleware + http/https interception
        ▼
API Pulse Backend :4000
        │
        ├── JWT authentication
        ├── Project ownership checks
        ├── Event validation and ingestion
        ├── Rule-based security evaluation
        └── JSON persistence
        │
        ▼
Dashboard UI served by the same Express backend
        │
        └── Polls feed, summary, and flags every 3 seconds
```

The demo app runs separately on port `5000`. Mock external services run on port `5001`. The demo app sends telemetry to the API Pulse backend on port `4000`.

## 5. Backend Folder

### `backend/server.js`

This is the central application server.

It does four jobs:

1. Serves the frontend files using `express.static`.
2. Provides account and project-management APIs.
3. Receives telemetry from the SDK and simulator.
4. Provides dashboard data APIs.

It starts an Express server using the configured `PORT`, which defaults to `4000`.

### Backend middleware

```js
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));
```

- `cors` allows browser clients or separately hosted apps to call the backend.
- `express.json` parses JSON request bodies and limits payload size.
- `express.static` lets one backend process serve both the API and dashboard.

### Authentication APIs

#### `POST /api/auth/signup`

Creates a user account.

- Normalizes the email to lowercase.
- Requires a password of at least eight characters.
- Hashes the password using `bcryptjs`.
- Stores the user in `data.json`.
- Returns a seven-day JWT.

#### `POST /api/auth/login`

Checks the email and password, then returns a JWT if valid.

#### `auth-middleware.js`

The `requireAuth` middleware reads the `Authorization: Bearer <token>` header, verifies the JWT, and places the authenticated user ID on `req.userId`.

### Project APIs

#### `POST /api/projects`

Creates a project owned by the authenticated user and generates a key such as:

```text
pk_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

The project key is what the SDK uses when submitting telemetry.

#### `GET /api/projects`

Returns only projects owned by the current user.

#### `DELETE /api/projects/:projectKey`

Deletes the project and its related events and flags.

### Telemetry APIs

#### `POST /api/ingest`

This is the main SDK ingestion endpoint. It does not use a JWT because the SDK is running inside another application. It authenticates the event using the project key.

The server validates:

- Project key exists.
- Event type is `incoming` or `outgoing`.
- API name exists and is below the length limit.
- HTTP method is valid.
- Status is between `100` and `599`.
- Duration is non-negative and within the allowed maximum.

After validation, the server:

1. Adds an ID and timestamp.
2. Stores the event.
3. Evaluates recent project history using `security-flags.js`.
4. Stores any new flags.
5. Trims old events and flags.
6. Saves the JSON store.

#### `POST /api/ingest/batch`

Accepts multiple events in one request. The simulator uses this endpoint to generate traffic efficiently.

Invalid events in a batch are skipped rather than failing the entire batch.

### Dashboard APIs

All dashboard data endpoints require JWT authentication and verify that the user owns the requested project.

#### `GET /api/dashboard/:projectKey/feed`

Returns recent events sorted newest first. The dashboard requests up to 50 events.

#### `GET /api/dashboard/:projectKey/summary`

Groups events by API and calculates:

- Total calls
- Average latency
- Success rate
- Number of active APIs

The current success definition is HTTP status `200` through `399`.

#### `GET /api/dashboard/:projectKey/flags`

Returns recent rule-engine flags for the project.

#### `GET /api/health`

Returns `{ "ok": true }` and is useful for a basic health check.

### `backend/db.js`

This is a small file-backed persistence layer.

The in-memory database has four arrays:

```js
{
  users: [],
  projects: [],
  events: [],
  flags: []
}
```

The module loads `data.json` when the process starts. `save()` debounces disk writes by 150 milliseconds, which prevents every telemetry event in a burst from writing separately.

The prototype also trims data per project:

- Maximum 500 events per project
- Maximum 200 flags per project

This prevents a local demo file from growing indefinitely, but it is not a replacement for a real retention policy.

### `backend/config.js`

Centralizes environment configuration:

- `PORT`, default `4000`
- `JWT_SECRET`, with a development fallback
- `CORS_ORIGIN`, default `*`
- `NODE_ENV`

In production, the code requires an explicitly provided `JWT_SECRET`. This prevents accidentally deploying with the development secret.

### `backend/security-flags.js`

The security engine is deliberately rule-based. It does not use AI or machine learning.

Current rules:

1. **Insecure HTTP**: flags API URLs beginning with `http://`.
2. **Repeated authentication failures**: flags five or more `401` or `403` responses on the same endpoint within two minutes.
3. **Traffic spike**: flags a three-times increase compared with the previous minute, with a minimum baseline of five calls.
4. **Repeated server errors**: flags three or more `5xx` responses on the same endpoint within two minutes.
5. **Large response**: flags responses larger than two megabytes.

Each flag contains severity, rule name, project key, API, message, and timestamp.

## 6. SDK Folder

### `sdk/apipulse-sdk/index.js`

This is the integration package that another Node.js Express app installs.

The intended setup is:

```js
const apipulse = require('apipulse-sdk');
apipulse.init(app, {
  projectKey: 'pk_live_...',
  backendUrl: 'http://localhost:4000'
});
```

### Incoming request monitoring

`incomingMiddleware()` is added using `app.use()`.

For every request it:

1. Records the start time.
2. Waits for the response `finish` event.
3. Calculates duration.
4. Sends an `incoming` event containing path, method, duration, and status.

Because it waits for `finish`, it records the final status code produced by the route.

### Outgoing request monitoring

The SDK stores the original `http.request` and `https.request` functions before patching them.

It then replaces the module functions with wrappers that:

1. Read the target URL and method.
2. Call the original request function.
3. Start a timer.
4. Listen for the response.
5. Send an `outgoing` event when the response arrives.

The SDK skips requests sent to the API Pulse backend itself. This is important because telemetry submission must not recursively create more telemetry.

### Failure isolation

Telemetry is fire-and-forget. Network errors are swallowed so monitoring cannot crash or block the host application.

That is a good prototype safety decision, but a product version should add a bounded retry queue, backoff, sampling, and clear delivery metrics.

### Current SDK boundary

The SDK currently observes Node `http.request` and `https.request`. It does not automatically cover every possible transport abstraction, such as:

- `fetch`
- Axios adapters
- GraphQL clients
- gRPC
- Browser-side requests

That is an important productization area.

## 7. Frontend Folder

The frontend is deliberately dependency-light: plain HTML, CSS, and browser JavaScript.

### `frontend/index.html`

Defines the login and signup screen:

- Email input
- Password input
- Sign-in button
- Toggle between login and signup modes

### `frontend/app.js`

Controls authentication UI.

It calls:

- `/api/auth/login`
- `/api/auth/signup`

After success it stores:

```text
apipulse_token
apipulse_email
```

in browser `localStorage`, then redirects to `dashboard.html`.

### `frontend/dashboard.html`

Defines the dashboard layout:

- Top bar and user identity
- Project chips
- New project modal
- Setup snippet modal
- Summary cards
- Live feed table
- Security flags panel
- Per-API summary table

### `frontend/dashboard.js`

Controls all dashboard behavior.

On load it:

1. Reads the JWT from `localStorage`.
2. Loads the user's projects.
3. Selects the first project.
4. Starts polling.

Every three seconds it requests the feed, summary, and flags in parallel using `Promise.all`.

The dashboard then calculates presentation states for:

- Total calls
- Average latency
- Success rate
- Active flags
- Status badges
- Incoming/outgoing labels
- Time-ago display

The header pulse line is a small SVG polyline whose points are generated from recent feed counts. It is a visual activity indicator, not a statistical chart.

### `frontend/style.css`

Provides the dark observability-dashboard theme.

Main style choices:

- Dark background for a developer-tool feel
- Teal accent for healthy activity
- Yellow warning and red critical states
- Space Grotesk for display text
- Inter for body text
- JetBrains Mono for API paths, identifiers, and metrics
- CSS grid for cards and dashboard panels

Current limitation: `body { min-width: 1024px; }`, so the UI is not genuinely mobile responsive yet.

## 8. Demo App Folder

### `demo-app/server.js`

This is a realistic sample customer application, not the monitoring backend.

It installs and initializes the SDK exactly as a user would:

```js
const apipulse = require('apipulse-sdk');
apipulse.init(app, { projectKey: PROJECT_KEY, backendUrl: BACKEND_URL });
```

It exposes:

- `POST /api/orders`: makes payment and SMS calls.
- `GET /api/orders/:id`: returns an order.
- `GET /api/orders/:id/track`: makes a geocoding call.
- `POST /api/login`: intentionally supports failed login demonstrations.

The app runs on port `5000`.

### `demo-app/mock-services.js`

Provides local stand-ins for external providers:

- Payment gateway at `/charges`
- SMS gateway at `/messages`
- Geocoding service at `/geocode`

The service adds random delays and occasionally returns a payment `500`. This creates real outgoing HTTP traffic without depending on Stripe, Twilio, Google Maps, or internet credentials.

It runs on port `5001`.

### `demo-app/simulate-traffic.js`

Sends batch telemetry directly to the backend every three seconds.

It cycles through five anomaly types:

- HTTP instead of HTTPS
- Repeated login failures
- Traffic spikes
- Repeated server errors
- Oversized responses

This is useful for repeatable demonstrations and screenshots. It is not the same as SDK instrumentation because it sends event payloads directly to ingestion.

## 9. Complete Request Flow

### Example: `POST /api/orders`

1. A user calls the demo app on port `5000`.
2. The SDK's incoming middleware starts a timer.
3. The route calls the payment mock and SMS mock using `http.request`.
4. The SDK's outgoing patch observes both calls.
5. The order route sends its final response.
6. The incoming middleware submits the incoming event.
7. The outgoing wrappers submit the outgoing events.
8. The backend validates project key and event fields.
9. The backend stores events in memory and eventually `data.json`.
10. The rule engine checks the new events against recent project history.
11. The dashboard polls and shows the new rows within approximately three seconds.

### Example: repeated failed login

1. The demo login route returns `401`.
2. The SDK records an incoming event for `/api/login`.
3. After the fifth failure within two minutes, the rule engine creates a critical `auth_failures` flag.
4. The dashboard displays it in the Security Flags section.

## 10. Security Model Today

Current protections include:

- bcrypt password hashing
- JWT authentication
- Project ownership checks
- Project-key validation for telemetry
- Basic input normalization and validation
- Authentication rate limiting
- Ingestion rate limiting
- Production requirement for an explicit JWT secret
- Dashboard HTML escaping for API and flag text

Important current risks:

- The default CORS policy is `*` unless configured.
- Project keys are bearer credentials and do not currently have rotation or revocation.
- JWTs are stored in `localStorage`, which increases the impact of an XSS vulnerability.
- JSON storage is not safe for multi-process or high-concurrency production use.
- There is no audit log, team role system, or organization boundary.
- There is no TLS termination or deployment configuration in this repository.

## 11. Why the Prototype Uses JSON Instead of PostgreSQL

The JSON store is intentional for the current stage:

- One command starts the backend.
- No database installation is needed.
- The data is easy to inspect during a seminar.
- The project remains understandable to evaluators.

The tradeoff is that JSON is not suitable for real users at scale. Concurrent writes can conflict, queries are linear scans, and analytics become expensive as events grow.

## 12. Current Product Maturity

### Already working

- Account signup and login
- JWT-protected dashboard
- Multi-project ownership model
- Project-key onboarding
- Incoming Express monitoring
- Outgoing Node HTTP monitoring
- Single and batch telemetry ingestion
- Rule-based security flags
- Per-API summary metrics
- Local mock-service demo
- Repeatable traffic simulator
- Dashboard screenshots and seminar deck

### Not yet production-ready

- Persistent relational or time-series database
- Automated test suite
- WebSocket or server-sent-event live updates
- Charts and historical time windows
- Alert acknowledgement and resolution
- Email, Slack, or webhook notifications
- API-key rotation and scoped keys
- Team accounts and roles
- Mobile/responsive frontend
- Deployment manifests and observability for API Pulse itself
- SDK support for fetch, Axios, and more transports
- Privacy controls for sensitive URLs and payload metadata

## 13. Recommended Product Evolution

### Phase 1: Real-user validation

Keep the architecture recognizable while improving reliability:

1. Add automated tests for auth, projects, ingest, rules, and SDK behavior.
2. Add request IDs and structured server logs.
3. Add a proper `.env.example` and deployment instructions.
4. Add safe CORS configuration.
5. Add API-key rotation and project deletion safeguards.
6. Add event sampling and redaction options.

### Phase 2: Production backend

Replace JSON with:

- PostgreSQL for users, projects, permissions, and configuration.
- TimescaleDB or ClickHouse-style storage for high-volume event analytics, depending on scale.
- Redis for rate limits, short windows, and queue coordination.

Introduce a background ingestion pipeline so telemetry submission does not compete with dashboard requests.

### Phase 3: Better observability

Add:

- p50, p95, and p99 latency
- Time-range filters
- Error-rate charts
- Endpoint grouping and normalization
- Deployment or release markers
- Trace or correlation IDs
- Alert deduplication
- Alert acknowledgement and resolution

### Phase 4: SDK expansion

Support:

- `fetch`
- Axios
- Fastify and other Node frameworks
- OpenTelemetry export
- Configurable sampling
- Bounded local queue with retry and backoff
- Redaction of authorization headers, tokens, query parameters, and personal data
- Separate ingestion key and read-only dashboard key

### Phase 5: SaaS product

Add:

- Organizations and teams
- Role-based access control
- Usage plans and quotas
- Tenant isolation
- Billing integration
- Cloud deployment
- Audit logs
- Self-service onboarding
- Documentation site and public SDK package

## 14. Patent and IP Direction

The current implementation uses known building blocks: API monitoring, SDK instrumentation, event ingestion, threshold rules, and dashboards. Those individual concepts are common.

A potential patent discussion would need to focus on a genuinely novel and technically specific combination, for example:

- A new method for correlating incoming and outgoing API activity with low overhead.
- A particular privacy-preserving telemetry representation.
- A new adaptive risk-scoring or detection mechanism.
- A technically distinct SDK architecture that works across several transports while preserving application behavior.

The current rule engine alone should not be assumed to be patentable. Before filing, perform a prior-art search and consult a registered patent professional. Copyright protection for source code, documentation, diagrams, and presentation material is a separate and more immediate possibility.

## 15. Final Mental Model

Remember the project with this four-part model:

```text
SDK = observes traffic
Backend = validates, stores, and evaluates traffic
Frontend = explains traffic to the developer
Demo app = proves the whole loop with realistic calls
```

The project is already a coherent full-stack prototype. The main next step is not adding random features. It is validating the workflow with real users, measuring whether the signals are useful, and then replacing the prototype infrastructure with durable product infrastructure.
