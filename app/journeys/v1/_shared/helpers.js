// -----------------------------------------------------------------------------
// Shared clinic helpers
// -----------------------------------------------------------------------------
// Pure, framework-agnostic helpers shared across the base.js-derived journeys
// (sites, clinics list, availability, create-clinic, change-clinic,
// cancel-clinic) and the per-site context middleware. Extracted verbatim from
// the head of the original app/routes/base.js so behaviour is unchanged.
//
// NOTE: the change-clinic-that-is-part-of-a-clinic-series journey deliberately
// keeps its OWN parallel helpers (e.g. an updateDraftFromDetails that never
// edits the date) and does not import from here.
// -----------------------------------------------------------------------------

const { DateTime } = require('luxon');
const { randomUUID } = require('crypto');

const enhanceData = require('../../../helpers/enhanceData');
const { buildCancelledBookingsSummary } = require('../../../helpers/cancelledBookingsSummary');
const mergeDailyAvailability = require('../../../helpers/recurringToDailyAvailability');
const sessionDataDefaults = require('../../../data/session-data-defaults');

const override_today = process.env.OVERRIDE_TODAY || null;

function getToday() {
  return override_today || DateTime.now().toFormat('yyyy-MM-dd');
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeSessionType(type) {
  if (type === 'Single date') return 'Single clinic';
  if (type === 'Weekly session' || type === 'Weekly sessions' || type === 'Weekly repeating') return 'Clinic series';
  return type;
}

function clinicFlowType(data) {
  const type = normalizeSessionType(data?.newSession?.type);
  if (type === 'Single clinic') return 'single';
  if (type === 'Clinic series') return 'series';
  return null;
}

function ensureCreateSession(data) {
  const current = data.newSession || {};
  const sessionType = normalizeSessionType(current.type);

  const session = {
    name: current.name || '',
    type: sessionType || '',
    startDate: {
      day: current.startDate?.day || '',
      month: current.startDate?.month || '',
      year: current.startDate?.year || ''
    },
    endDate: {
      day: current.endDate?.day || '',
      month: current.endDate?.month || '',
      year: current.endDate?.year || ''
    },
    singleDate: {
      day: current.singleDate?.day || '',
      month: current.singleDate?.month || '',
      year: current.singleDate?.year || ''
    },
    days: asArray(current.days),
    startTime: {
      hour: current.startTime?.hour || '',
      minute: current.startTime?.minute || ''
    },
    endTime: {
      hour: current.endTime?.hour || '',
      minute: current.endTime?.minute || ''
    },
    capacity: current.capacity || '',
    duration: current.duration || '',
    services: asArray(current.services),
    closures: asArray(current.closures)
      .filter((closure) => closure?.startDate && closure?.endDate)
      .map((closure) => ({
        startDate: closure.startDate,
        endDate: closure.endDate,
        label: closure.label || ''
      }))
  };

  data.newSession = session;
  return session;
}

function toTimeString(timeInput) {
  const hour = String(timeInput?.hour || '00').padStart(2, '0');
  const minute = String(timeInput?.minute || '00').padStart(2, '0');
  return `${hour}:${minute}`;
}

function toTimeParts(timeString = '') {
  const [hour = '', minute = ''] = String(timeString).split(':');
  return { hour, minute };
}

function toDateParts(isoDate) {
  const dt = DateTime.fromISO(isoDate || '');
  if (!dt.isValid) {
    return { day: '', month: '', year: '' };
  }

  return {
    day: String(dt.day),
    month: String(dt.month),
    year: String(dt.year)
  };
}

function inferClinicTypeFromModel(model = {}) {
  const explicit = normalizeSessionType(model.type);
  if (explicit === 'Single clinic' || explicit === 'Clinic series') {
    return explicit;
  }

  if (model.startDate && model.endDate && model.startDate === model.endDate) {
    return 'Single clinic';
  }

  return 'Clinic series';
}

function toIsoDate(dateParts) {
  return DateTime.fromObject({
    day: +dateParts.day,
    month: +dateParts.month,
    year: +dateParts.year
  }).toISODate();
}

function toIsoDateIfValid(dateInput) {
  const day = String(dateInput?.day || '').trim();
  const month = String(dateInput?.month || '').trim();
  const year = String(dateInput?.year || '').trim();
  if (!day || !month || !year) return null;

  const dt = DateTime.fromObject({
    day: +day,
    month: +month,
    year: +year
  });

  return dt.isValid ? dt.toISODate() : null;
}

function toDateInputParts(isoDate) {
  const dt = DateTime.fromISO(isoDate || '');
  if (!dt.isValid) {
    return { day: '', month: '', year: '' };
  }

  return {
    day: String(dt.day),
    month: String(dt.month),
    year: String(dt.year)
  };
}

function parseClosureFromBody(closureBody = {}) {
  const label = String(closureBody.name || '').trim();

  const startDate = toIsoDateIfValid(closureBody.startDate);
  const endDate = toIsoDateIfValid(closureBody.endDate);
  if (!startDate || !endDate) return null;

  return {
    startDate,
    endDate,
    label
  };
}

function validateClosureWithinClinicDateRange(closure, clinicStartDate, clinicEndDate) {
  const errors = {};

  if (!closure?.startDate || !closure?.endDate) {
    errors.startDate = 'Enter a valid closure start date';
    errors.endDate = 'Enter a valid closure end date';
    return errors;
  }

  if (closure.endDate < closure.startDate) {
    errors.endDate = 'Closure end date must be on or after the start date';
  }

  if (clinicStartDate && closure.startDate < clinicStartDate) {
    errors.startDate = 'The start date must be on or after the clinic series start date';
  }

  if (clinicEndDate && closure.endDate > clinicEndDate) {
    errors.endDate = 'The end date must be on or before the clinic series end date';
  }

  return Object.keys(errors).length ? errors : null;
}

function toEditableClosure(closure = {}) {
  return {
    name: closure.label || '',
    startDate: toDateInputParts(closure.startDate),
    endDate: toDateInputParts(closure.endDate)
  };
}

function toClosureFormInput(input = {}) {
  return {
    name: String(input.name || ''),
    startDate: {
      day: String(input.startDate?.day || ''),
      month: String(input.startDate?.month || ''),
      year: String(input.startDate?.year || '')
    },
    endDate: {
      day: String(input.endDate?.day || ''),
      month: String(input.endDate?.month || ''),
      year: String(input.endDate?.year || '')
    }
  };
}

function toByDay(newSession, startDateISO) {
  const mode = normalizeSessionType(newSession.type) || 'Clinic series';
  if (mode === 'Single clinic') {
    const day = DateTime.fromISO(startDateISO).toFormat('cccc');
    return [day];
  }

  return asArray(newSession.days);
}

function buildSessionLabel(byDay, fromTime) {
  if (!byDay || byDay.length === 0) return `Clinic series ${fromTime}`;
  return `${byDay.join(', ')} clinic series ${fromTime}`;
}

function buildRecurringSessionModel(newSession) {
  const mode = normalizeSessionType(newSession.type) || 'Clinic series';
  const isSingleDate = mode === 'Single clinic';

  const startDateISO = isSingleDate ? toIsoDate(newSession.singleDate) : toIsoDate(newSession.startDate);
  const endDateISO = isSingleDate ? toIsoDate(newSession.singleDate) : toIsoDate(newSession.endDate);
  const byDay = toByDay(newSession, startDateISO);

  const from = toTimeString(newSession.startTime);
  const until = toTimeString(newSession.endTime);
  const slotLength = Number(newSession.duration) || 10;
  const capacity = Number(newSession.capacity) || 1;
  const services = asArray(newSession.services);

  return {
    id: randomUUID().split('-')[0],
    type: mode,
    label: (newSession.name || '').trim() || buildSessionLabel(byDay, from),
    startDate: startDateISO,
    endDate: endDateISO,
    recurrencePattern: {
      frequency: 'Weekly',
      interval: 1,
      byDay
    },
    from,
    until,
    slotLength,
    services,
    capacity,
    childSessions: [],
    closures: asArray(newSession.closures)
      .filter((closure) => closure?.startDate && closure?.endDate)
      .map((closure) => ({
        startDate: closure.startDate,
        endDate: closure.endDate,
        label: closure.label || ''
      }))
  };
}

function persistRecurringSession(data, site_id, model) {
  data.recurring_sessions = data.recurring_sessions || {};
  data.recurring_sessions[site_id] = data.recurring_sessions[site_id] || {};
  data.recurring_sessions[site_id][model.id] = model;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getEditState(data) {
  return data.editClinic || null;
}

function setEditState(data, state) {
  data.editClinic = state;
}

function clearEditState(data) {
  delete data.editClinic;
}

function getEditSuccessState(data) {
  return data.editClinicSuccess || null;
}

function setEditSuccessState(data, state) {
  data.editClinicSuccess = state;
}

function bookingCountText(count) {
  return `${count} booking${count === 1 ? '' : 's'}`
}

function useClinicTimesAndCapacity() {
  return true;
}

function resetEditOutcome(state) {
  state.bookingAction = null;
  state.affectedBookingIds = [];
}

function editFieldsForStep(step, isSeries) {
  switch (step) {
    case 'details':
      return ['date'];
    case 'days':
      return isSeries ? ['days'] : ['date'];
    case 'clinic-times':
      return ['time', 'capacity', 'duration'];
    case 'appointments-calculator':
      return [];
    case 'services':
      return ['services'];
    case 'clinic-closures':
      return isSeries ? ['closures'] : ['date'];
    default:
      return [];
  }
}

function currentEditableFields(state) {
  const isSeries = state?.draft?.type === 'Clinic series';

  if (state?.currentEditField) {
    return [state.currentEditField];
  }

  if (state?.currentEditStep) {
    const fields = editFieldsForStep(state.currentEditStep, isSeries);
    if (fields.length > 0) return fields;
  }

  return [];
}

function setCurrentEditField(state, field) {
  state.currentEditField = field || null;
  state.currentEditStep = editStepForField(
    field,
    state?.draft?.type === 'Clinic series'
  );
  resetEditOutcome(state);
}

function setCurrentEditStep(state, step) {
  state.currentEditStep = step || null;
  state.currentEditField = null;
  resetEditOutcome(state);
}

function editSummaryPath(siteId, sessionId) {
  return `/site/${siteId}/clinics/edit/${sessionId}`;
}

function cancelSummaryPath(siteId, sessionId) {
  return `/site/${siteId}/clinics/cancel/${sessionId}`;
}

function editStepPath(siteId, sessionId, step) {
  return `${editSummaryPath(siteId, sessionId)}/${step}`;
}


function editStepForField(field, isSeries) {
  switch (field) {
    case 'date':
      return 'details';
    case 'days':
      return isSeries ? 'days' : 'details';
    case 'time':
      return 'clinic-times';
    case 'capacity':
    case 'duration':
      return 'clinic-times';
    case 'services':
      return 'services';
    case 'closures':
      return isSeries ? 'clinic-closures' : 'details';
    default:
      return null;
  }
}

function setEditTemplateData(res, data, state) {
  res.locals.data = {
    ...data,
    newSession: draftToNewSession(state.draft)
  };
}

function updateDraftFromDetails(state, newSession = {}) {
  const editableFields = currentEditableFields(state);

  if ((editableFields.length === 0 || editableFields.includes('name')) && newSession.name !== undefined) {
    state.draft.name = String(newSession.name || '').trim();
  }

  if (state.draft.type === 'Clinic series') {
    if (editableFields.length === 0 || editableFields.includes('date')) {
      const startISO = parseDateInputToISO(newSession.startDate || {});
      const endISO = parseDateInputToISO(newSession.endDate || {});
      if (startISO && endISO) {
        state.draft.startDate = startISO;
        state.draft.endDate = endISO;
        state.draft.startDateInput = toDateParts(startISO);
        state.draft.endDateInput = toDateParts(endISO);
      }
    }
    return;
  }

  if (editableFields.length === 0 || editableFields.includes('date')) {
    const singleISO = parseDateInputToISO(newSession.singleDate || {});
    if (singleISO) {
      state.draft.startDate = singleISO;
      state.draft.endDate = singleISO;
      state.draft.singleDate = singleISO;
      state.draft.singleDateInput = toDateParts(singleISO);
    }
  }
}

function updateDraftFromDays(state, newSession = {}) {
  state.draft.days = asArray(newSession.days);
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

function updateDraftFromAppointments(state, newSession = {}, options = {}) {
  const { canUpdateDuration = true } = options;
  const editableFields = currentEditableFields(state);

  if (editableFields.length === 0 || editableFields.includes('capacity')) {
    state.draft.capacity = Math.max(1, Number(newSession.capacity) || 1);
  }

  if (canUpdateDuration && (editableFields.length === 0 || editableFields.includes('duration'))) {
    const duration = Number(newSession.duration) || 10;
    state.draft.duration = Math.min(60, Math.max(1, duration));
  }
}

function updateDraftFromServices(state, newSession = {}) {
  state.draft.services = asArray(newSession.services);
}

function normalizeIsoMinute(datetimeISO) {
  const dt = DateTime.fromISO(datetimeISO || '', { zone: 'Europe/London' });
  if (!dt.isValid) return null;
  return dt.toFormat("yyyy-MM-dd'T'HH:mm");
}

function modelToDraft(model) {
  const type = inferClinicTypeFromModel(model);
  const startDateParts = toDateParts(model.startDate);
  const endDateParts = toDateParts(model.endDate || model.startDate);

  return {
    id: model.id,
    type,
    name: model.label || '',
    startDate: model.startDate,
    endDate: model.endDate || model.startDate,
    singleDate: model.startDate,
    days: asArray(model.recurrencePattern?.byDay),
    from: model.from,
    until: model.until,
    startTime: toTimeParts(model.from),
    endTime: toTimeParts(model.until),
    capacity: Number(model.capacity) || 1,
    duration: Number(model.slotLength) || 10,
    services: asArray(model.services),
    childSessions: clone(asArray(model.childSessions)),
    closures: asArray(model.closures)
      .filter((closure) => closure?.startDate && closure?.endDate)
      .map((closure) => ({
        startDate: closure.startDate,
        endDate: closure.endDate,
        label: closure.label || ''
      })),
    startDateInput: startDateParts,
    endDateInput: endDateParts,
    singleDateInput: startDateParts
  };
}

function draftToNewSession(draft) {
  return {
    name: draft.name,
    type: draft.type,
    startDate: draft.startDateInput,
    endDate: draft.endDateInput,
    singleDate: draft.singleDateInput,
    days: asArray(draft.days),
    startTime: draft.startTime,
    endTime: draft.endTime,
    capacity: String(draft.capacity),
    duration: String(draft.duration),
    services: asArray(draft.services),
    closures: asArray(draft.closures)
  };
}

function draftToModel(draft) {
  const model = buildRecurringSessionModel(draftToNewSession(draft));
  model.id = draft.id;
  model.type = draft.type;
  model.childSessions = clone(asArray(draft.childSessions));
  return model;
}

function normalizedBookingImpact(model = {}) {
  const normalizeServiceOps = (ops = []) => asArray(ops).map((op) => {
    if (typeof op === 'string') return op;
    if (!op || typeof op !== 'object') return op;
    return {
      operation: op.operation || '',
      service: op.service || '',
      values: asArray(op.values).slice().sort()
    };
  });

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
        services: normalizeServiceOps(child?.services)
      }))
      .sort((a, b) => `${a.date}-${a.from}-${a.until}`.localeCompare(`${b.date}-${b.from}-${b.until}`)),
    closures: asArray(model.closures)
      .filter((closure) => closure?.startDate && closure?.endDate)
      .map((closure) => ({
        startDate: closure.startDate,
        endDate: closure.endDate,
        label: closure.label || ''
      }))
      .sort((a, b) => `${a.startDate}-${a.endDate}-${a.label}`.localeCompare(`${b.startDate}-${b.endDate}-${b.label}`))
  };
}

function ensureEditStateForSession(data, siteId, sessionId, options = {}) {
  const { useClinicTimesAndCapacity: useClinicTimesAndCapacityFlag = true } = options;

  const existing = getEditState(data);
  if (existing && existing.siteId === siteId && existing.sessionId === sessionId) {
    existing.useClinicTimesAndCapacity = Boolean(useClinicTimesAndCapacityFlag);
    ensureClosureTrackingState(existing);
    setEditState(data, existing);
    return existing;
  }

  return initializeEditStateForSession(data, siteId, sessionId, {
    useClinicTimesAndCapacity: useClinicTimesAndCapacityFlag
  });
}

function initializeEditStateForSession(data, siteId, sessionId, options = {}) {
  const model = data?.recurring_sessions?.[siteId]?.[sessionId];
  if (!model) return null;

  const draft = modelToDraft(model);
  const draftClosures = asArray(draft.closures)
    .filter((closure) => closure?.startDate && closure?.endDate)
    .map((closure, index) => ({
      ...normalizeEditableClosure(closure),
      _editId: `closure-${index + 1}`
    }));

  draft.closures = draftClosures;
  const state = {
    siteId,
    sessionId,
    original: clone(model),
    draft,
    originalClosureRefs: draftClosures.map((closure) => ({
      editId: closure._editId,
      closure: {
        startDate: closure.startDate,
        endDate: closure.endDate,
        label: closure.label
      }
    })),
    nextClosureEditId: draftClosures.length + 1,
    useClinicTimesAndCapacity: Boolean(options.useClinicTimesAndCapacity),
    cancelMode: false,
    bookingAction: null,
    affectedBookingIds: []
  };

  setEditState(data, state);
  return state;
}

function calculateCancellationAffectedBookings(model, siteId, siteBookings = {}) {
  const affectedIds = new Set();
  const merged = mergeDailyAvailability({}, String(siteId || ''), { [model.id]: model });
  const sessionIds = new Set();
  const slotsByMinute = new Map();

  for (const [date, day] of Object.entries(merged || {})) {
    for (const session of (day.sessions || [])) {
      if (session?.id) {
        sessionIds.add(String(session.id));
      }

      const start = DateTime.fromISO(`${date}T${session.from}`, { zone: 'Europe/London' });
      const end = DateTime.fromISO(`${date}T${session.until}`, { zone: 'Europe/London' });
      const slotLength = Number(session.slotLength) || 10;
      const services = new Set(asArray(session.services));

      for (let dt = start; dt < end; dt = dt.plus({ minutes: slotLength })) {
        const key = dt.toFormat("yyyy-MM-dd'T'HH:mm");
        const existing = slotsByMinute.get(key) || new Set();
        for (const serviceId of services) {
          existing.add(serviceId);
        }
        slotsByMinute.set(key, existing);
      }
    }
  }

  for (const booking of Object.values(siteBookings || {})) {
    if (booking?.status !== 'scheduled') continue;

    const bookingRecurringId = String(booking?.recurringSessionId || '');
    const bookingSessionId = String(booking?.sessionId || '');

    if (bookingRecurringId === String(model.id)) {
      affectedIds.add(String(booking.id));
      continue;
    }

    // Bookings with explicit recurring identity should never fall back to time matching.
    if (bookingRecurringId) {
      continue;
    }

    if (bookingSessionId && sessionIds.has(bookingSessionId)) {
      affectedIds.add(String(booking.id));
      continue;
    }

    // Bookings with explicit session identity should never fall back to time matching.
    if (bookingSessionId) {
      continue;
    }

    const minute = booking?.slotKey || normalizeIsoMinute(booking?.datetime);
    if (!minute) continue;

    const services = slotsByMinute.get(minute);
    if (services && services.has(booking.service)) {
      affectedIds.add(String(booking.id));
    }
  }

  return Array.from(affectedIds);
}

function findSessionOccurrenceForCancellation(data, siteId, sessionId) {
  const recurringById = data?.recurring_sessions?.[siteId] || {};

  for (const [recurringId, model] of Object.entries(recurringById)) {
    const merged = mergeDailyAvailability({}, String(siteId || ''), { [recurringId]: model });

    for (const [date, day] of Object.entries(merged || {})) {
      for (const session of asArray(day?.sessions)) {
        if (String(session?.id || '') === String(sessionId || '')) {
          return {
            recurringId,
            model,
            date,
            session
          };
        }
      }
    }
  }

  return null;
}

function calculateCancellationAffectedBookingsForOccurrence(occurrence, siteBookings = {}) {
  const affectedIds = new Set();
  const services = new Set(asArray(occurrence?.session?.services));
  const slotLength = Number(occurrence?.session?.slotLength) || 10;
  const start = DateTime.fromISO(`${occurrence?.date}T${occurrence?.session?.from || ''}`, { zone: 'Europe/London' });
  const end = DateTime.fromISO(`${occurrence?.date}T${occurrence?.session?.until || ''}`, { zone: 'Europe/London' });
  const slotKeys = new Set();

  if (start.isValid && end.isValid && end > start) {
    for (let dt = start; dt < end; dt = dt.plus({ minutes: slotLength })) {
      slotKeys.add(dt.toFormat("yyyy-MM-dd'T'HH:mm"));
    }
  }

  for (const booking of Object.values(siteBookings || {})) {
    if (booking?.status !== 'scheduled') continue;

    const sameSession = String(booking?.sessionId || '') === String(occurrence?.session?.id || '');
    if (sameSession) {
      affectedIds.add(String(booking.id));
      continue;
    }

    const minute = booking?.slotKey || normalizeIsoMinute(booking?.datetime);
    if (!minute || !slotKeys.has(minute)) continue;

    const sameRecurring = String(booking?.recurringSessionId || '') === String(occurrence?.recurringId || '');
    if (!sameRecurring) continue;

    if (services.size === 0 || services.has(booking.service)) {
      affectedIds.add(String(booking.id));
    }
  }

  return Array.from(affectedIds);
}

function initializeCancelStateForSession(data, siteId, sessionId) {
  const state = initializeEditStateForSession(data, siteId, sessionId);
  const siteBookings = data?.bookings?.[siteId] || {};

  if (state) {
    const affectedBookingIds = calculateCancellationAffectedBookings(state.original, siteId, siteBookings);

    state.cancelMode = true;
    state.cancelScope = 'series';
    state.currentEditField = null;
    state.currentEditStep = null;
    state.affectedBookingIds = affectedBookingIds;
    state.bookingAction = null;

    setEditState(data, state);
    return state;
  }

  const occurrence = findSessionOccurrenceForCancellation(data, siteId, sessionId);
  if (!occurrence) return null;

  const occurrenceState = {
    siteId,
    sessionId,
    original: clone(occurrence.model),
    draft: {
      id: sessionId,
      type: 'Single clinic',
      startDate: occurrence.date,
      endDate: occurrence.date,
      from: occurrence.session.from,
      until: occurrence.session.until,
      services: asArray(occurrence.session.services)
    },
    cancelMode: true,
    cancelScope: 'occurrence',
    cancelRecurringId: occurrence.recurringId,
    cancelDate: occurrence.date,
    bookingAction: null,
    affectedBookingIds: calculateCancellationAffectedBookingsForOccurrence(occurrence, siteBookings)
  };

  setEditState(data, occurrenceState);
  return occurrenceState;
}

function parseDateInputToISO(input = {}) {
  const day = String(input.day || '').trim();
  const month = String(input.month || '').trim();
  const year = String(input.year || '').trim();
  if (!day || !month || !year) return null;

  const dt = DateTime.fromObject({ day: +day, month: +month, year: +year });
  return dt.isValid ? dt.toISODate() : null;
}

function hasEditFieldChanged(original, draft, field) {
  switch (field) {
    case 'date':
      if (draft?.type === 'Clinic series') {
        return String(original?.startDate || '') !== String(draft?.startDate || '')
          || String(original?.endDate || '') !== String(draft?.endDate || '');
      }
      return String(original?.startDate || '') !== String(draft?.startDate || '');
    case 'days':
      return JSON.stringify(asArray(original?.recurrencePattern?.byDay).slice().sort())
        !== JSON.stringify(asArray(draft?.days).slice().sort());
    case 'time':
      return String(original?.from || '') !== String(draft?.from || '')
        || String(original?.until || '') !== String(draft?.until || '');
    case 'capacity':
      return (Number(original?.capacity) || 1) !== (Number(draft?.capacity) || 1);
    case 'duration':
      return (Number(original?.slotLength) || 10) !== (Number(draft?.duration) || 10);
    case 'services':
      return JSON.stringify(asArray(original?.services).slice().sort())
        !== JSON.stringify(asArray(draft?.services).slice().sort());
    case 'closures': {
      const sortedClosures = (closures) => normalizeClosuresForComparison(closures)
        .sort((a, b) => `${a.startDate}-${a.endDate}-${a.label}`.localeCompare(`${b.startDate}-${b.endDate}-${b.label}`));

      return JSON.stringify(sortedClosures(original?.closures))
        !== JSON.stringify(sortedClosures(draft?.closures));
    }
    default:
      return false;
  }
}

function normalizeClosuresForComparison(closures) {
  return asArray(closures)
    .filter((closure) => closure?.startDate && closure?.endDate)
    .map((closure) => ({
      startDate: closure.startDate,
      endDate: closure.endDate,
      label: String(closure.label || '').trim()
    }));
}

function normalizeEditableClosure(closure = {}) {
  return {
    startDate: closure.startDate,
    endDate: closure.endDate,
    label: String(closure.label || '').trim(),
    _editId: closure._editId || null
  };
}

function ensureClosureTrackingState(state) {
  if (!state || state?.draft?.type !== 'Clinic series') return state;

  const draftClosures = asArray(state.draft.closures)
    .filter((closure) => closure?.startDate && closure?.endDate)
    .map((closure) => normalizeEditableClosure(closure));

  let nextId = Number(state.nextClosureEditId);
  if (!Number.isInteger(nextId) || nextId < 1) {
    nextId = 1;
  }

  for (const closure of draftClosures) {
    if (!closure._editId) {
      closure._editId = `closure-${nextId}`;
      nextId += 1;
    }
  }

  if (!Array.isArray(state.originalClosureRefs) || state.originalClosureRefs.length === 0) {
    state.originalClosureRefs = draftClosures.map((closure) => ({
      editId: closure._editId,
      closure: {
        startDate: closure.startDate,
        endDate: closure.endDate,
        label: closure.label
      }
    }));
  }

  state.draft.closures = draftClosures;
  state.nextClosureEditId = nextId;
  return state;
}

function nextClosureEditId(state) {
  state.nextClosureEditId = Number(state.nextClosureEditId);
  if (!Number.isInteger(state.nextClosureEditId) || state.nextClosureEditId < 1) {
    state.nextClosureEditId = 1;
  }

  const id = `closure-${state.nextClosureEditId}`;
  state.nextClosureEditId += 1;
  return id;
}

function closuresMatch(a, b) {
  return String(a?.startDate || '') === String(b?.startDate || '')
    && String(a?.endDate || '') === String(b?.endDate || '')
    && String(a?.label || '') === String(b?.label || '');
}

function buildClosureComparisons(draftClosures, previousClosures, originalClosureRefs = []) {
  const refs = asArray(originalClosureRefs)
    .filter((ref) => ref?.editId && ref?.closure)
    .map((ref) => ({
      editId: ref.editId,
      closure: normalizeClosuresForComparison([ref.closure])[0]
    }))
    .filter((ref) => ref.closure);

  if (refs.length > 0) {
    const originalById = new Map(refs.map((ref) => [ref.editId, ref.closure]));
    const seenOriginalIds = new Set();
    const comparisons = [];

    for (const closure of asArray(draftClosures)) {
      const current = normalizeClosuresForComparison([closure])[0];
      if (!current) continue;

      const editId = closure?._editId;
      if (editId && originalById.has(editId)) {
        const previous = originalById.get(editId);
        seenOriginalIds.add(editId);
        comparisons.push(
          closuresMatch(current, previous)
            ? { type: 'unchanged', current }
            : { type: 'changed', current, previous }
        );
      } else {
        comparisons.push({ type: 'added', current });
      }
    }

    for (const ref of refs) {
      if (!seenOriginalIds.has(ref.editId)) {
        comparisons.push({ type: 'removed', previous: ref.closure });
      }
    }

    return comparisons;
  }

  const current = normalizeClosuresForComparison(draftClosures);
  const previous = normalizeClosuresForComparison(previousClosures);
  const matchedPreviousIndexes = new Set();
  const comparisons = [];

  for (const currentClosure of current) {
    let exactMatchIndex = -1;
    for (let i = 0; i < previous.length; i += 1) {
      if (matchedPreviousIndexes.has(i)) continue;
      if (closuresMatch(currentClosure, previous[i])) {
        exactMatchIndex = i;
        break;
      }
    }

    if (exactMatchIndex >= 0) {
      matchedPreviousIndexes.add(exactMatchIndex);
      comparisons.push({
        type: 'unchanged',
        current: currentClosure
      });
      continue;
    }

    let firstUnmatchedPreviousIndex = -1;
    for (let i = 0; i < previous.length; i += 1) {
      if (!matchedPreviousIndexes.has(i)) {
        firstUnmatchedPreviousIndex = i;
        break;
      }
    }

    if (firstUnmatchedPreviousIndex >= 0) {
      matchedPreviousIndexes.add(firstUnmatchedPreviousIndex);
      comparisons.push({
        type: 'changed',
        current: currentClosure,
        previous: previous[firstUnmatchedPreviousIndex]
      });
      continue;
    }

    comparisons.push({
      type: 'added',
      current: currentClosure
    });
  }

  for (let i = 0; i < previous.length; i += 1) {
    if (!matchedPreviousIndexes.has(i)) {
      comparisons.push({
        type: 'removed',
        previous: previous[i]
      });
    }
  }

  return comparisons;
}

function buildChangedFieldKeysForEdit(original, draft, state) {
  const editableFields = currentEditableFields(state);
  const candidateFields = editableFields.length > 0
    ? editableFields
    : ['date', 'days', 'time', 'capacity', 'duration', 'services', 'closures'];

  const changedFields = candidateFields
    .filter((field) => hasEditFieldChanged(original, draft, field));

  if (changedFields.length > 0) {
    return changedFields;
  }

  if (editableFields.length > 0) {
    return editableFields;
  }

  return candidateFields;
}

function childSessionUnaffectedByField(childSession, field) {
  switch (field) {
    case 'time':
      return Boolean(childSession?.from && childSession?.until);
    case 'capacity':
      return childSession?.capacity !== undefined && childSession?.capacity !== null;
    case 'services':
      return asArray(childSession?.services).length > 0;
    default:
      return false;
  }
}

function formatShortDate(dateISO) {
  const dt = DateTime.fromISO(dateISO || '');
  return dt.isValid ? dt.toFormat('d MMM yyyy') : String(dateISO || '');
}

function buildUnaffectedChildClinicDates(model, changedFields, siteId) {
  const childSessions = asArray(model?.childSessions).filter((childSession) => childSession?.date);
  if (childSessions.length === 0) return [];

  const changed = asArray(changedFields).filter(Boolean);
  if (changed.length === 0) return [];

  const merged = mergeDailyAvailability({}, String(siteId || ''), { [model.id]: model });

  const unaffectedDates = childSessions
    .filter((childSession) => changed.every((field) => childSessionUnaffectedByField(childSession, field)))
    .map((childSession) => childSession.date)
    .filter((dateISO) => {
      const sessions = merged?.[dateISO]?.sessions || [];
      return sessions.some((session) => String(session?.recurringId) === String(model?.id));
    });

  return Array.from(new Set(unaffectedDates))
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map((dateISO) => formatShortDate(dateISO));
}

function buildUnaffectedChildReasonText(changedFields = []) {
  const changed = new Set(asArray(changedFields));
  const labels = [];

  if (changed.has('time')) labels.push('start and end times');
  if (changed.has('capacity')) labels.push('vaccinators');
  if (changed.has('services')) labels.push('services');

  if (labels.length === 0) {
    return 'details';
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} or ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
}

function reviewBackPath(siteId, sessionId, state) {
  if (state?.cancelMode) {
    return cancelSummaryPath(siteId, sessionId);
  }

  if (asArray(state?.affectedBookingIds).length > 0) {
    return `${editSummaryPath(siteId, sessionId)}/affected-bookings`;
  }

  const step = state?.currentEditStep
    || editStepForField(
      state?.currentEditField,
      state?.draft?.type === 'Clinic series'
    );
  if (step) {
    return editStepPath(siteId, sessionId, step);
  }

  return editSummaryPath(siteId, sessionId);
}

function prepareReviewAfterEdit(data, siteId, state) {
  const updatedModel = draftToModel(state.draft);
  updatedModel.site_id = siteId;
  const originalModel = { ...state.original, site_id: siteId };
  const siteBookings = data?.bookings?.[siteId] || {};
  const affectedIds = calculateAffectedBookings(originalModel, updatedModel, siteBookings);

  state.affectedBookingIds = affectedIds;
  if (affectedIds.length === 0) {
    state.bookingAction = null;
  }

  const nextPath = affectedIds.length > 0
    ? `${editSummaryPath(siteId, state.sessionId)}/affected-bookings`
    : `${editSummaryPath(siteId, state.sessionId)}/check-answers`;

  setEditState(data, state);
  return nextPath;
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

  const bookingFitsSlot = (booking, slot) => {
    return slot.remaining > 0 && slot.services.includes(booking.service);
  };

  const assignBookingsToSlots = (bookings, slots) => {
    const survivors = new Set();
    const workingSlots = (slots || []).map((slot) => ({
      services: slot.services,
      remaining: Number(slot.capacity) || 0
    }));

    for (const booking of bookings) {
      const candidates = workingSlots
        .filter((slot) => bookingFitsSlot(booking, slot))
        .sort((a, b) => {
          if (a.services.length !== b.services.length) {
            return a.services.length - b.services.length;
          }
          return a.remaining - b.remaining;
        });

      const chosen = candidates[0];
      if (!chosen) continue;

      chosen.remaining -= 1;
      survivors.add(String(booking.id));
    }

    return survivors;
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

    const fitsOriginal = booking?.sessionId
      ? originalSlots.some((slot) => String(slot.sessionId) === String(booking.sessionId) && asArray(slot.services).includes(booking.service))
      : originalSlots.some((slot) => asArray(slot.services).includes(booking.service));
    if (!fitsOriginal) continue;

    const bucket = bookingsByMinute.get(key) || [];
    bucket.push(booking);
    bookingsByMinute.set(key, bucket);
  }

  const affectedIds = [];

  for (const [minute, minuteBookings] of bookingsByMinute.entries()) {
    const sortedBookings = minuteBookings
      .slice()
      .sort((a, b) => Number(a.id) - Number(b.id));
    const updatedSlots = updatedSlotsByMinute.get(minute) || [];
    const survivors = assignBookingsToSlots(sortedBookings, updatedSlots);

    for (const booking of sortedBookings) {
      if (!survivors.has(String(booking.id))) {
        affectedIds.push(String(booking.id));
      }
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

function isSeriesHistoryRow(session = {}) {
  if (!session) return false;
  if (session.type === 'Clinic series') return true;
  return Boolean(session.date && session.endDate && session.endDate !== session.date);
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function paginateItems(items = [], requestedPage = 1, perPage = 10) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
  const startIndex = (currentPage - 1) * perPage;

  return {
    items: items.slice(startIndex, startIndex + perPage),
    currentPage,
    totalPages,
    totalItems
  };
}

function buildPaginationHref(pathname, query = {}, targetPage = 1) {
  const params = new URLSearchParams();

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry === undefined || entry === null || entry === '') return;
        params.append(key, String(entry));
      });
      return;
    }

    params.set(key, String(value));
  });

  if (targetPage > 1) {
    params.set('page', String(targetPage));
  }

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

function buildNhsPagination(pathname, query, currentPage, totalPages) {
  if (totalPages <= 1) return null;

  const pageItem = (pageNumber) => ({
    number: pageNumber,
    href: buildPaginationHref(pathname, query, pageNumber),
    current: pageNumber === currentPage
  });

  const model = {
    items: []
  };

  const siblingCount = 2;
  const middleStart = Math.max(2, currentPage - siblingCount);
  const middleEnd = Math.min(totalPages - 1, currentPage + siblingCount);

  model.items.push(pageItem(1));

  if (middleStart > 2) {
    model.items.push({ ellipsis: true });
  }

  for (let page = middleStart; page <= middleEnd; page += 1) {
    model.items.push(pageItem(page));
  }

  if (middleEnd < totalPages - 1) {
    model.items.push({ ellipsis: true });
  }

  if (totalPages > 1) {
    model.items.push(pageItem(totalPages));
  }

  if (currentPage > 1) {
    model.previous = {
      href: buildPaginationHref(pathname, query, currentPage - 1)
    };
  }

  if (currentPage < totalPages) {
    model.next = {
      href: buildPaginationHref(pathname, query, currentPage + 1)
    };
  }

  return model;
}

function buildSessionHistory(siteRecurringSessions, startDate = null, endDate = null, today = null) {
  const rows = [];

  for (const session of Object.values(siteRecurringSessions || {})) {
    const sessionStart = session?.startDate;
    const sessionEnd = session?.endDate || sessionStart;
    if (!sessionStart || !sessionEnd) continue;

    // Keep recurring sessions visible while they are still active.
    if (today && sessionEnd < today) continue;

    // Keep sessions that overlap the requested filter window.
    if (startDate && sessionEnd < startDate) continue;
    if (endDate && sessionStart > endDate) continue;

    rows.push({
      id: session.id,
      isLegacy: Boolean(session.isLegacy || session.legacy),
      type: session.type,
      label: session.label,
      date: sessionStart,
      endDate: sessionEnd,
      days: session.recurrencePattern?.byDay || [],
      from: session.from,
      until: session.until,
      services: session.services || [],
      capacity: Number(session.capacity) || 0,
      slotLength: Number(session.slotLength) || 0
    });
  }

  return rows.sort((a, b) => {
    const aIsSeries = isSeriesHistoryRow(a);
    const bIsSeries = isSeriesHistoryRow(b);
    if (aIsSeries !== bIsSeries) {
      return aIsSeries ? -1 : 1;
    }

    if (a.date === b.date) {
      return (a.from || '').localeCompare(b.from || '');
    }
    return a.date.localeCompare(b.date);
  });
}

function buildPastSessionHistory(siteRecurringSessions, startDate = null, endDate = null, today = null) {
  const rows = [];

  for (const session of Object.values(siteRecurringSessions || {})) {
    const sessionStart = session?.startDate;
    const sessionEnd = session?.endDate || sessionStart;
    if (!sessionStart || !sessionEnd) continue;

    // Keep only sessions that have ended.
    if (!today || sessionEnd >= today) continue;

    if (startDate && sessionEnd < startDate) continue;
    if (endDate && sessionStart > endDate) continue;

    rows.push({
      id: session.id,
      isLegacy: Boolean(session.isLegacy || session.legacy),
      type: session.type,
      label: session.label,
      date: sessionStart,
      endDate: sessionEnd,
      days: session.recurrencePattern?.byDay || [],
      from: session.from,
      until: session.until,
      services: session.services || [],
      capacity: Number(session.capacity) || 0,
      slotLength: Number(session.slotLength) || 0
    });
  }

  return rows.sort((a, b) => {
    const aIsSeries = isSeriesHistoryRow(a);
    const bIsSeries = isSeriesHistoryRow(b);
    if (aIsSeries !== bIsSeries) {
      return aIsSeries ? -1 : 1;
    }

    if (a.date === b.date) {
      return (a.from || '').localeCompare(b.from || '');
    }
    return a.date.localeCompare(b.date);
  });
}

function buildLegacyAvailabilitySessions(legacySessions, date, siteId, servicesById, backHref) {
  return asArray(legacySessions)
    .filter((session) => session?.date === date)
    .map((session) => {
      const bookedTotal = Math.max(0, Number(session?.bookedTotal) || 0);
      const unbookedTotal = Math.max(0, Number(session?.unbookedTotal) || 0);
      const serviceIds = asArray(session.services);
      const perServiceBase = serviceIds.length > 0 ? Math.floor(bookedTotal / serviceIds.length) : 0;
      const perServiceRemainder = serviceIds.length > 0 ? bookedTotal % serviceIds.length : 0;

      return {
        id: session.id,
        isLegacy: true,
        label: session.label || 'Legacy clinic',
        from: session.from,
        until: session.until,
        services: serviceIds.map((serviceId, index) => ({
          id: serviceId,
          name: servicesById?.[serviceId]?.name || serviceId,
          bookedCount: perServiceBase + (index < perServiceRemainder ? 1 : 0)
        })),
        bookedTotal,
        unbookedTotal,
        actionHref: `/site/${siteId}/clinics/old-change/${session.id}${backHref ? `?back=${encodeURIComponent(backHref)}` : ''}`,
        cancelHref: null
      };
    });
}

function sortSessionsForAvailability(sessions = []) {
  return asArray(sessions).slice().sort((a, b) => {
    const left = `${a?.from || ''}-${a?.until || ''}-${a?.label || ''}`;
    const right = `${b?.from || ''}-${b?.until || ''}-${b?.label || ''}`;
    return left.localeCompare(right);
  });
}

function slotMatchesSession(slot, session) {
  if (slot?.sessionId && session?.id) {
    return String(slot.sessionId) === String(session.id);
  }

  return slot?.group?.start === session?.from
    && slot?.group?.end === session?.until
    && (!slot?.recurringSessionId || !session?.recurringId || String(slot.recurringSessionId) === String(session.recurringId));
}

function buildWeekAvailabilitySummary(week, dailyAvailability, slotsByDate, servicesById, siteBookings, siteId, today, recurringSessionsById = {}, backHref = null) {
  return week.map((day) => {
    const sessions = sortSessionsForAvailability(dailyAvailability?.[day]?.sessions);
    const dateSlots = asArray(slotsByDate?.[day]);

    const sessionSummaries = sessions.map((session) => {
      const sessionSlots = dateSlots.filter((slot) => slotMatchesSession(slot, session));
      const bookedTotal = sessionSlots.filter((slot) => slot?.booking_status === 'scheduled').length;
      const totalSlots = sessionSlots.length;
      const resolvedLabel = session.label || recurringSessionsById?.[session?.recurringId]?.label || '';

      const changeHrefBase = day < today || !session?.recurringId
        ? null
        : `/site/${siteId}/change/session/${session.id}`;
      const cancelHref = day < today || !session?.recurringId
        ? null
        : `/site/${siteId}/clinics/cancel/${session.id}`;

      return {
        id: session.id,
        label: resolvedLabel,
        from: session.from,
        until: session.until,
        services: asArray(session.services).map((serviceId) => ({
          id: serviceId,
          name: servicesById?.[serviceId]?.name || serviceId,
          bookedCount: sessionSlots.filter((slot) => (
            slot?.booking_status === 'scheduled'
            && slot?.booking_id
            && siteBookings?.[slot.booking_id]?.service === serviceId
          )).length
        })),
        bookedTotal,
        unbookedTotal: Math.max(0, totalSlots - bookedTotal),
        actionHref: changeHrefBase
          ? `${changeHrefBase}${backHref ? `?back=${encodeURIComponent(backHref)}` : ''}`
          : null,
        cancelHref
      };
    });

    const totalAppointments = sessionSummaries.reduce((sum, session) => sum + session.bookedTotal + session.unbookedTotal, 0);
    const bookedAppointments = sessionSummaries.reduce((sum, session) => sum + session.bookedTotal, 0);
    const clinicNames = [...new Set(sessionSummaries.map((session) => session.label).filter(Boolean))];

    return {
      date: day,
      isToday: day === today,
      isPast: day < today,
      clinicNames,
      sessions: sessionSummaries,
      totalAppointments,
      bookedAppointments,
      unbookedAppointments: Math.max(0, totalAppointments - bookedAppointments),
      dayViewHref: `/site/${siteId}/clinics/day?date=${day}`
    };
  });
}

function buildMonthWeekRanges(referenceDateISO) {
  const fallback = DateTime.fromISO(getToday());
  const referenceDate = DateTime.fromISO(referenceDateISO || '', { zone: 'Europe/London' });
  const current = (referenceDate.isValid ? referenceDate : fallback).startOf('month');
  const firstWeekStart = current.startOf('week');
  const lastWeekStart = current.endOf('month').startOf('week');
  const weeks = [];

  for (let cursor = firstWeekStart; cursor <= lastWeekStart; cursor = cursor.plus({ days: 7 })) {
    const days = [];
    for (let i = 0; i < 7; i += 1) {
      days.push(cursor.plus({ days: i }).toISODate());
    }

    weeks.push({
      start: cursor.toISODate(),
      end: cursor.plus({ days: 6 }).toISODate(),
      days
    });
  }

  return {
    currentDate: current.toISODate(),
    previousMonthDate: current.minus({ months: 1 }).toISODate(),
    nextMonthDate: current.plus({ months: 1 }).toISODate(),
    weeks
  };
}

function buildMonthAvailabilitySummary(weekRanges, dailyAvailability, slotsByDate, servicesById, siteBookings, siteId, today, recurringSessionsById = {}) {
  return asArray(weekRanges).map((weekRange) => {
    const daySummaries = buildWeekAvailabilitySummary(
      weekRange.days,
      dailyAvailability,
      slotsByDate,
      servicesById,
      siteBookings,
      siteId,
      today,
        recurringSessionsById,
        null
    );

    const services = new Map();

    daySummaries.forEach((day) => {
      day.sessions.forEach((session) => {
        session.services.forEach((service) => {
          const existing = services.get(service.id) || {
            id: service.id,
            name: service.name,
            bookedCount: 0
          };

          existing.bookedCount += Number(service.bookedCount) || 0;
          services.set(service.id, existing);
        });
      });
    });

    const totalAppointments = daySummaries.reduce((sum, day) => sum + day.totalAppointments, 0);
    const bookedAppointments = daySummaries.reduce((sum, day) => sum + day.bookedAppointments, 0);

    return {
      start: weekRange.start,
      end: weekRange.end,
      services: Array.from(services.values()),
      totalAppointments,
      bookedAppointments,
      unbookedAppointments: Math.max(0, totalAppointments - bookedAppointments),
      weekViewHref: `/site/${siteId}/clinics/week?date=${weekRange.start}`
    };
  });
}

module.exports = {
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
};
