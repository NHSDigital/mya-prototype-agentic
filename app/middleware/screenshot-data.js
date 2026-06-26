// -----------------------------------------------------------------------------
// Screenshot data hydration middleware
// -----------------------------------------------------------------------------
// Lets the screenshot capture script (and anyone hitting a route by hand) render
// a specific *variant* of a page deterministically, by supplying state via the
// `x-journey-screenshot-data` request header (base64url-encoded JSON).
//
// The decoded object is DEEP-MERGED into req.session.data BEFORE the per-site
// context middleware runs (app/journeys/v1/_shared/site-context.js), which
// rebuilds derived availability/history from req.session.data on every request.
// So a map.json variant's `data` (closures, dates, bookings, ...) takes effect
// just by being merged in here.
//
// A few keys are treated specially:
//   - `today`    -> overrides req.session.data.today and the OVERRIDE_TODAY env
//                   for this request (drives date-relative seeding/labels).
//   - `features` -> shallow-merged onto req.features (feature flags).
// Everything else is deep-merged onto req.session.data.
//
// Registered once in app/routes.js, before require('./journeys').
// -----------------------------------------------------------------------------

const HEADER = 'x-journey-screenshot-data';
const QUERY_PARAM = '_data';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Deep-merge source into target in place. Arrays and primitives replace.
function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) return source;
  for (const key of Object.keys(source)) {
    const next = source[key];
    if (isPlainObject(next) && isPlainObject(target[key])) {
      deepMerge(target[key], next);
    } else {
      target[key] = next;
    }
  }
  return target;
}

function decodeBase64url(encoded) {
  try {
    const rawJson = Buffer.from(String(encoded), 'base64url').toString('utf8');
    const parsed = JSON.parse(rawJson);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decodeHeader(req) {
  const headerValue = req.get(HEADER);
  if (!headerValue) return null;
  return decodeBase64url(headerValue);
}

function decodeQueryParam(req) {
  const paramValue = req.query?.[QUERY_PARAM];
  if (!paramValue) return null;
  return decodeBase64url(paramValue);
}

function screenshotDataMiddleware(req, res, next) {
  const data = decodeHeader(req) || decodeQueryParam(req);
  if (!data) return next();

  // Ensure a session data object exists (the kit normally creates it first).
  req.session = req.session || {};
  req.session.data = req.session.data || {};

  const { today, features, ...rest } = data;

  if (today !== undefined && today !== null && today !== '') {
    req.session.data.today = String(today);
    // OVERRIDE_TODAY is read by getToday() in _shared/helpers.js.
    process.env.OVERRIDE_TODAY = String(today);
  }

  if (isPlainObject(features)) {
    req.features = Object.assign({}, req.features, features);
  }

  deepMerge(req.session.data, rest);

  // Expose for templates/debugging; the real effect is the session merge above.
  res.locals.screenshotData = data;

  next();
}

module.exports = { screenshotDataMiddleware, deepMerge, HEADER, QUERY_PARAM };
