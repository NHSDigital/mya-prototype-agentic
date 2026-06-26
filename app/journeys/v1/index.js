// -----------------------------------------------------------------------------
// Journeys composition
// -----------------------------------------------------------------------------
// Single router that registers shared per-site context, then mounts every
// journey. Each journey lives in its own folder under app/journeys/<journey>/
// with its route file co-located beside its view (.html) files, so a URL maps
// obviously to a folder.
//
// Mount order matters: the legacy base.js router defines a catch-all set of
// clinic routes and the legacy redirects, so already-migrated journeys are
// mounted first and base.js last (it shrinks as journeys are peeled off).
// -----------------------------------------------------------------------------

const express = require('express');
const router = express.Router();

const { idParamHandler, siteContextMiddleware } = require('./_shared/site-context');

// Shared per-site context for all /site/:id routes, registered once.
router.param('id', idParamHandler);
router.use('/site/:id', siteContextMiddleware);

// Migrated journeys
router.use('/', require('./sites/routes'));
router.use('/', require('./clinics/routes'));
router.use('/', require('./cancel-a-date-range/routes'));
router.use('/', require('./availability/routes'));
router.use('/', require('./change-clinic-that-is-part-of-a-clinic-series/routes'));
router.use('/', require('./_cancel-clinics/routes'));
router.use('/', require('./_change-clinics/routes'));
router.use('/', require('./_create-clinics/routes'));

// Legacy redirects + the deprecated old-change page.
router.use('/', require('./_legacy/routes'));

module.exports = router;
