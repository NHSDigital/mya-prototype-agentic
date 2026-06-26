// Journey: change a clinic that is part of a clinic series
// URL base: /site/:id/change/session/:itemId/*
// Writes an EXCEPTION into recurring_sessions (not a first-class
// daily_availability object); the occurrence date is NOT editable. Standalone
// single clinics are handed off to the change-clinic journey via
// redirectToSingleClinicEdit. Helpers are intentionally local to this journey.

const express = require('express');
const { DateTime } = require('luxon');

const router = express.Router();
const { buildCancelledBookingsSummary } = require('../../../helpers/cancelledBookingsSummary');
const mergeDailyAvailability = require('../../../helpers/recurringToDailyAvailability');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeServiceIds(value) {
  return asArray(value)
    .map((serviceId) => String(serviceId || '').trim())
    .filter(Boolean);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toTimeParts(timeString = '') {
  const [hour = '', minute = ''] = String(timeString).split(':');
  return { hour, minute };
}

function formatDisplayDate(dateISO) {
  const dt = DateTime.fromISO(dateISO || '', { zone: 'Europe/London' });
  return dt.isValid ? dt.toFormat('d MMMM yyyy') : String(dateISO || '');
}

function applyServiceOperations(baseServices = [], operations = []) {
  let services = normalizeServiceIds(baseServices);

  for (const change of asArray(operations)) {
    if (!change || typeof change !== 'object') continue;

    if (change.operation === 'replace') {
      services = normalizeServiceIds(change.values);
      continue;
    }

    if (change.operation === 'add' && change.service) {
      const serviceId = String(change.service).trim();
      if (!serviceId) continue;
      if (!services.includes(serviceId)) {
        services.push(serviceId);
      }
      continue;
    }

    if (change.operation === 'remove' && change.service) {
      const serviceId = String(change.service).trim();
      if (!serviceId) continue;
      services = services.filter((service) => service !== serviceId);
    }
  }

  return services;
}

function normalizeServiceOperations(operations = []) {
  return asArray(operations)
    .filter((operation) => operation?.operation && operation?.service)
    .map((operation) => ({
      operation: operation.operation,
      service: String(operation.service).trim()
    }))
    .filter((operation) => operation.service)
    .sort((a, b) => `${a.operation}-${a.service}`.localeCompare(`${b.operation}-${b.service}`));
}

function buildServiceOperations(parentServices = [], selectedServices = []) {
  const parent = normalizeServiceIds(parentServices);
  const selected = normalizeServiceIds(selectedServices);
  const operations = [];

  for (const service of parent) {
    if (!selected.includes(service)) {
      operations.push({
        operation: 'remove',
        service
      });
    }
  }

  for (const service of selected) {
    if (!parent.includes(service)) {
      operations.push({
        operation: 'add',
        service
      });
    }
  }

  return normalizeServiceOperations(operations);
}

function findChildSessionForDate(dateISO, childSessions = []) {
  return asArray(childSessions).find((childSession) => childSession?.date === dateISO) || null;
}

function weekViewHref(siteId, dateISO) {
  return `/site/${siteId}/clinics/week?date=${dateISO}`;
}

function dayViewHref(siteId, dateISO) {
  return `/site/${siteId}/clinics/day?date=${dateISO}`;
}

function changeSummaryPath(siteId, itemId) {
  return `/site/${siteId}/change/session/${itemId}`;
}

function changeStepPath(siteId, itemId, step) {
  return `${changeSummaryPath(siteId, itemId)}/${step}`;
}

function normalizeBackHref(back) {
  if (typeof back !== 'string') return null;
  const value = back.trim();
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  return value;
}

function normalizeSessionType(type) {
  if (type === 'Single date') return 'Single clinic';
  if (type === 'Weekly session' || type === 'Weekly sessions' || type === 'Weekly repeating') {
    return 'Clinic series';
  }
  return type;
}

function isStandaloneSingleClinicModel(model = {}) {
  const sessionType = normalizeSessionType(model?.type);
  if (sessionType === 'Single clinic') return true;
  if (sessionType === 'Clinic series') return false;
  return Boolean(model?.startDate && model?.endDate && model.startDate === model.endDate);
}

function clinicEditPath(siteId, sessionId, suffix = '') {
  return `/site/${siteId}/clinics/edit/${sessionId}${suffix}`;
}

function withOptionalBackHref(path, backHref) {
  if (!backHref) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}back=${encodeURIComponent(backHref)}`;
}

function redirectToSingleClinicEdit(req, res, state, suffix = '') {
  if (state?.journeyType !== 'single-clinic' || !state?.parentSessionId) {
    return false;
  }

  const targetPath = clinicEditPath(req.site_id, state.parentSessionId, suffix);
  res.redirect(withOptionalBackHref(targetPath, state.returnTo));
  return true;
}

function changeFieldToStep(field) {
  switch (field) {
    case 'name':
      return 'details';
    case 'time':
      return 'clinic-times';
    case 'capacity':
      return 'clinic-times';
    case 'services':
      return 'services';
    default:
      return null;
  }
}

function changeFieldsForStep(step) {
  switch (step) {
    case 'details':
      return ['name'];
    case 'clinic-times':
      return ['time', 'capacity'];
    case 'appointments-calculator':
      return [];
    case 'services':
      return ['services'];
    default:
      return [];
  }
}

function useClinicTimesAndCapacity() {
  return true;
}

function getChangeState(data) {
  return data.changeSessionEdit || null;
}

function setChangeState(data, state) {
  data.changeSessionEdit = state;
}

function clearChangeState(data) {
  delete data.changeSessionEdit;
}

function getChangeSuccessState(data) {
  return data.changeSessionSuccess || null;
}

function setChangeSuccessState(data, state) {
  data.changeSessionSuccess = state;
}

function bookingCountText(count) {
  return `${count} booking${count === 1 ? '' : 's'}`
}

function resetChangeOutcome(state) {
  state.bookingAction = null;
  state.affectedBookingIds = [];
}

function setCurrentChangeStep(state, step) {
  state.currentEditStep = step || null;
  resetChangeOutcome(state);
}

function currentEditableFields(state) {
  return changeFieldsForStep(state?.currentEditStep);
}

function findEffectiveSession(dailyAvailability, itemId) {
  for (const [date, day] of Object.entries(dailyAvailability || {})) {
    for (const session of (day.sessions || [])) {
      if (String(session.id) === String(itemId)) {
        return {
          date,
          session
        };
      }
    }
  }

  return null;
}

function buildChildDraft(parentModel, effectiveSession, dateISO) {
  const baselineName = effectiveSession?.label || parentModel?.label || '';
  const baselineFrom = effectiveSession?.from || parentModel?.from || '';
  const baselineUntil = effectiveSession?.until || parentModel?.until || '';
  const baselineCapacity = Number(effectiveSession?.capacity ?? parentModel?.capacity) || 1;
  const resolvedServices = asArray(effectiveSession?.services).length > 0
    ? normalizeServiceIds(effectiveSession.services)
    : applyServiceOperations(parentModel?.services, findChildSessionForDate(dateISO, parentModel?.childSessions)?.services);

  return {
    date: dateISO,
    name: baselineName,
    from: baselineFrom,
    until: baselineUntil,
    startTime: toTimeParts(baselineFrom),
    endTime: toTimeParts(baselineUntil),
    capacity: baselineCapacity,
    duration: Number(parentModel?.slotLength) || 10,
    services: resolvedServices,
    parentName: baselineName,
    parentFrom: baselineFrom,
    parentUntil: baselineUntil,
    parentCapacity: baselineCapacity,
    parentServices: resolvedServices
  };
}

function rebaselineDraftForExistingState(state) {
  if (!state?.draft || !state?.originalParent) return;

  const parentModel = state.originalParent;
  const originalChild = state.originalChild || findChildSessionForDate(state.date, parentModel?.childSessions);
  const baselineName = originalChild?.label || parentModel?.label || '';
  const baselineFrom = originalChild?.from || parentModel?.from || '';
  const baselineUntil = originalChild?.until || parentModel?.until || '';
  const baselineCapacity = Number(originalChild?.capacity ?? parentModel?.capacity) || 1;
  const baselineServices = applyServiceOperations(parentModel?.services, originalChild?.services);

  state.draft.services = normalizeServiceIds(state.draft.services);
  state.draft.parentName = baselineName;
  state.draft.parentFrom = baselineFrom;
  state.draft.parentUntil = baselineUntil;
  state.draft.parentCapacity = baselineCapacity;
  state.draft.parentServices = baselineServices;
}

function childDraftToNewSession(draft) {
  return {
    name: draft.name,
    type: 'Clinic series',
    startTime: draft.startTime,
    endTime: draft.endTime,
    capacity: String(draft.capacity),
    duration: String(draft.duration),
    services: asArray(draft.services)
  };
}

function setChangeTemplateData(res, data, state) {
  res.locals.data = {
    ...data,
    newSession: childDraftToNewSession(state.draft)
  };
}

function updateDraftFromDetails(state, newSession = {}) {
  state.draft.name = String(newSession.name || '').trim();
}

function updateDraftFromTimes(state, newSession = {}) {
  const startHour = String(newSession.startTime?.hour || '').padStart(2, '0');
  const startMinute = String(newSession.startTime?.minute || '').padStart(2, '0');
  const endHour = String(newSession.endTime?.hour || '').padStart(2, '0');
  const endMinute = String(newSession.endTime?.minute || '').padStart(2, '0');

  state.draft.startTime = { hour: startHour, minute: startMinute };
  state.draft.endTime = { hour: endHour, minute: endMinute };
  state.draft.from = `${startHour}:${startMinute}`;
  state.draft.until = `${endHour}:${endMinute}`;
}

function updateDraftFromAppointments(state, newSession = {}) {
  state.draft.capacity = Math.max(1, Number(newSession.capacity) || 1);
}

function updateDraftFromServices(state, newSession = {}) {
  state.draft.services = normalizeServiceIds(newSession.services);
}

function buildChildOverride(parentModel, draft) {
  const child = { date: draft.date };

  if (String(draft.name || '') !== String(parentModel?.label || '')) {
    child.label = draft.name;
  }

  if (String(draft.from || '') !== String(parentModel?.from || '')
    || String(draft.until || '') !== String(parentModel?.until || '')) {
    child.from = draft.from;
    child.until = draft.until;
  }

  if ((Number(draft.capacity) || 1) !== (Number(parentModel?.capacity) || 1)) {
    child.capacity = Number(draft.capacity) || 1;
  }

  const serviceOperations = buildServiceOperations(parentModel?.services, draft.services);
  if (serviceOperations.length > 0) {
    child.services = serviceOperations;
  }

  return Object.keys(child).length > 1 ? child : null;
}

function applyChildDraftToModel(parentModel, draft) {
  const updatedModel = clone(parentModel);
  const childSessions = asArray(updatedModel.childSessions).filter((childSession) => childSession?.date !== draft.date);
  const childOverride = buildChildOverride(updatedModel, draft);

  if (childOverride) {
    childSessions.push(childOverride);
    childSessions.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  }

  updatedModel.childSessions = childSessions;
  return updatedModel;
}

function buildSummaryRowMap(draft, siteId, itemId, data) {
  const servicesText = asArray(draft.services)
    .map((serviceId) => data.services?.[serviceId]?.name || serviceId)
    .join(', ');

  return {
    name: {
      key: { text: 'Name' },
      value: { text: draft.name || 'Not provided' },
      actions: {
        items: [{
          href: `${changeSummaryPath(siteId, itemId)}/change/name`,
          text: 'Change',
          visuallyHiddenText: ' name'
        }]
      }
    },
    time: {
      key: { text: 'Time' },
      value: { text: `${draft.from} to ${draft.until}` },
      actions: {
        items: [{
          href: `${changeSummaryPath(siteId, itemId)}/change/time`,
          text: 'Change',
          visuallyHiddenText: ' time'
        }]
      }
    },
    capacity: {
      key: { text: 'Vaccinators' },
      value: { text: String(draft.capacity) },
      actions: {
        items: [{
          href: `${changeSummaryPath(siteId, itemId)}/change/capacity`,
          text: 'Change',
          visuallyHiddenText: ' vaccinators'
        }]
      }
    },
    services: {
      key: { text: 'Services' },
      value: { text: servicesText || 'None selected' },
      actions: {
        items: [{
          href: `${changeSummaryPath(siteId, itemId)}/change/services`,
          text: 'Change',
          visuallyHiddenText: ' services'
        }]
      }
    }
  };
}

function hasFieldChanged(state, field) {
  switch (field) {
    case 'name':
      return String(state.draft.name || '') !== String(state.draft.parentName || '');
    case 'time':
      return String(state.draft.from || '') !== String(state.draft.parentFrom || '')
        || String(state.draft.until || '') !== String(state.draft.parentUntil || '');
    case 'capacity':
      return (Number(state.draft.capacity) || 1) !== (Number(state.draft.parentCapacity) || 1);
    case 'services':
      return JSON.stringify(normalizeServiceIds(state.draft.services).slice().sort())
        !== JSON.stringify(normalizeServiceIds(state.draft.parentServices).slice().sort());
    default:
      return false;
  }
}

function buildChangedFieldKeysForCheckAnswers(state) {
  const editableFields = currentEditableFields(state);
  const candidateFields = ['name', 'time', 'capacity', 'services'];
  const changedFields = candidateFields
    .filter((field) => hasFieldChanged(state, field));

  if (changedFields.length > 0) {
    return changedFields;
  }

  return editableFields;
}

function normalizeIsoMinute(datetimeISO) {
  const dt = DateTime.fromISO(datetimeISO || '', { zone: 'Europe/London' });
  if (!dt.isValid) return null;
  return dt.toFormat("yyyy-MM-dd'T'HH:mm");
}

function normalizedBookingImpact(model = {}) {
  return {
    startDate: model.startDate || '',
    endDate: model.endDate || '',
    recurrencePattern: {
      frequency: model.recurrencePattern?.frequency || '',
      interval: Number(model.recurrencePattern?.interval) || 1,
      byDay: asArray(model.recurrencePattern?.byDay).slice().sort()
    },
    from: model.from || '',
    until: model.until || '',
    slotLength: Number(model.slotLength) || 10,
    capacity: Number(model.capacity) || 1,
    services: asArray(model.services).slice().sort(),
    childSessions: asArray(model.childSessions)
      .map((child) => ({
        date: child?.date || '',
        from: child?.from || '',
        until: child?.until || '',
        capacity: child?.capacity ?? null,
        services: normalizeServiceOperations(child?.services)
      }))
      .sort((a, b) => `${a.date}-${a.from}-${a.until}`.localeCompare(`${b.date}-${b.from}-${b.until}`))
  };
}

function calculateAffectedBookings(originalModel, updatedModel, siteBookings) {
  if (JSON.stringify(normalizedBookingImpact(originalModel)) === JSON.stringify(normalizedBookingImpact(updatedModel))) {
    return [];
  }

  const collectMinuteSlots = (model) => {
    const slotsByMinute = new Map();
    const merged = mergeDailyAvailability({}, String(model.site_id || ''), { [model.id]: model });

    for (const [date, day] of Object.entries(merged || {})) {
      for (const session of (day.sessions || [])) {
        const start = DateTime.fromISO(`${date}T${session.from}`, { zone: 'Europe/London' });
        const end = DateTime.fromISO(`${date}T${session.until}`, { zone: 'Europe/London' });
        const slotLength = Number(session.slotLength) || 10;
        const capacity = Number(session.capacity) || 1;
        const services = asArray(session.services).slice().sort();

        for (let dt = start; dt < end; dt = dt.plus({ minutes: slotLength })) {
          const key = dt.toFormat("yyyy-MM-dd'T'HH:mm");
          const minuteSlots = slotsByMinute.get(key) || [];
          minuteSlots.push({
            sessionId: session.id || null,
            recurringSessionId: session.recurringId || model.id,
            slotKey: key,
            services,
            capacity
          });
          slotsByMinute.set(key, minuteSlots);
        }
      }
    }

    return slotsByMinute;
  };

  const originalSlotsByMinute = collectMinuteSlots(originalModel);
  const updatedSlotsByMinute = collectMinuteSlots(updatedModel);
  const bookingsByMinute = new Map();

  for (const booking of Object.values(siteBookings || {})) {
    if (booking?.status !== 'scheduled') continue;

    const key = booking?.slotKey || normalizeIsoMinute(booking?.datetime);
    if (!key) continue;

    const originalSlots = originalSlotsByMinute.get(key) || [];
    const belongsToOriginal = booking?.recurringSessionId
      ? String(booking.recurringSessionId) === String(originalModel.id)
      : originalSlots.some((slot) => asArray(slot.services).includes(booking.service));
    if (!belongsToOriginal) continue;

    const bucket = bookingsByMinute.get(key) || [];
    bucket.push(booking);
    bookingsByMinute.set(key, bucket);
  }

  const affectedIds = [];

  for (const [minute, minuteBookings] of bookingsByMinute.entries()) {
    const updatedSlots = (updatedSlotsByMinute.get(minute) || []).map((slot) => ({
      services: slot.services,
      remaining: Number(slot.capacity) || 0
    }));
    const sortedBookings = minuteBookings.slice().sort((a, b) => Number(a.id) - Number(b.id));

    for (const booking of sortedBookings) {
      const candidate = updatedSlots
        .filter((slot) => slot.remaining > 0 && slot.services.includes(booking.service))
        .sort((a, b) => {
          if (a.services.length !== b.services.length) {
            return a.services.length - b.services.length;
          }
          return a.remaining - b.remaining;
        })[0];

      if (!candidate) {
        affectedIds.push(String(booking.id));
        continue;
      }

      candidate.remaining -= 1;
    }
  }

  return Array.from(new Set(affectedIds));
}

function applyAffectedBookingAction(siteBookings, affectedIds, action) {
  if (!action || !Array.isArray(affectedIds) || affectedIds.length === 0) return;

  for (const id of affectedIds) {
    if (!siteBookings?.[id]) continue;
    if (action === 'orphan') {
      siteBookings[id].status = 'orphaned';
      continue;
    }
    if (action === 'cancel') {
      siteBookings[id].status = 'cancelled';
    }
  }
}

function reviewBackPath(siteId, itemId, state) {
  if (asArray(state?.affectedBookingIds).length > 0) {
    return `${changeSummaryPath(siteId, itemId)}/affected-bookings`;
  }

  if (state?.currentEditStep) {
    return changeStepPath(siteId, itemId, state.currentEditStep);
  }

  return changeSummaryPath(siteId, itemId);
}

function prepareReviewAfterChange(data, siteId, itemId, state) {
  const updatedModel = applyChildDraftToModel(state.originalParent, state.draft);
  updatedModel.site_id = siteId;
  const originalModel = { ...state.originalParent, site_id: siteId };
  const siteBookings = data?.bookings?.[siteId] || {};
  const affectedIds = calculateAffectedBookings(originalModel, updatedModel, siteBookings);

  state.affectedBookingIds = affectedIds;
  if (affectedIds.length === 0) {
    state.bookingAction = null;
  }

  setChangeState(data, state);
  return affectedIds.length > 0
    ? `${changeSummaryPath(siteId, itemId)}/affected-bookings`
    : `${changeSummaryPath(siteId, itemId)}/check-answers`;
}

function ensureChangeStateForSession(req, res) {
  const data = req.session.data;
  const siteId = req.site_id;
  const itemId = req.params.itemId;
  const isClinicTimesAndCapacity = useClinicTimesAndCapacity(req.features);
  const requestedBackHref = normalizeBackHref(req.query?.back);
  const existing = getChangeState(data);

  if (existing && existing.siteId === siteId && existing.itemId === itemId && existing.originalParent) {
    existing.useClinicTimesAndCapacity = isClinicTimesAndCapacity;
    rebaselineDraftForExistingState(existing);
    if (requestedBackHref) {
      existing.returnTo = requestedBackHref;
    }

    setChangeState(data, existing);
    return existing;
  }

  const target = findEffectiveSession(res.locals.dailyAvailability, itemId);
  if (!target?.session?.recurringId) return null;

  const parentModel = data?.recurring_sessions?.[siteId]?.[target.session.recurringId];
  if (!parentModel) return null;

  if (isStandaloneSingleClinicModel(parentModel)) {
    clearChangeState(data);
    return {
      journeyType: 'single-clinic',
      parentSessionId: parentModel.id,
      returnTo: requestedBackHref || null
    };
  }

  const originalChild = findChildSessionForDate(target.date, parentModel.childSessions);
  const state = {
    journeyType: 'one-off-series-clinic',
    siteId,
    itemId,
    date: target.date,
    parentRecurringSessionId: parentModel.id,
    originalParent: clone(parentModel),
    originalChild: clone(originalChild),
    draft: buildChildDraft(parentModel, target.session, target.date),
    returnTo: requestedBackHref || null,
    useClinicTimesAndCapacity: isClinicTimesAndCapacity,
    currentEditStep: null,
    bookingAction: null,
    affectedBookingIds: []
  };

  setChangeState(data, state);
  return state;
}

router.get('/site/:id/change/:type/:itemId', (req, res) => {
  if (req.params.type !== 'session') {
    return res.redirect(`/site/${req.site_id}/clinics/week`);
  }

  const shouldDiscardChanges = req.query?.discard === '1' || req.query?.discard === 'true';
  if (shouldDiscardChanges) {
    clearChangeState(req.session.data);
  }

  const state = ensureChangeStateForSession(req, res);
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics/week`);
  }

  if (redirectToSingleClinicEdit(req, res, state)) {
    return;
  }

  return res.render('change-clinic-that-is-part-of-a-clinic-series/summary-child', {
    pageName: 'Change clinic',
    itemId: req.params.itemId,
    draft: state.draft,
    date: state.date,
    displayDate: formatDisplayDate(state.date),
    weekHref: state.returnTo || weekViewHref(req.site_id, state.date)
  });
});

router.all('/site/:id/change/session/:itemId/details', (req, res) => {
  const state = ensureChangeStateForSession(req, res);
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics/week`);
  }

  if (redirectToSingleClinicEdit(req, res, state, '/details')) {
    return;
  }

  if (state.currentEditStep !== 'details') {
    setCurrentChangeStep(state, 'details');
    setChangeState(req.session.data, state);
  }

  if (req.method === 'POST') {
    updateDraftFromDetails(state, req.body?.newSession || {});
    return res.redirect(prepareReviewAfterChange(req.session.data, req.site_id, req.params.itemId, state));
  }

  setChangeTemplateData(res, req.session.data, state);
  return res.render('change-clinic-that-is-part-of-a-clinic-series/details', {
    pageName: 'Clinic name',
    backUrl: changeSummaryPath(req.site_id, req.params.itemId),
    formAction: changeStepPath(req.site_id, req.params.itemId, 'details'),
    hideDateFields: true
  });
});

router.all('/site/:id/change/session/:itemId/clinic-times', (req, res) => {
  const state = ensureChangeStateForSession(req, res);
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics/week`);
  }

  if (redirectToSingleClinicEdit(req, res, state, '/clinic-times')) {
    return;
  }

  if (state.currentEditStep !== 'clinic-times') {
    setCurrentChangeStep(state, 'clinic-times');
    setChangeState(req.session.data, state);
  }

  if (req.method === 'POST') {
    updateDraftFromTimes(state, req.body?.newSession || {});
    updateDraftFromAppointments(state, req.body?.newSession || {});
    return res.redirect(prepareReviewAfterChange(req.session.data, req.site_id, req.params.itemId, state));
  }

  setChangeTemplateData(res, req.session.data, state);
  return res.render('change-clinic-that-is-part-of-a-clinic-series/clinic-times', {
    backUrl: changeSummaryPath(req.site_id, req.params.itemId),
    formAction: changeStepPath(req.site_id, req.params.itemId, 'clinic-times'),
    durationCanChange: false
  });
});

router.all('/site/:id/change/session/:itemId/appointments-calculator', (req, res) => {
  const state = ensureChangeStateForSession(req, res);
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics/week`);
  }

  if (redirectToSingleClinicEdit(req, res, state, '/appointments-calculator')) {
    return;
  }

  return res.redirect(changeStepPath(req.site_id, req.params.itemId, 'clinic-times'));
});

router.all('/site/:id/change/session/:itemId/services', (req, res) => {
  const state = ensureChangeStateForSession(req, res);
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics/week`);
  }

  if (redirectToSingleClinicEdit(req, res, state, '/services')) {
    return;
  }

  if (state.currentEditStep !== 'services') {
    setCurrentChangeStep(state, 'services');
    setChangeState(req.session.data, state);
  }

  if (req.method === 'POST') {
    updateDraftFromServices(state, req.body?.newSession || {});
    return res.redirect(prepareReviewAfterChange(req.session.data, req.site_id, req.params.itemId, state));
  }

  const backUrl = changeStepPath(req.site_id, req.params.itemId, 'clinic-times');

  setChangeTemplateData(res, req.session.data, state);
  return res.render('change-clinic-that-is-part-of-a-clinic-series/services', {
    pageName: 'Services',
    backUrl,
    formAction: changeStepPath(req.site_id, req.params.itemId, 'services')
  });
});

router.get('/site/:id/change/session/:itemId/change/:field', (req, res) => {
  const state = ensureChangeStateForSession(req, res);
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics/week`);
  }

  if (redirectToSingleClinicEdit(req, res, state, `/change/${req.params.field}`)) {
    return;
  }

  const step = changeFieldToStep(req.params.field);
  if (!step) {
    return res.redirect(changeSummaryPath(req.site_id, req.params.itemId));
  }

  setCurrentChangeStep(state, step);
  setChangeState(req.session.data, state);
  return res.redirect(changeStepPath(req.site_id, req.params.itemId, step));
});

router.all('/site/:id/change/session/:itemId/affected-bookings', (req, res) => {
  const state = ensureChangeStateForSession(req, res);
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics/week`);
  }

  if (redirectToSingleClinicEdit(req, res, state, '/affected-bookings')) {
    return;
  }

  const affectedCount = asArray(state.affectedBookingIds).length;
  if (affectedCount === 0) {
    return res.redirect(`${changeSummaryPath(req.site_id, req.params.itemId)}/check-answers`);
  }

  if (req.method === 'POST') {
    const action = req.body?.bookingAction;
    if (action === 'orphan' || action === 'cancel') {
      state.bookingAction = action;
      setChangeState(req.session.data, state);
      return res.redirect(`${changeSummaryPath(req.site_id, req.params.itemId)}/check-answers`);
    }
  }

  return res.render('change-clinic-that-is-part-of-a-clinic-series/affected-bookings', {
    sessionId: req.params.itemId,
    isSeries: false,
    affectedCount,
    selectedBookingAction: state.bookingAction || null,
    headingText: `${affectedCount} bookings are affected by this change`,
    formAction: `${changeSummaryPath(req.site_id, req.params.itemId)}/affected-bookings`,
    backHref: reviewBackPath(req.site_id, req.params.itemId, {
      ...state,
      affectedBookingIds: []
    })
  });
});

router.all('/site/:id/change/session/:itemId/check-answers', (req, res) => {
  const data = req.session.data;
  const state = ensureChangeStateForSession(req, res);
  if (!state) {
    return res.redirect(`/site/${req.site_id}/clinics/week`);
  }

  if (redirectToSingleClinicEdit(req, res, state, '/check-answers')) {
    return;
  }

  if (req.method === 'POST') {
    const currentParent = clone(data?.recurring_sessions?.[req.site_id]?.[state.parentRecurringSessionId] || state.originalParent);
    const updatedParent = applyChildDraftToModel(currentParent, state.draft);

    data.recurring_sessions = data.recurring_sessions || {};
    data.recurring_sessions[req.site_id] = data.recurring_sessions[req.site_id] || {};
    data.recurring_sessions[req.site_id][updatedParent.id] = updatedParent;

    const siteBookings = data?.bookings?.[req.site_id] || {};
    const cancelledBookingsSummary = state.bookingAction === 'cancel'
      ? buildCancelledBookingsSummary({
        siteBookings,
        affectedBookingIds: state.affectedBookingIds,
        servicesById: data.services
      })
      : null;

    setChangeSuccessState(data, {
      siteId: req.site_id,
      itemId: req.params.itemId,
      date: state.date,
      cancelledBookingsSummary
    });

    applyAffectedBookingAction(siteBookings, state.affectedBookingIds, state.bookingAction);
    const redirectDate = state.date;
    clearChangeState(data);
    return res.redirect(`${changeSummaryPath(req.site_id, req.params.itemId)}/success?date=${redirectDate}`);
  }

  return res.render('change-clinic-that-is-part-of-a-clinic-series/check-answers', {
    pageName: 'Check your answers',
    sessionId: req.params.itemId,
    isSeries: false,
    rowFields: buildChangedFieldKeysForCheckAnswers(state),
    draft: state.draft,
    previous: {
      name: state.draft.parentName,
      from: state.draft.parentFrom,
      until: state.draft.parentUntil,
      capacity: String(state.draft.parentCapacity),
      duration: String(state.draft.duration),
      services: asArray(state.draft.parentServices)
    },
    checkAnswersMode: 'session-change',
    affectedCount: asArray(state.affectedBookingIds).length,
    bookingAction: state.bookingAction,
    abandonHref: state.returnTo
      ? `${changeSummaryPath(req.site_id, req.params.itemId)}?back=${encodeURIComponent(state.returnTo)}&discard=1`
      : `${changeSummaryPath(req.site_id, req.params.itemId)}?discard=1`,
    formAction: `${changeSummaryPath(req.site_id, req.params.itemId)}/check-answers`,
    affectedActionHref: `${changeSummaryPath(req.site_id, req.params.itemId)}/affected-bookings`,
    backHref: reviewBackPath(req.site_id, req.params.itemId, state)
  });
});

router.get('/site/:id/change/session/:itemId/success', (req, res) => {
  const date = req.query.date || getChangeState(req.session.data)?.date || DateTime.now().toISODate();
  const successState = getChangeSuccessState(req.session.data);
  const matchingSuccessState = successState
    && String(successState.siteId) === String(req.site_id)
    && String(successState.itemId) === String(req.params.itemId)
    ? successState
    : null;
  const cancelledBookingsSummary = matchingSuccessState?.cancelledBookingsSummary;
  const cancelSummary = cancelledBookingsSummary
    ? {
      titleText: `Clinic updated and ${bookingCountText(cancelledBookingsSummary.cancelledCount)} cancelled`,
      cancelledCount: cancelledBookingsSummary.cancelledCount,
      unnotifiedCount: cancelledBookingsSummary.unnotifiedCount,
      unnotifiedBookings: cancelledBookingsSummary.unnotifiedBookings,
      nextActions: [
        {
          href: weekViewHref(req.site_id, date),
          text: 'Back to week view'
        },
        {
          href: dayViewHref(req.site_id, date),
          text: 'View this day'
        }
      ]
    }
    : null;

  return res.render('change-clinic-that-is-part-of-a-clinic-series/success', {
    titleText: 'Clinic updated',
    primaryHref: weekViewHref(req.site_id, date),
    primaryText: 'Back to week view',
    secondaryHref: dayViewHref(req.site_id, date),
    secondaryText: 'View this day',
    cancelSummary,
    unaffectedChildClinics: [],
    unaffectedChildReasonText: 'details'
  });
});

module.exports = router;
