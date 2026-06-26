const generateAvailability = require('./_lib/generateAvailability');
const generateSlots = require('./_lib/generateSlots');
const generateBookings = require('./_lib/generateBookings');
const fs = require('fs');
const path = require('path');
const { stableId } = require('./_lib/utils');
const catNames = require('./_lib/catNames');
const mergeDailyAvailability = require('../helpers/recurringToDailyAvailability');
const { applyDocumentationFixtures } = require('./documentation-fixtures');
const { DateTime } = require('luxon');

const override_today = process.env.OVERRIDE_TODAY || null;

const SERVICE_GROUPS = {
  FLU: {
    id: 'FLU',
    title: 'Flu services'
  },
  COVID: {
    id: 'COVID',
    title: 'COVID-19 services'
  },
  FLU_AND_COVID: {
    id: 'FLU_AND_COVID',
    title: 'Flu and COVID-19 co-admin services'
  },
  RSV: {
    id: 'RSV',
    title: 'RSV services'
  },
  RSV_AND_COVID: {
    id: 'RSV_AND_COVID',
    title: 'RSV and COVID-19 co-admin services'
  },
  // MENB: {
  //   id: 'MENB',
  //   title: 'MenB services'
  // }
};

const vaccineTypes = {
  COVID: 'COVID-19',
  FLU: 'Flu',
  RSV: 'RSV',
  MENB: 'Meningitis B'
};

const serviceDefinitions = [
  { id: 'COVID:5-11', name: 'COVID 5 to 11', vaccine: vaccineTypes.COVID, group: 'COVID', age: '5-11', type: 'Child' },
  { id: 'COVID:12-17', name: 'COVID 12 to 17', vaccine: vaccineTypes.COVID, group: 'COVID', age: '12-17', type: 'Child' },
  { id: 'COVID:18+', name: 'COVID 18+', vaccine: vaccineTypes.COVID, group: 'COVID', age: '18+', type: 'Adult' },
  { id: 'FLU:2-3', name: 'Flu 2 to 3', vaccine: vaccineTypes.FLU, group: 'FLU', age: '2-3', type: 'Child' },
  { id: 'FLU:18-64', name: 'Flu 18 to 64', vaccine: vaccineTypes.FLU, group: 'FLU', age: '18-64', type: 'Adult' },
  { id: 'FLU:65+', name: 'Flu 65+', vaccine: vaccineTypes.FLU, group: 'FLU', age: '65+', type: 'Adult' },
  { id: 'COVID_FLU:18-64', name: 'COVID and Flu 18 to 64', vaccine: [vaccineTypes.COVID, vaccineTypes.FLU], group: 'FLU_AND_COVID', age: '18-64', type: 'Adult' },
  { id: 'COVID_FLU:65+', name: 'COVID and Flu 65+', vaccine: [vaccineTypes.COVID, vaccineTypes.FLU], group: 'FLU_AND_COVID', age: '65+', type: 'Adult' },
  { id: 'RSV:Adult', name: 'RSV Adult', vaccine: vaccineTypes.RSV, group: 'RSV', age: '18+', type: 'Adult' },
  { id: 'RSV_COVID:12-17', name: 'RSV and COVID 12 to 17', vaccine: [vaccineTypes.RSV, vaccineTypes.COVID], group: 'RSV_AND_COVID', age: '12-17', type: 'Child' },
  { id: 'RSV_COVID:18+', name: 'RSV and COVID 18+', vaccine: [vaccineTypes.RSV, vaccineTypes.COVID], group: 'RSV_AND_COVID', age: '18+', type: 'Adult' },
  //{ id: 'MENB:16-18', name: 'MenB Young People', vaccine: vaccineTypes.MENB, group: 'MENB', age: '17-18', type: null }
];

const SERVICES = Object.fromEntries(
  serviceDefinitions.map((definition) => [
    definition.id,
    {
      id: definition.id,
      name: definition.name,
      vaccine: definition.vaccine,
      group: definition.group,
      cohort: {
        age: definition.age,
        type: definition.type
      }
    }
  ])
);

// --- Define base data ---
const base = {
  //global data
  user: { 
    name: 'example.user@nhs.net',
    links: {
      overview: [
        {
          text: 'user@example.com'
        },
        {
          text: 'Log out',
          href: '/login'
        }
      ],
      site: [
        {
          isSiteName: true
        },
        {
          text: 'user@example.com'
        },
        {
          text: 'Log out',
          href: '/login'
        }
      ]
    }
   },
  navigation: { 
    homepage: {
      href: '/sites'
    },
    overview: [
      {
        text: 'Reports',
        href: '#'
      }
    ],
    site: [
      {
        text: 'Home',
        hrefTemplate: '/site/:id',
        exact: true,
        hideCard: true
      },
      {
        text: 'Clinics',
        description: 'View appointments and manage clinics for your site',
        hrefTemplate: '/site/:id/availability/day'
      },
      {
        text: 'Change site details',
        description: 'Change site details and accessibility information',
        href: '#'
      },
      {
        text: 'Manage users',
        description: 'Add or remove users for your site',
        href: '#'
      },
      {
        text: 'Reports',
        description: 'Download reports',
        href: '#'
      }
    ]
   },
  statuses: { 
    online: {
      text: 'Online',
      colour: 'green'
    },
    offline: {
      text: 'Offline',
      colour: 'red'
    } 
  },
  serviceGroups: SERVICE_GROUPS,
  services: SERVICES
}

function loadSiteConfigs() {
  const siteConfigFiles = fs.readdirSync(__dirname)
    .filter((fileName) => /^site.*\.config\.js$/.test(fileName))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  return siteConfigFiles.map((fileName) => require(path.join(__dirname, fileName)));
}

const sitesConfig = loadSiteConfigs();

const daily_availability = {};
const bookings = {};
const sites = {};
const recurring_sessions = {};
const users_by_site = {};
const DEFAULT_WINDOW_PAST_DAYS = 14;
const DEFAULT_WINDOW_FUTURE_DAYS = 90;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepClone(item)])
    );
  }

  return value;
}

function mergeWithDefaults(defaults, overrides) {
  if (overrides === undefined) {
    return deepClone(defaults);
  }

  if (Array.isArray(defaults) && Array.isArray(overrides)) {
    return deepClone(overrides);
  }

  if (isPlainObject(defaults) && isPlainObject(overrides)) {
    const keys = new Set([...Object.keys(defaults), ...Object.keys(overrides)]);
    const merged = {};

    for (const key of keys) {
      merged[key] = mergeWithDefaults(defaults[key], overrides[key]);
    }

    return merged;
  }

  return deepClone(overrides);
}

function normalizeUserOverride(user = {}) {
  const normalized = deepClone(user || {});
  const email = String(normalized.email || '').trim();

  if (!email) {
    return normalized;
  }

  normalized.links = isPlainObject(normalized.links) ? normalized.links : {};

  if (!Array.isArray(normalized.links.overview)) {
    normalized.links.overview = [
      {
        text: email
      },
      {
        text: 'Log out',
        href: '/login'
      }
    ];
  }

  if (!Array.isArray(normalized.links.site)) {
    normalized.links.site = [
      {
        isSiteName: true
      },
      {
        text: email
      },
      {
        text: 'Log out',
        href: '/login'
      }
    ];
  }

  return normalized;
}

const default_user = deepClone(base.user);

function toLegacyDateISO(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const asDate = DateTime.fromISO(value);
    return asDate.isValid ? asDate.toISODate() : null;
  }

  if (typeof value?.toISODate === 'function') {
    return value.toISODate();
  }

  return null;
}

function buildLegacySessionsBySite(configs = []) {
  const legacyBySite = {};

  configs.forEach((config) => {
    const site_id = String(config?.site?.id || '').trim();
    if (!site_id) return;

    const legacyClinics = Array.isArray(config?.legacyClinics) ? config.legacyClinics : [];
    const sessions = [];
    let sequence = 0;

    legacyClinics.forEach((clinic) => {
      const startDateISO = toLegacyDateISO(clinic?.date);
      if (!startDateISO) return;

      const occurrences = Math.max(
        1,
        Number(clinic?.numberOfOccurances || clinic?.numberOfOccurrences) || 1
      );

      for (let occurrence = 0; occurrence < occurrences; occurrence += 1) {
        sequence += 1;
        const date = DateTime.fromISO(startDateISO).plus({ days: occurrence }).toISODate();
        const fallbackBookedTotal = (sequence % 6) + 2;
        const fallbackUnbookedTotal = ((sequence + 2) % 5) + 1;
        const bookedTotal = Math.max(
          0,
          Number(clinic?.bookedTotal ?? clinic?.booked) || fallbackBookedTotal
        );
        const unbookedTotal = Math.max(
          0,
          Number(clinic?.unbookedTotal ?? clinic?.free) || fallbackUnbookedTotal
        );

        sessions.push({
          id: `${site_id}-legacy-old-${sequence}`,
          isLegacy: true,
          type: 'Legacy clinic',
          date,
          endDate: date,
          from: clinic?.from || '09:00',
          until: clinic?.until || '17:00',
          services: Array.isArray(clinic?.services) ? clinic.services : [],
          bookedTotal,
          unbookedTotal
        });
      }
    });

    legacyBySite[site_id] = sessions;
  });

  return legacyBySite;
}

const legacy_sessions_by_site = buildLegacySessionsBySite(sitesConfig);

function buildRecurringDefaults({ site_id, start, end, patterns = {} }) {
  const grouped = new Map();

  for (const [dayName, sessions] of Object.entries(patterns)) {
    for (const session of (sessions || [])) {
      const normalized = {
        from: session.from,
        until: session.until,
        slotLength: Number(session.slotLength) || 10,
        services: session.services || [],
        capacity: Number(session.capacity) || 1
      };

      const signature = JSON.stringify(normalized);
      if (!grouped.has(signature)) {
        grouped.set(signature, {
          ...normalized,
          byDay: []
        });
      }

      const bucket = grouped.get(signature);
      if (!bucket.byDay.includes(dayName)) {
        bucket.byDay.push(dayName);
      }
    }
  }

  const output = {};
  for (const record of grouped.values()) {
    const id = stableId(`${site_id}-${start}-${end}-${record.from}-${record.until}-${record.services.join('|')}-${record.capacity}-${record.slotLength}`);
    output[id] = {
      id,
      label: `${record.byDay.join(', ')} clinic series ${record.from}`,
      startDate: start,
      endDate: end,
      recurrencePattern: {
        frequency: 'Weekly',
        interval: 1,
        byDay: record.byDay
      },
      from: record.from,
      until: record.until,
      slotLength: record.slotLength,
      services: record.services,
      capacity: record.capacity,
      childSessions: [],
      closures: []
    };
  }

  return output;
}

function buildSeedRecurringDefaults(site_id, seedRecurringClinics = []) {
  const output = {};

  for (const clinic of seedRecurringClinics) {
    const stableSignature = [
      site_id,
      clinic.startDate,
      clinic.endDate,
      clinic.from,
      clinic.until,
      (clinic.services || []).join('|'),
      clinic.capacity,
      clinic.slotLength,
      ((clinic.recurrencePattern && clinic.recurrencePattern.byDay) || []).join('|')
    ].join('-');

    const id = clinic.id || stableId(stableSignature);
    output[id] = {
      id,
      label: clinic.label || `Clinic ${clinic.from || ''}`.trim(),
      legacy: Boolean(clinic.legacy || clinic.isLegacy),
      excludeFromBookingGeneration: Boolean(clinic.excludeFromBookingGeneration || clinic.noBookings),
      startDate: clinic.startDate,
      endDate: clinic.endDate || clinic.startDate,
      recurrencePattern: clinic.recurrencePattern || {
        frequency: 'Weekly',
        interval: 1,
        byDay: []
      },
      from: clinic.from,
      until: clinic.until,
      slotLength: Number(clinic.slotLength) || 10,
      services: clinic.services || [],
      capacity: Number(clinic.capacity) || 1,
      childSessions: clinic.childSessions || [],
      closures: clinic.closures || []
    };
  }

  return output;
}

function normalizeBookingDatetime(datetimeISO, timezone = 'Europe/London') {
  const dt = DateTime.fromISO(datetimeISO || '', { zone: timezone });
  if (!dt.isValid) return null;
  return dt.toISO({ suppressSeconds: true, suppressMilliseconds: true });
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function buildSlotLookup(slots = [], timezone = 'Europe/London') {
  const lookup = new Map();

  for (const slot of slots) {
    const slotKey = slot?.slotKey || normalizeBookingDatetime(slot?.datetimeISO, timezone);
    if (!slotKey) continue;

    const bucket = lookup.get(slotKey) || [];
    bucket.push({
      recurringSessionId: slot.recurringSessionId || null,
      sessionId: slot.sessionId || null,
      slotKey
    });
    lookup.set(slotKey, bucket);
  }

  return lookup;
}

function findBookingSlotIdentity(bookingLike = {}, slotLookup = new Map(), timezone = 'Europe/London') {
  const slotKey = bookingLike?.slotKey || normalizeBookingDatetime(bookingLike?.datetime || bookingLike?.datetimeISO, timezone);
  if (!slotKey) {
    return {
      recurringSessionId: bookingLike?.recurringSessionId || null,
      sessionId: bookingLike?.sessionId || null,
      slotKey: null
    };
  }

  if (bookingLike?.sessionId || bookingLike?.recurringSessionId) {
    return {
      recurringSessionId: bookingLike?.recurringSessionId || null,
      sessionId: bookingLike?.sessionId || null,
      slotKey
    };
  }

  const candidates = slotLookup.get(slotKey) || [];
  const match = candidates[0] || null;

  return {
    recurringSessionId: match?.recurringSessionId || null,
    sessionId: match?.sessionId || null,
    slotKey
  };
}

function applyBookingOverrides(generatedBookings, bookingOverrides, site_id, slots = [], timezone = 'Europe/London') {
  const output = { ...(generatedBookings || {}) };
  const overrideList = toArray(bookingOverrides);
  if (overrideList.length === 0) return output;
  const slotLookup = buildSlotLookup(slots, timezone);

  const bookingsById = Object.values(output);
  const datetimeToId = new Map();
  let maxId = 0;

  for (const booking of bookingsById) {
    const id = Number(booking.id) || 0;
    if (id > maxId) maxId = id;

    const normalizedDatetime = normalizeBookingDatetime(booking.datetime, timezone);
    if (!normalizedDatetime) continue;

    if (!datetimeToId.has(normalizedDatetime)) {
      datetimeToId.set(normalizedDatetime, booking.id);
    }
  }

  for (const override of overrideList) {
    const normalizedDatetime = normalizeBookingDatetime(override?.datetime, timezone);
    if (!normalizedDatetime) continue;

    let targetId = null;
    const requestedId = Number(override?.id);
    if (requestedId && output[requestedId]) {
      targetId = requestedId;
    } else {
      targetId = datetimeToId.get(normalizedDatetime) || null;
    }

    if (!targetId) {
      maxId += 1;
      targetId = maxId;
    }

    const existing = output[targetId] || {};
    const status = override?.status || existing.status || 'scheduled';
    const slotIdentity = findBookingSlotIdentity(
      {
        ...existing,
        ...override,
        datetime: normalizedDatetime
      },
      slotLookup,
      timezone
    );

    output[targetId] = {
      ...existing,
      ...override,
      id: targetId,
      site_id,
      recurringSessionId: slotIdentity.recurringSessionId || existing.recurringSessionId || null,
      sessionId: slotIdentity.sessionId || existing.sessionId || null,
      slotKey: slotIdentity.slotKey || existing.slotKey || null,
      datetime: normalizedDatetime,
      status,
      name: override?.name || existing.name || 'Manual booking',
      service: override?.service || existing.service || null,
      nhsNumber: override?.nhsNumber || existing.nhsNumber || '',
      dob: override?.dob || existing.dob || null,
      contact: override?.contact || existing.contact || {}
    };

    datetimeToId.set(normalizedDatetime, targetId);
  }

  return output;
}

function filterAvailabilityByDateWindow(availability, startISO, endISO) {
  const output = {};

  for (const [dateISO, day] of Object.entries(availability || {})) {
    if (dateISO < startISO || dateISO > endISO) continue;
    output[dateISO] = day;
  }

  return output;
}

for (const cfg of sitesConfig) {
  const {
    site,
    user,
    start,
    end,
    patterns,
    overrides,
    bookings: bookingConfig,
    clinics,
    seedClinics,
    seedRecurringClinics = []
  } = cfg;
  const configuredClinics = clinics || seedClinics || seedRecurringClinics;
  const site_id = site.id;
  const hasDateRange = Boolean(start && end);
  const hasPatterns = Object.keys(patterns || {}).length > 0;
  const hasOverrides = Object.keys(overrides || {}).length > 0;
  const today = DateTime.now().startOf('day');
  const windowStart = today.minus({ days: DEFAULT_WINDOW_PAST_DAYS }).toISODate();
  const windowEnd = today.plus({ days: DEFAULT_WINDOW_FUTURE_DAYS }).toISODate();

  const recurringSessionsForSite = {
    ...(hasDateRange && (hasPatterns || hasOverrides)
      ? buildRecurringDefaults({ site_id, start, end, patterns })
      : {}),
    ...buildSeedRecurringDefaults(site_id, configuredClinics)
  };

  const hasClinicSeeds = Object.keys(recurringSessionsForSite).length > 0;

  const baseAvailability = hasClinicSeeds
    ? {}
    : (
      hasDateRange
        ? generateAvailability({ site_id, start, end, patterns, overrides })
        : {}
    );

  const effectiveAvailability = hasClinicSeeds
    ? filterAvailabilityByDateWindow(
      mergeDailyAvailability(baseAvailability, site_id, recurringSessionsForSite),
      windowStart,
      windowEnd
    )
    : baseAvailability;

  const slots = generateSlots(effectiveAvailability);
  const slotsForBookingGeneration = slots.filter((slot) => {
    const recurringSessionId = String(slot?.recurringSessionId || '').trim();
    if (!recurringSessionId) return true;

    return !Boolean(recurringSessionsForSite?.[recurringSessionId]?.excludeFromBookingGeneration);
  });

  const {
    overrides: bookingOverrides,
    manual: manualBookingOverrides,
    ...bookingGeneratorConfig
  } = bookingConfig || {};

  const generatedBookings = generateBookings({
    site_id,
    slots: slotsForBookingGeneration,
    ...bookingGeneratorConfig,
    names: catNames
  });

  const bookingData = applyBookingOverrides(
    generatedBookings,
    [...toArray(bookingOverrides), ...toArray(manualBookingOverrides)],
    site_id,
    slotsForBookingGeneration
  );

  daily_availability[site_id] = baseAvailability;
  bookings[site_id] = bookingData;
  sites[site_id] = site;
  recurring_sessions[site_id] = recurringSessionsForSite;

  applyDocumentationFixtures(recurring_sessions, site_id);

  users_by_site[site_id] = mergeWithDefaults(default_user, normalizeUserOverride(user));
}


module.exports = {
  ...base,
  default_user,
  users_by_site,
  sites,
  daily_availability,
  bookings,
  recurring_sessions,
  legacy_sessions_by_site
};
