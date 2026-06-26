// Journey: cancel a clinic (cancel an entire single clinic or series occurrence)
// URL base: /site/:id/clinics/cancel/:sessionId/*
// The start and success routes are redirects (success hands off to the
// change-clinic edit success page); only affected-bookings / confirm-cancellation
// / check-answers render views here.

const express = require('express');
const router = express.Router();
const { DateTime } = require('luxon');
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

function conceptFolderForCancelState(state) {
  if (state?.cancelScope === 'occurrence') {
    return 'cancel-clinic-in-a-series';
  }

  return state?.draft?.type === 'Clinic series'
    ? 'cancel-clinic-series'
    : 'cancel-single-clinic';
}

router.get('/site/:id/clinics/cancel/:sessionId', (req, res) => {
  const state = initializeCancelStateForSession(req.session.data, req.site_id, req.params.sessionId);
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics`);
  }

  if (state.affectedBookingIds.length > 0) {
    return res.redirect(`${cancelSummaryPath(req.site_id, req.params.sessionId)}/affected-bookings`);
  }

  return res.redirect(`${cancelSummaryPath(req.site_id, req.params.sessionId)}/check-answers`);
});

router.all('/site/:id/clinics/cancel/:sessionId/affected-bookings', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics`);
  }

  if (!state.cancelMode) {
    return res.redirect(cancelSummaryPath(req.site_id, req.params.sessionId));
  }

  const affectedCount = asArray(state.affectedBookingIds).length;
  if (affectedCount === 0) {
    return res.redirect(`${cancelSummaryPath(req.site_id, req.params.sessionId)}/check-answers`);
  }

  if (req.method === 'POST') {
    const action = req.body?.bookingAction;
    if (action === 'orphan' || action === 'cancel') {
      state.bookingAction = action;
      setEditState(data, state);
      return res.redirect(`${cancelSummaryPath(req.site_id, req.params.sessionId)}/check-answers`);
    }
  }

  return res.render(`${conceptFolderForCancelState(state)}/affected-bookings`, {
    sessionId: req.params.sessionId,
    isSeries: state.draft.type === 'Clinic series',
    affectedCount,
    selectedBookingAction: state.bookingAction || null,
    headingText: `${affectedCount} bookings are affected by cancelling this ${state.draft.type === 'Clinic series' ? 'clinic series' : 'clinic'}`,
    introText: 'What do you want to do with the booked appointments when you cancel this clinic?',
    formAction: `${cancelSummaryPath(req.site_id, req.params.sessionId)}/affected-bookings`,
    backHref: `/site/${req.site_id}/clinics`
  });
});

router.all('/site/:id/clinics/cancel/:sessionId/check-answers', (req, res) => {
  const data = req.session.data;
  const state = ensureEditStateForSession(data, req.site_id, req.params.sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacity(req.features)
  });
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics`);
  }

  if (!state.cancelMode) {
    return res.redirect(cancelSummaryPath(req.site_id, req.params.sessionId));
  }

  const affectedCount = asArray(state.affectedBookingIds).length;
  if (affectedCount > 0 && !state.bookingAction) {
    return res.redirect(`${cancelSummaryPath(req.site_id, req.params.sessionId)}/affected-bookings`);
  }

  if (req.method === 'POST') {
    const siteBookings = data?.bookings?.[req.site_id] || {};
    const bookingAction = state.bookingAction;
    const cancelledBookingsSummary = bookingAction === 'cancel'
      ? buildCancelledBookingsSummary({
        siteBookings,
        affectedBookingIds: state.affectedBookingIds,
        servicesById: data.services
      })
      : null;

    data.recurring_sessions = data.recurring_sessions || {};
    data.recurring_sessions[req.site_id] = data.recurring_sessions[req.site_id] || {};

    if (state.cancelScope === 'occurrence') {
      const recurringSession = data.recurring_sessions[req.site_id][state.cancelRecurringId];
      if (recurringSession) {
        recurringSession.closures = asArray(recurringSession.closures);
        const alreadyClosed = recurringSession.closures.some((closure) => {
          const start = closure?.startDate;
          const end = closure?.endDate;
          return start && end && state.cancelDate >= start && state.cancelDate <= end;
        });

        if (!alreadyClosed) {
          recurringSession.closures.push({
            startDate: state.cancelDate,
            endDate: state.cancelDate,
            label: ''
          });
        }
      }
    } else {
      delete data.recurring_sessions[req.site_id][req.params.sessionId];
    }

    setEditSuccessState(data, {
      siteId: req.site_id,
      sessionId: req.params.sessionId,
      isSeries: state.draft.type === 'Clinic series',
      cancelMode: true,
      cancelledBookingsSummary,
      unaffectedChildClinics: [],
      unaffectedChildReasonText: 'details'
    });

    applyAffectedBookingAction(siteBookings, state.affectedBookingIds, bookingAction);
    clearEditState(data);
    return res.redirect(`${cancelSummaryPath(req.site_id, req.params.sessionId)}/success`);
  }

  const clinicTypeText = state.draft.type === 'Clinic series' ? 'clinic series' : 'clinic';
  const dateText = state.draft.type === 'Clinic series'
    ? `${formatShortDate(state.draft.startDate)} to ${formatShortDate(state.draft.endDate)}`
    : formatShortDate(state.draft.startDate);
  const timeText = `${state.draft.from || ''} to ${state.draft.until || ''}`;
  const rows = [
    {
      key: { text: state.draft.type === 'Clinic series' ? 'Dates' : 'Date' },
      value: { text: dateText }
    },
    {
      key: { text: 'Times' },
      value: { text: timeText }
    }
  ];

  if (affectedCount === 0) {
    return res.render(`${conceptFolderForCancelState(state)}/confirm-cancellation`, {
      sessionId: req.params.sessionId,
      isSeries: state.draft.type === 'Clinic series',
      rows: rows.concat([{
        key: { text: 'Booked appointments' },
        value: { text: 'No bookings will be affected' }
      }]),
      cancelFrom: state.draft.from,
      cancelUntil: state.draft.until,
      buttonText: `Cancel ${clinicTypeText}`,
      buttonClasses: 'nhsuk-button--warning',
      formAction: `${cancelSummaryPath(req.site_id, req.params.sessionId)}/check-answers`,
      abandonHref: `/site/${req.site_id}/clinics`,
      emptyStateText: `There are no affected bookings for this ${clinicTypeText}. Select cancel to continue.`
    });
  }

  return res.render(`${conceptFolderForCancelState(state)}/check-answers`, {
    sessionId: req.params.sessionId,
    isSeries: state.draft.type === 'Clinic series',
    rows,
    checkAnswersMode: 'clinic-cancel',
    affectedCount,
    bookingAction: state.bookingAction,
    cancelFrom: state.draft.from,
    cancelUntil: state.draft.until,
    buttonText: `Cancel ${clinicTypeText}`,
    buttonClasses: 'nhsuk-button--warning',
    formAction: `${cancelSummaryPath(req.site_id, req.params.sessionId)}/check-answers`,
    affectedActionHref: `${cancelSummaryPath(req.site_id, req.params.sessionId)}/affected-bookings`,
    abandonHref: `/site/${req.site_id}/clinics`,
    backHref: `${cancelSummaryPath(req.site_id, req.params.sessionId)}/affected-bookings`,
    emptyStateText: `There are no affected bookings for this ${clinicTypeText}. Select cancel to continue.`
  });
});

router.get('/site/:id/clinics/cancel/:sessionId/success', (req, res) => {
  return res.redirect(`/site/${req.site_id}/clinics/edit/${req.params.sessionId}/success`);
});

module.exports = router;
