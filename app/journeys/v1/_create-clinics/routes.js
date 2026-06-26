// Journey: create a clinic (single date OR weekly/recurring series)
// URL base: /site/:id/clinics/(type-of-clinc|details|days|clinic-times|services|clinic-closures*|check-answers|success)
// Views live in concept-level folders; the single/series choice is data-driven
// (clinicFlowType) so it is not part of the URL.

const express = require('express');
const router = express.Router();
const { DateTime } = require('luxon');
const { randomUUID } = require('crypto');
const {
  getToday,
  asArray,
  normalizeSessionType,
  clinicFlowType,
  ensureCreateSession,
  toTimeString,
  toTimeParts,
  toDateParts,
  inferClinicTypeFromModel,
  toIsoDate,
  toIsoDateIfValid,
  toDateInputParts,
  parseClosureFromBody,
  validateClosureWithinClinicDateRange,
  toEditableClosure,
  toClosureFormInput,
  toByDay,
  buildSessionLabel,
  buildRecurringSessionModel,
  persistRecurringSession,
  clone,
  getEditState,
  setEditState,
  clearEditState,
  getEditSuccessState,
  setEditSuccessState,
  bookingCountText,
  useClinicTimesAndCapacity,
  resetEditOutcome,
  editFieldsForStep,
  currentEditableFields,
  setCurrentEditField,
  setCurrentEditStep,
  editSummaryPath,
  cancelSummaryPath,
  editStepPath,
  editStepForField,
  setEditTemplateData,
  updateDraftFromDetails,
  updateDraftFromDays,
  updateDraftFromTimes,
  updateDraftFromAppointments,
  updateDraftFromServices,
  normalizeIsoMinute,
  modelToDraft,
  draftToNewSession,
  draftToModel,
  normalizedBookingImpact,
  ensureEditStateForSession,
  initializeEditStateForSession,
  calculateCancellationAffectedBookings,
  findSessionOccurrenceForCancellation,
  calculateCancellationAffectedBookingsForOccurrence,
  initializeCancelStateForSession,
  parseDateInputToISO,
  hasEditFieldChanged,
  normalizeClosuresForComparison,
  normalizeEditableClosure,
  ensureClosureTrackingState,
  nextClosureEditId,
  closuresMatch,
  buildClosureComparisons,
  buildChangedFieldKeysForEdit,
  childSessionUnaffectedByField,
  formatShortDate,
  buildUnaffectedChildClinicDates,
  buildUnaffectedChildReasonText,
  reviewBackPath,
  prepareReviewAfterEdit,
  calculateAffectedBookings,
  applyAffectedBookingAction,
  isSeriesHistoryRow,
  toPositiveInteger,
  paginateItems,
  buildPaginationHref,
  buildNhsPagination,
  buildSessionHistory,
  buildPastSessionHistory,
  buildLegacyAvailabilitySessions,
  sortSessionsForAvailability,
  slotMatchesSession,
  buildWeekAvailabilitySummary,
  buildMonthWeekRanges,
  buildMonthAvailabilitySummary,
  enhanceData,
  buildCancelledBookingsSummary,
  mergeDailyAvailability,
  sessionDataDefaults,
} = require('../_shared/helpers');

function conceptFolderForCreateData(data) {
  return clinicFlowType(data) === 'single'
    ? 'create-single-clinic'
    : 'create-clinic-series';
}

router.all('/site/:id/clinics/type-of-session', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(`/site/${req.site_id}/clinics/type-of-clinc${query}`);
});

router.all('/site/:id/clinics/type-of-clinc', (req, res) => {
  if (req.method === 'GET' && req.query.new === '1') {
    delete req.session.data.newSession;
  }

  ensureCreateSession(req.session.data);
  res.render(`${conceptFolderForCreateData(req.session.data)}/type-of-clinc`);
});

router.all('/site/:id/clinics/dates', (req, res) => {
  return res.redirect(`/site/${req.site_id}/clinics/details`);
});

router.all('/site/:id/clinics/details', (req, res) => {
  ensureCreateSession(req.session.data);

  const flowType = clinicFlowType(req.session.data);
  if (!flowType) {
    return res.redirect(`/site/${req.site_id}/clinics/type-of-clinc`);
  }

  return res.render(`${conceptFolderForCreateData(req.session.data)}/details`);
});

router.all('/site/:id/clinics/days', (req, res) => {
  ensureCreateSession(req.session.data);
  const flowType = clinicFlowType(req.session.data);

  if (!flowType) {
    return res.redirect(`/site/${req.site_id}/clinics/type-of-clinc`);
  }

  if (flowType === 'single') {
    return res.redirect(`/site/${req.site_id}/clinics/clinic-times`);
  }

  return res.render(`${conceptFolderForCreateData(req.session.data)}/days`);
});

router.all('/site/:id/clinics/time-and-capacity', (req, res) => {
  return res.redirect(`/site/${req.site_id}/clinics/clinic-times`);
});

router.all('/site/:id/clinics/clinic-times', (req, res) => {
  ensureCreateSession(req.session.data);
  const flowType = clinicFlowType(req.session.data);

  if (!flowType) {
    return res.redirect(`/site/${req.site_id}/clinics/type-of-clinc`);
  }

  return res.render(`${conceptFolderForCreateData(req.session.data)}/clinic-times`, {
    formAction: `/site/${req.site_id}/clinics/services`,
    durationCanChange: true
  });
});

router.all('/site/:id/clinics/appointments-calculator', (req, res) => {
  ensureCreateSession(req.session.data);
  const flowType = clinicFlowType(req.session.data);

  if (!flowType) {
    return res.redirect(`/site/${req.site_id}/clinics/type-of-clinc`);
  }

  return res.redirect(`/site/${req.site_id}/clinics/clinic-times`);
});

router.all('/site/:id/clinics/services', (req, res) => {
  ensureCreateSession(req.session.data);
  const flowType = clinicFlowType(req.session.data);

  if (!flowType) {
    return res.redirect(`/site/${req.site_id}/clinics/type-of-clinc`);
  }

  res.render(`${conceptFolderForCreateData(req.session.data)}/services`, {
    backUrl: `/site/${req.site_id}/clinics/clinic-times`,
    ...req.query
  });
});

router.all('/site/:id/clinics/clinic-closures', (req, res) => {
  ensureCreateSession(req.session.data);
  let flowType = clinicFlowType(req.session.data);

  if (flowType !== 'series') {
    const postedType = normalizeSessionType(req.body?.newSession?.type);
    if (postedType === 'Clinic series') {
      req.session.data.newSession = req.session.data.newSession || {};
      req.session.data.newSession.type = 'Clinic series';
      flowType = 'series';
    }
  }

  if (flowType !== 'series') {
    return res.redirect(`/site/${req.site_id}/clinics/check-answers`);
  }

  const closures = asArray(req.session.data.newSession.closures);

  if (req.method === 'POST') {
    const addAnother = req.body?.addAnother;
    if (addAnother === 'yes') {
      return res.redirect(`/site/${req.site_id}/clinics/clinic-closures/add`);
    }

    if (addAnother === 'no') {
      return res.redirect(`/site/${req.site_id}/clinics/check-answers`);
    }

    if (closures.length > 0) {
      return res.redirect(`/site/${req.site_id}/clinics/check-answers`);
    }

    // Initial POST from services should stay on this page. Missing radio selection shows an error.
    return res.render(`${conceptFolderForCreateData(req.session.data)}/clinic-closures`, {
      closures,
      addAnother,
      errors: {
        addAnother: 'Select yes if there are dates when this clinic will not run'
      }
    });
  }

  return res.render(`${conceptFolderForCreateData(req.session.data)}/clinic-closures`, {
    closures
  });
});

router.all('/site/:id/clinics/clinic-closures/add', (req, res) => {
  ensureCreateSession(req.session.data);
  let flowType = clinicFlowType(req.session.data);

  if (flowType !== 'series') {
    const postedType = normalizeSessionType(req.body?.newSession?.type);
    if (postedType === 'Clinic series') {
      req.session.data.newSession = req.session.data.newSession || {};
      req.session.data.newSession.type = 'Clinic series';
      flowType = 'series';
    }
  }

  if (flowType !== 'series') {
    return res.redirect(`/site/${req.site_id}/clinics/check-answers`);
  }

  if (req.method === 'POST') {
    const parsed = parseClosureFromBody(req.body?.closure || {});
    const clinicStartDate = toIsoDateIfValid(req.session.data.newSession?.startDate);
    const clinicEndDate = toIsoDateIfValid(req.session.data.newSession?.endDate);
    const closureErrors = validateClosureWithinClinicDateRange(parsed, clinicStartDate, clinicEndDate);
    if (closureErrors) {
      return res.render(`${conceptFolderForCreateData(req.session.data)}/clinic-closures-form`, {
        mode: 'add',
        closure: toClosureFormInput(req.body?.closure || {}),
        actionHref: `/site/${req.site_id}/clinics/clinic-closures/add`,
        errors: closureErrors
      });
    }

    req.session.data.newSession.closures = req.session.data.newSession.closures || [];
    req.session.data.newSession.closures.push(parsed);
    return res.redirect(`/site/${req.site_id}/clinics/clinic-closures`);
  }

  return res.render(`${conceptFolderForCreateData(req.session.data)}/clinic-closures-form`, {
    mode: 'add',
    closure: toClosureFormInput({
      name: '',
      startDate: { day: '', month: '', year: '' },
      endDate: { day: '', month: '', year: '' }
    }),
    actionHref: `/site/${req.site_id}/clinics/clinic-closures/add`
  });
});

router.all('/site/:id/clinics/clinic-closures/:index/change', (req, res) => {
  ensureCreateSession(req.session.data);
  let flowType = clinicFlowType(req.session.data);

  if (flowType !== 'series') {
    const postedType = normalizeSessionType(req.body?.newSession?.type);
    if (postedType === 'Clinic series') {
      req.session.data.newSession = req.session.data.newSession || {};
      req.session.data.newSession.type = 'Clinic series';
      flowType = 'series';
    }
  }

  if (flowType !== 'series') {
    return res.redirect(`/site/${req.site_id}/clinics/check-answers`);
  }

  const index = Number(req.params.index);
  const closures = req.session.data.newSession.closures || [];
  const current = closures[index];

  if (!Number.isInteger(index) || index < 0 || !current) {
    return res.redirect(`/site/${req.site_id}/clinics/clinic-closures`);
  }

  if (req.method === 'POST') {
    const parsed = parseClosureFromBody(req.body?.closure || {});
    const clinicStartDate = toIsoDateIfValid(req.session.data.newSession?.startDate);
    const clinicEndDate = toIsoDateIfValid(req.session.data.newSession?.endDate);
    const closureErrors = validateClosureWithinClinicDateRange(parsed, clinicStartDate, clinicEndDate);
    if (closureErrors) {
      return res.render(`${conceptFolderForCreateData(req.session.data)}/clinic-closures-form`, {
        mode: 'change',
        closure: toClosureFormInput(req.body?.closure || toEditableClosure(current)),
        actionHref: `/site/${req.site_id}/clinics/clinic-closures/${index}/change`,
        errors: closureErrors
      });
    }

    closures[index] = parsed;
    req.session.data.newSession.closures = closures;
    return res.redirect(`/site/${req.site_id}/clinics/clinic-closures`);
  }

  return res.render(`${conceptFolderForCreateData(req.session.data)}/clinic-closures-form`, {
    mode: 'change',
    closure: toClosureFormInput(toEditableClosure(current)),
    actionHref: `/site/${req.site_id}/clinics/clinic-closures/${index}/change`
  });
});

router.all('/site/:id/clinics/clinic-closures/:index/remove', (req, res) => {
  ensureCreateSession(req.session.data);
  let flowType = clinicFlowType(req.session.data);

  if (flowType !== 'series') {
    const postedType = normalizeSessionType(req.body?.newSession?.type);
    if (postedType === 'Clinic series') {
      req.session.data.newSession = req.session.data.newSession || {};
      req.session.data.newSession.type = 'Clinic series';
      flowType = 'series';
    }
  }

  if (flowType !== 'series') {
    return res.redirect(`/site/${req.site_id}/clinics/check-answers`);
  }

  const index = Number(req.params.index);
  const closures = req.session.data.newSession.closures || [];
  const current = closures[index];

  if (!Number.isInteger(index) || index < 0 || !current) {
    return res.redirect(`/site/${req.site_id}/clinics/clinic-closures`);
  }

  if (req.method === 'POST') {
    const confirmRemove = req.body?.confirmRemove;
    if (confirmRemove === 'yes') {
      closures.splice(index, 1);
      req.session.data.newSession.closures = closures;
      return res.redirect(`/site/${req.site_id}/clinics/clinic-closures`);
    }

    if (confirmRemove === 'no') {
      return res.redirect(`/site/${req.site_id}/clinics/clinic-closures`);
    }

    return res.render(`${conceptFolderForCreateData(req.session.data)}/clinic-closures-remove`, {
      index,
      closure: current,
      confirmRemove,
      errors: {
        confirmRemove: 'Select yes if you want to remove this closure'
      }
    });
  }

  return res.render(`${conceptFolderForCreateData(req.session.data)}/clinic-closures-remove`, {
    index,
    closure: current
  });
});

router.all('/site/:id/clinics/check-answers', (req, res) => {
  ensureCreateSession(req.session.data);
  const flowType = clinicFlowType(req.session.data);

  if (!flowType) {
    return res.redirect(`/site/${req.site_id}/clinics/type-of-clinc`);
  }

  res.render(`${conceptFolderForCreateData(req.session.data)}/check-answers`);
});

router.all('/site/:id/clinics/process-new-session', (req, res) => {
  const data = req.session.data;
  const site_id = req.site_id;
  const newSession = ensureCreateSession(data);

  if (!newSession) {
    return res.redirect(`/site/${site_id}/clinics?new-session=false`);
  }

  const createdFlowType = clinicFlowType(data);
  const recurringSession = buildRecurringSessionModel(newSession);
  if (data.editingSessionId) {
    recurringSession.id = data.editingSessionId;
  }
  persistRecurringSession(data, site_id, recurringSession);
  delete data.newSession;
  delete data.editingSessionId;
  data.lastCreatedClinicFlowType = createdFlowType;

  res.redirect(`/site/${site_id}/clinics/success`);
});

router.get('/site/:id/clinics/success', (req, res) => {
  const flowType = clinicFlowType(req.session.data) || req.session.data.lastCreatedClinicFlowType;

  if (!flowType) {
    return res.render('create-clinic-series/success');
  }

  res.render(`${flowType === 'single' ? 'create-single-clinic' : 'create-clinic-series'}/success`);
});

module.exports = router;
