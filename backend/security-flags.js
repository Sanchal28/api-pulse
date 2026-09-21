// security-flags.js
// All rule-based (fixed-threshold if/else), no AI/ML — this is a deliberate scope
// decision documented in the project spec.

const THRESHOLDS = {
  AUTH_FAILURE_COUNT: 5,      // 401/403 hits
  AUTH_FAILURE_WINDOW_MS: 2 * 60 * 1000,   // in last 2 minutes
  SERVER_ERROR_COUNT: 3,      // 500s
  SERVER_ERROR_WINDOW_MS: 2 * 60 * 1000,   // in last 2 minutes
  SPIKE_WINDOW_MS: 60 * 1000,              // last 1 minute
  SPIKE_MULTIPLIER: 3,        // 3x the recent average = spike
  SPIKE_MIN_BASELINE: 5,      // ignore spike math on tiny sample sizes
  LARGE_RESPONSE_BYTES: 2 * 1024 * 1024,   // 2MB
};

function isHttp(url) {
  return typeof url === 'string' && url.trim().toLowerCase().startsWith('http://');
}

/**
 * Runs all 5 rules against the just-ingested event, using the project's
 * recent event history. Returns an array of new flag objects (possibly empty).
 */
function evaluate(event, recentEvents) {
  const flags = [];
  const now = event.timestamp;

  // 1. HTTP instead of HTTPS
  if (isHttp(event.api)) {
    flags.push(mkFlag('warning', 'insecure_http', event,
      `Unencrypted call to ${event.api} — use HTTPS instead of HTTP.`));
  }

  // 2. Repeated authentication failures (401/403) on same endpoint
  if (event.status === 401 || event.status === 403) {
    const windowStart = now - THRESHOLDS.AUTH_FAILURE_WINDOW_MS;
    const sameEndpointFailures = recentEvents.filter(e =>
      e.api === event.api &&
      (e.status === 401 || e.status === 403) &&
      e.timestamp >= windowStart
    );
    if (sameEndpointFailures.length >= THRESHOLDS.AUTH_FAILURE_COUNT) {
      flags.push(mkFlag('critical', 'auth_failures', event,
        `Repeated auth failures on ${event.api} — ${sameEndpointFailures.length} attempts in the last 2 minutes (possible brute-force).`));
    }
  }

  // 3. Sudden traffic spike for this API
  {
    const windowStart = now - THRESHOLDS.SPIKE_WINDOW_MS;
    const lastMinuteCount = recentEvents.filter(e =>
      e.api === event.api && e.timestamp >= windowStart
    ).length;
    const priorWindowStart = windowStart - THRESHOLDS.SPIKE_WINDOW_MS;
    const priorMinuteCount = recentEvents.filter(e =>
      e.api === event.api && e.timestamp >= priorWindowStart && e.timestamp < windowStart
    ).length;
    if (
      priorMinuteCount >= THRESHOLDS.SPIKE_MIN_BASELINE &&
      lastMinuteCount >= priorMinuteCount * THRESHOLDS.SPIKE_MULTIPLIER
    ) {
      flags.push(mkFlag('warning', 'traffic_spike', event,
        `Traffic spike on ${event.api} — ${lastMinuteCount} calls in the last minute vs ~${priorMinuteCount} before.`));
    }
  }

  // 4. Repeated server errors (500s)
  if (event.status >= 500) {
    const windowStart = now - THRESHOLDS.SERVER_ERROR_WINDOW_MS;
    const sameEndpoint500s = recentEvents.filter(e =>
      e.api === event.api && e.status >= 500 && e.timestamp >= windowStart
    );
    if (sameEndpoint500s.length >= THRESHOLDS.SERVER_ERROR_COUNT) {
      flags.push(mkFlag('critical', 'server_errors', event,
        `Repeated server errors on ${event.api} — ${sameEndpoint500s.length} x 5xx responses in the last 2 minutes.`));
    }
  }

  // 5. Abnormal response size
  if (typeof event.responseSize === 'number' && event.responseSize > THRESHOLDS.LARGE_RESPONSE_BYTES) {
    flags.push(mkFlag('warning', 'large_response', event,
      `Unusually large response from ${event.api} — ${(event.responseSize / (1024 * 1024)).toFixed(2)} MB.`));
  }

  return flags;
}

function mkFlag(severity, rule, event, message) {
  return {
    id: `flg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    projectKey: event.projectKey,
    severity,        // 'critical' | 'warning'
    rule,
    api: event.api,
    message,
    timestamp: event.timestamp,
  };
}

module.exports = { evaluate, THRESHOLDS };
