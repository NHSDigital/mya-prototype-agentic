// -----------------------------------------------------------------------------
// Version middleware
// -----------------------------------------------------------------------------
// Lets multiple versions of the prototype (v1, v2, ...) run side by side under
// version-prefixed URLs (/v1/site/..., /v2/site/...) WITHOUT the journey route
// or view files needing to know which version they are. Applied at each version
// mount in app/journeys/index.js.
//
// For a request under /<version> it:
//   1. prepends "<version>/" to every res.render view name, so an unqualified
//      name like 'cancel-a-date-range/dates' resolves to
//      app/journeys/<version>/cancel-a-date-range/dates.html;
//   2. prefixes app-internal redirects (/site, /sites, /set-filters) with the
//      version, so res.redirect('/site/1/clinics') -> '/v1/site/1/clinics';
//   3. rewrites app-internal href/action/formaction attributes in the rendered
//      HTML the same way, so in-page links and form posts stay within the version.
//
// Shared chrome (layout, components) is NOT versioned: those are resolved by the
// Nunjucks loader (not res.render) and live under app/views/.
// -----------------------------------------------------------------------------

// App-internal absolute paths that belong to a version. Note '/sites' is covered
// by the '/site' test. '/login', '/not-in-this-prototype', '/' stay global.
const APP_PATH = /^\/(site|set-filters)(?=$|[/?#])/;
const ATTR_LINK = /\b(href|action|formaction)=(["'])(\/(?:site|set-filters)[^"']*)\2/gi;
const SHARED_RENDER_VIEW = /^(404|500)(?:\.html)?$/;

function prefixAppPath(url, prefix) {
  if (typeof url !== 'string') return url;
  if (url === prefix || url.startsWith(prefix + '/')) return url; // already versioned
  return APP_PATH.test(url) ? prefix + url : url;
}

function rewriteHtmlLinks(html, prefix) {
  if (typeof html !== 'string') return html;
  return html.replace(ATTR_LINK, (_m, attr, quote, path) => `${attr}=${quote}${prefix}${path}${quote}`);
}

module.exports = function versionMiddleware(version) {
  const prefix = '/' + version;

  return function (req, res, next) {
    res.locals.basePath = prefix;
    res.locals.appVersion = version;

    // 2. Prefix app-internal redirects.
    const _redirect = res.redirect.bind(res);
    res.redirect = function (statusOrUrl, maybeUrl) {
      if (typeof statusOrUrl === 'number') {
        return _redirect(statusOrUrl, prefixAppPath(maybeUrl, prefix));
      }
      return _redirect(prefixAppPath(statusOrUrl, prefix));
    };

    // 1 + 3. Version the view name and rewrite in-page app links.
    const _render = res.render.bind(res);
    res.render = function (view, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      const versionedView = view.startsWith(version + '/') || SHARED_RENDER_VIEW.test(view)
        ? view
        : `${version}/${view}`;
      _render(versionedView, options || {}, (err, html) => {
        if (err) return callback ? callback(err) : next(err);
        const out = rewriteHtmlLinks(html, prefix);
        if (callback) return callback(null, out);
        res.send(out);
      });
    };

    next();
  };
};
