// Journey: change a clinic (a first-class single clinic OR a whole clinic series)
// URL base: /site/:id/clinics/edit/:sessionId/*
// Operates on first-class daily_availability objects; the date IS editable.
// Views live in concept-level folders. The single/series split is data-driven
// (state.draft.type) and therefore cannot appear in the URL.

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

function conceptFolderForEditState(state) {
  return state?.draft?.type === 'Clinic series'
    ? 'change-clinic-series'
    : 'change-single-clinic';
}

router.get('/site/:id/clinics/edit/:sessionId', (req, res) => {
  const data = req.session.data;
  const state = initializeEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics`);
  }

  const backHref = typeof req.query?.back === 'string'
    && req.query.back.startsWith('/')
    && !req.query.back.startsWith('//')
    ? req.query.back
    : `/site/${req.site_id}/clinics`;

  return res.render(`${conceptFolderForEditState(state)}/summary-parent`, {
    draft: state.draft,
    sessionId: req.params.sessionId,
    backHref
  });
});

// Cancel-clinic journey lives in app/journeys/v1/_cancel-clinics/routes.js.

router.all('/site/:id/clinics/edit/:sessionId/details', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics`);
  }

  if (state.currentEditStep !== 'details') {
    setCurrentEditStep(state, 'details');
    setEditState(data, state);
  }

  if (req.method === 'POST') {
    updateDraftFromDetails(state, req.body?.newSession || {});
    return res.redirect(prepareReviewAfterEdit(data, req.site_id, state));
  }

  setEditTemplateData(res, data, state);
  return res.render(`${conceptFolderForEditState(state)}/details`, {
    backUrl: editSummaryPath(req.site_id, req.params.sessionId),
    formAction: editStepPath(req.site_id, req.params.sessionId, 'details')
  });
});

router.all('/site/:id/clinics/edit/:sessionId/days', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state || state.draft.type !== 'Clinic series') {
    return res.redirect(editSummaryPath(req.site_id, req.params.sessionId));
  }

  if (state.currentEditStep !== 'days') {
    setCurrentEditStep(state, 'days');
    setEditState(data, state);
  }

  if (req.method === 'POST') {
    updateDraftFromDays(state, req.body?.newSession || {});
    return res.redirect(prepareReviewAfterEdit(data, req.site_id, state));
  }

  setEditTemplateData(res, data, state);
  return res.render(`${conceptFolderForEditState(state)}/days`, {
    backUrl: editSummaryPath(req.site_id, req.params.sessionId),
    formAction: editStepPath(req.site_id, req.params.sessionId, 'days')
  });
});

router.all('/site/:id/clinics/edit/:sessionId/clinic-times', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics`);
  }

  if (state.currentEditStep !== 'clinic-times' || state.currentEditField) {
    setCurrentEditStep(state, 'clinic-times');
    setEditState(data, state);
  }

  if (req.method === 'POST') {
    updateDraftFromTimes(state, req.body?.newSession || {});
    updateDraftFromAppointments(state, req.body?.newSession || {}, {
      canUpdateDuration: false
    });
    return res.redirect(prepareReviewAfterEdit(data, req.site_id, state));
  }

  setEditTemplateData(res, data, state);
  return res.render(`${conceptFolderForEditState(state)}/clinic-times`, {
    backUrl: editSummaryPath(req.site_id, req.params.sessionId),
    formAction: editStepPath(req.site_id, req.params.sessionId, 'clinic-times'),
    durationCanChange: false
  });
});

router.all('/site/:id/clinics/edit/:sessionId/appointments-calculator', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics`);
  }

  return res.redirect(editStepPath(req.site_id, req.params.sessionId, 'clinic-times'));
});

router.all('/site/:id/clinics/edit/:sessionId/services', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics`);
  }

  if (state.currentEditStep !== 'services') {
    setCurrentEditStep(state, 'services');
    setEditState(data, state);
  }

  if (req.method === 'POST') {
    updateDraftFromServices(state, req.body?.newSession || {});
    return res.redirect(prepareReviewAfterEdit(data, req.site_id, state));
  }

  setEditTemplateData(res, data, state);
  return res.render(`${conceptFolderForEditState(state)}/services`, {
    backUrl: editSummaryPath(req.site_id, req.params.sessionId),
    formAction: editStepPath(req.site_id, req.params.sessionId, 'services')
  });
});

router.all('/site/:id/clinics/edit/:sessionId/clinic-closures', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state || state.draft.type !== 'Clinic series') {
    return res.redirect(editSummaryPath(req.site_id, req.params.sessionId));
  }

  if (state.currentEditStep !== 'clinic-closures') {
    setCurrentEditStep(state, 'clinic-closures');
    setEditState(data, state);
  }

  const closures = asArray(state.draft.closures);

  if (req.method === 'POST') {
    const addAnother = req.body?.addAnother;
    if (addAnother === 'yes') {
      return res.redirect(editStepPath(req.site_id, req.params.sessionId, 'clinic-closures/add'));
    }

    if (addAnother === 'no') {
      return res.redirect(prepareReviewAfterEdit(data, req.site_id, state));
    }

    if (closures.length > 0) {
      return res.redirect(prepareReviewAfterEdit(data, req.site_id, state));
    }

    return res.render(`${conceptFolderForEditState(state)}/clinic-closures`, {
      backUrl: editSummaryPath(req.site_id, req.params.sessionId),
      formAction: editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'),
      closures,
      addAnother,
      errors: {
        addAnother: 'Select yes if there are dates when this clinic will not run'
      }
    });
  }

  return res.render(`${conceptFolderForEditState(state)}/clinic-closures`, {
    backUrl: editSummaryPath(req.site_id, req.params.sessionId),
    formAction: editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'),
    closures
  });
});

router.all('/site/:id/clinics/edit/:sessionId/clinic-closures/add', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state || state.draft.type !== 'Clinic series') {
    return res.redirect(editSummaryPath(req.site_id, req.params.sessionId));
  }

  ensureClosureTrackingState(state);

  if (req.method === 'POST') {
    const parsed = parseClosureFromBody(req.body?.closure || {});
    const closureErrors = validateClosureWithinClinicDateRange(parsed, state.draft.startDate, state.draft.endDate);
    if (closureErrors) {
      return res.render(`${conceptFolderForEditState(state)}/clinic-closures-form`, {
        pageName: 'Add clinic closure',
        backUrl: editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'),
        actionHref: editStepPath(req.site_id, req.params.sessionId, 'clinic-closures/add'),
        mode: 'add',
        closure: toClosureFormInput(req.body?.closure || {}),
        errors: closureErrors
      });
    }

    state.draft.closures = asArray(state.draft.closures);
    state.draft.closures.push({
      ...parsed,
      _editId: nextClosureEditId(state)
    });
    setEditState(data, state);
    return res.redirect(editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'));
  }

  return res.render(`${conceptFolderForEditState(state)}/clinic-closures-form`, {
    pageName: 'Add clinic closure',
    backUrl: editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'),
    actionHref: editStepPath(req.site_id, req.params.sessionId, 'clinic-closures/add'),
    mode: 'add',
    closure: toClosureFormInput({
      name: '',
      startDate: { day: '', month: '', year: '' },
      endDate: { day: '', month: '', year: '' }
    })
  });
});

router.all('/site/:id/clinics/edit/:sessionId/clinic-closures/:index/change', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state || state.draft.type !== 'Clinic series') {
    return res.redirect(editSummaryPath(req.site_id, req.params.sessionId));
  }

  ensureClosureTrackingState(state);
  const index = Number(req.params.index);
  const closures = asArray(state.draft.closures);
  const current = closures[index];
  if (!Number.isInteger(index) || index < 0 || !current) {
    return res.redirect(editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'));
  }

  if (req.method === 'POST') {
    const parsed = parseClosureFromBody(req.body?.closure || {});
    const closureErrors = validateClosureWithinClinicDateRange(parsed, state.draft.startDate, state.draft.endDate);
    if (closureErrors) {
      return res.render(`${conceptFolderForEditState(state)}/clinic-closures-form`, {
        pageName: 'Change clinic closure',
        backUrl: editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'),
        actionHref: editStepPath(req.site_id, req.params.sessionId, `clinic-closures/${index}/change`),
        mode: 'change',
        closure: toClosureFormInput(req.body?.closure || toEditableClosure(current)),
        errors: closureErrors
      });
    }

    closures[index] = {
      ...parsed,
      _editId: current._editId || nextClosureEditId(state)
    };
    state.draft.closures = closures;
    setEditState(data, state);
    return res.redirect(editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'));
  }

  return res.render(`${conceptFolderForEditState(state)}/clinic-closures-form`, {
    pageName: 'Change clinic closure',
    backUrl: editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'),
    actionHref: editStepPath(req.site_id, req.params.sessionId, `clinic-closures/${index}/change`),
    mode: 'change',
    closure: toClosureFormInput(toEditableClosure(current))
  });
});

router.all('/site/:id/clinics/edit/:sessionId/clinic-closures/:index/remove', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state || state.draft.type !== 'Clinic series') {
    return res.redirect(editSummaryPath(req.site_id, req.params.sessionId));
  }

  const index = Number(req.params.index);
  const closures = asArray(state.draft.closures);
  const current = closures[index];
  if (!Number.isInteger(index) || index < 0 || !current) {
    return res.redirect(editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'));
  }

  if (req.method === 'POST') {
    const confirmRemove = req.body?.confirmRemove;
    if (confirmRemove === 'yes') {
      closures.splice(index, 1);
      state.draft.closures = closures;
      setEditState(data, state);
      return res.redirect(editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'));
    }

    if (confirmRemove === 'no') {
      return res.redirect(editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'));
    }

    return res.render(`${conceptFolderForEditState(state)}/clinic-closures-remove`, {
      backUrl: editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'),
      formAction: editStepPath(req.site_id, req.params.sessionId, `clinic-closures/${index}/remove`),
      index,
      closure: current,
      confirmRemove,
      errors: {
        confirmRemove: 'Select yes if you want to remove this closure'
      }
    });
  }

  return res.render(`${conceptFolderForEditState(state)}/clinic-closures-remove`, {
    backUrl: editStepPath(req.site_id, req.params.sessionId, 'clinic-closures'),
    formAction: editStepPath(req.site_id, req.params.sessionId, `clinic-closures/${index}/remove`),
    index,
    closure: current
  });
});

router.all('/site/:id/clinics/edit/:sessionId/change/:field', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics`);
  }

  const step = editStepForField(
    req.params.field,
    state.draft.type === 'Clinic series'
  );
  if (!step) {
    return res.redirect(editSummaryPath(req.site_id, req.params.sessionId));
  }

  setCurrentEditField(state, req.params.field);
  setEditState(data, state);
  return res.redirect(editStepPath(req.site_id, req.params.sessionId, step));
});

router.all('/site/:id/clinics/edit/:sessionId/any-other-changes', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics`);
  }

  return res.redirect(prepareReviewAfterEdit(data, req.site_id, state));
});

router.all('/site/:id/clinics/edit/:sessionId/affected-bookings', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics`);
  }

  const affectedCount = asArray(state.affectedBookingIds).length;
  if (affectedCount === 0) {
    return res.redirect(`/site/${req.site_id}/clinics/edit/${req.params.sessionId}/check-answers`);
  }

  if (req.method === 'POST') {
    const action = req.body?.bookingAction;
    if (action === 'orphan' || action === 'cancel') {
      state.bookingAction = action;
      setEditState(data, state);
      return res.redirect(`/site/${req.site_id}/clinics/edit/${req.params.sessionId}/check-answers`);
    }
  }

  return res.render(`${conceptFolderForEditState(state)}/affected-bookings`, {
    sessionId: req.params.sessionId,
    isSeries: state.draft.type === 'Clinic series',
    affectedCount,
    selectedBookingAction: state.bookingAction || null,
    backHref: reviewBackPath(req.site_id, req.params.sessionId, {
      ...state,
      affectedBookingIds: []
    })
  });
});

router.all('/site/:id/clinics/edit/:sessionId/check-answers', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics`);
  }

  if (req.method === 'POST') {
    const updatedModel = draftToModel(state.draft);
    const changedFields = buildChangedFieldKeysForEdit(state.original, state.draft, state);
    const unaffectedChildClinics = state.draft.type === 'Clinic series'
      ? buildUnaffectedChildClinicDates(updatedModel, changedFields, req.site_id)
      : [];
    const unaffectedChildReasonText = buildUnaffectedChildReasonText(changedFields);
    persistRecurringSession(data, req.site_id, updatedModel);

    const siteBookings = data?.bookings?.[req.site_id] || {};
    const cancelledBookingsSummary = state.bookingAction === 'cancel'
      ? buildCancelledBookingsSummary({
        siteBookings,
        affectedBookingIds: state.affectedBookingIds,
        servicesById: data.services
      })
      : null;

    setEditSuccessState(data, {
      siteId: req.site_id,
      sessionId: req.params.sessionId,
      isSeries: state.draft.type === 'Clinic series',
      cancelledBookingsSummary,
      unaffectedChildClinics,
      unaffectedChildReasonText
    });

    applyAffectedBookingAction(siteBookings, state.affectedBookingIds, state.bookingAction);
    clearEditState(data);
    return res.redirect(`/site/${req.site_id}/clinics/edit/${req.params.sessionId}/success`);
  }

  return res.render(`${conceptFolderForEditState(state)}/check-answers`, {
    sessionId: req.params.sessionId,
    isSeries: state.draft.type === 'Clinic series',
    rowFields: buildChangedFieldKeysForEdit(state.original, state.draft, state),
    draft: state.draft,
    closureComparisons: buildClosureComparisons(state.draft?.closures, state.original?.closures, state.originalClosureRefs),
    previous: {
      startDate: state.original?.startDate,
      endDate: state.original?.endDate,
      days: asArray(state.original?.recurrencePattern?.byDay),
      from: state.original?.from,
      until: state.original?.until,
      capacity: String(Number(state.original?.capacity) || 1),
      duration: String(Number(state.original?.slotLength) || 10),
      services: asArray(state.original?.services),
      closures: asArray(state.original?.closures),
      closuresCount: asArray(state.original?.closures).length
    },
    checkAnswersMode: 'clinic-edit',
    affectedCount: asArray(state.affectedBookingIds).length,
    bookingAction: state.bookingAction,
    abandonHref: editSummaryPath(req.site_id, req.params.sessionId),
    backHref: reviewBackPath(req.site_id, req.params.sessionId, state)
  });
});

router.get('/site/:id/clinics/edit/:sessionId/success', (req, res) => {
  const successState = getEditSuccessState(req.session.data);
  const matchingSuccessState = (
    successState
    && String(successState.siteId) === String(req.site_id)
    && String(successState.sessionId) === String(req.params.sessionId)
    ? successState
    : null
  );
  const isCancelMode = Boolean(matchingSuccessState?.cancelMode);
  const itemText = matchingSuccessState?.isSeries ? 'Clinic series' : 'Clinic';
  const cancelledBookingsSummary = matchingSuccessState?.cancelledBookingsSummary;
  const cancelSummary = cancelledBookingsSummary
    ? {
      titleText: `${itemText} ${isCancelMode ? 'cancelled' : 'updated'} and ${bookingCountText(cancelledBookingsSummary.cancelledCount)} cancelled`,
      cancelledCount: cancelledBookingsSummary.cancelledCount,
      unnotifiedCount: cancelledBookingsSummary.unnotifiedCount,
      unnotifiedBookings: cancelledBookingsSummary.unnotifiedBookings,
      nextActions: [
        {
          href: `/site/${req.site_id}/clinics`,
          text: 'Back to clinics'
        },
        {
          href: `/site/${req.site_id}/clinics/week`,
          text: 'Go to week view'
        }
      ]
    }
    : null;

  return res.render(`${matchingSuccessState?.isSeries ? 'change-clinic-series' : 'change-single-clinic'}/success`, {
    sessionId: req.params.sessionId,
    titleText: isCancelMode
      ? `${itemText} cancelled`
      : undefined,
    primaryHref: isCancelMode ? `/site/${req.site_id}/clinics` : undefined,
    primaryText: isCancelMode ? 'Back to clinics' : undefined,
    secondaryHref: isCancelMode ? `/site/${req.site_id}/clinics/week` : undefined,
    secondaryText: isCancelMode ? 'Go to week view' : undefined,
    cancelSummary,
    unaffectedChildClinics: matchingSuccessState?.unaffectedChildClinics || [],
    unaffectedChildReasonText: matchingSuccessState?.unaffectedChildReasonText || 'details'
  });
});

router.get('/site/:id/clinics/:sessionId/edit', (req, res) => {
  return res.redirect(`/site/${req.site_id}/clinics/edit/${req.params.sessionId}`);
});

module.exports = router;
