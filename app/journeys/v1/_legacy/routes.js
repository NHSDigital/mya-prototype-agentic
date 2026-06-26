// Legacy / deprecated routes retained for backwards compatibility.
// These pre-date the journey split: old bookmarked URLs that now just redirect
// to the clinics list, plus the deprecated "old change" page. Kept isolated here
// so the active journeys stay clean.

const express = require('express');
const router = express.Router();

function redirectLegacyToClinics(req, res) {
  return res.redirect(`/site/${req.site_id}/clinics`);
}

router.get('/site/:id/availability/all', redirectLegacyToClinics);
router.get('/site/:id/availability/all/:groupId', redirectLegacyToClinics);
router.all('/site/:id/remove/:itemId', redirectLegacyToClinics);
router.all('/site/:id/remove/:itemId/:step', redirectLegacyToClinics);
router.all('/site/:id/change/group/:itemId', redirectLegacyToClinics);
router.all('/site/:id/change/group/:itemId/:step', redirectLegacyToClinics);

router.get('/site/:id/clinics/old-change/:sessionId', (req, res) => {
  res.render('_legacy/old-change-journey', {
    backHref: req.query.back || `/site/${req.site_id}/clinics/week`
  });
});

module.exports = router;
