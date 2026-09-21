// apipulse-sdk
// Usage:
//   const apipulse = require('apipulse-sdk');
//   apipulse.init(app, { projectKey: 'pk_live_...' });
//
// Tracks:
//  - Incoming requests to your Express app (method, path, status, duration)
//  - Outgoing http/https calls your app makes to other APIs (Stripe, Twilio, etc.)
// and streams both to the API Pulse dashboard in real time.

const http = require('http');
const https = require('https');
const { URL } = require('url');

// keep references to the *original* request functions before anything is patched,
// so the SDK's own calls back to the backend never get re-captured as "outgoing" traffic.
const originalHttpRequest = http.request.bind(http);
const originalHttpsRequest = https.request.bind(https);

let DEFAULT_BACKEND_URL = 'http://localhost:4000';

function rawSend(backendUrl, event) {
  try {
    const target = new URL('/api/ingest', backendUrl);
    const isHttps = target.protocol === 'https:';
    const body = JSON.stringify(event);
    const requestFn = isHttps ? originalHttpsRequest : originalHttpRequest;
    const req = requestFn({
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    });
    req.on('error', () => { /* never let monitoring crash the host app */ });
    req.write(body);
    req.end();
  } catch (e) {
    // swallow — monitoring must never break the app it's monitoring
  }
}

function stripQuery(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch (e) {
    return url.split('?')[0];
  }
}

let patched = false;
function patchOutgoing(projectKey, backendUrl) {
  if (patched) return;
  patched = true;

  const backendHost = (() => {
    try { return new URL(backendUrl).host; } catch (e) { return ''; }
  })();

  [ { mod: http, protocol: 'http' }, { mod: https, protocol: 'https' } ].forEach(({ mod, protocol }) => {
    const original = mod.request;
    mod.request = function (...args) {
      let urlStr, method = 'GET';

      if (typeof args[0] === 'string' || args[0] instanceof URL) {
        urlStr = args[0].toString();
        if (args[1] && typeof args[1] === 'object' && args[1].method) method = args[1].method;
      } else if (args[0] && typeof args[0] === 'object') {
        const opts = args[0];
        const host = opts.hostname || opts.host || 'localhost';
        const port = opts.port ? `:${opts.port}` : '';
        const path = opts.path || '/';
        urlStr = `${protocol}://${host}${port}${path}`;
        if (opts.method) method = opts.method;
      }

      const req = original.apply(mod, args);

      if (urlStr) {
        let skip = false;
        try { skip = new URL(urlStr).host === backendHost; } catch (e) {}

        if (!skip) {
          const start = Date.now();
          req.on('response', (res) => {
            rawSend(backendUrl, {
              projectKey,
              type: 'outgoing',
              api: stripQuery(urlStr),
              method,
              duration: Date.now() - start,
              status: res.statusCode,
            });
          });
        }
      }

      return req;
    };
  });
}

function incomingMiddleware(projectKey, backendUrl) {
  return function (req, res, next) {
    const start = Date.now();
    res.on('finish', () => {
      rawSend(backendUrl, {
        projectKey,
        type: 'incoming',
        api: req.path || req.originalUrl || req.url,
        method: req.method,
        duration: Date.now() - start,
        status: res.statusCode,
      });
    });
    next();
  };
}

/**
 * init(app, { projectKey, backendUrl })
 * - app: your Express app (required, so incoming requests can be tracked)
 * - projectKey: the key from your API Pulse project (required)
 * - backendUrl: where the API Pulse backend runs (default http://localhost:4000)
 */
function init(app, options = {}) {
  const { projectKey, backendUrl = DEFAULT_BACKEND_URL } = options;
  if (!projectKey) throw new Error('apipulse-sdk: projectKey is required');
  if (!app || typeof app.use !== 'function') throw new Error('apipulse-sdk: an Express app instance is required');

  app.use(incomingMiddleware(projectKey, backendUrl));
  patchOutgoing(projectKey, backendUrl);

  console.log(`[apipulse] monitoring active for project ${projectKey} → ${backendUrl}`);
}

module.exports = { init };
