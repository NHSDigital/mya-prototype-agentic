const DOCUMENTATION_SITE_ID = '1';

const fixtureSeriesId = 'fixture-series-1';
const fixtureSingleId = 'fixture-single-1';

const occurrenceCancelFixture = {
  date: '2026-02-05',
  sessionId: '0641ee41151834bb',
  source: `${fixtureSeriesId}-2026-02-05-09:00-13:00`
};

const recurringSessions = {
  [fixtureSeriesId]: {
    id: fixtureSeriesId,
    label: 'Documentation fixture clinic series',
    startDate: '2026-02-02',
    endDate: '2026-12-21',
    recurrencePattern: { frequency: 'Weekly', interval: 1, byDay: ['Monday', 'Thursday'] },
    from: '09:00',
    until: '13:00',
    slotLength: 10,
    services: ['COVID:18+', 'FLU:65+'],
    capacity: 2,
    childSessions: [],
    closures: []
  },
  [fixtureSingleId]: {
    id: fixtureSingleId,
    label: 'Documentation fixture single clinic',
    type: 'Single clinic',
    startDate: '2026-10-01',
    endDate: '2026-10-01',
    from: '09:00',
    until: '13:00',
    slotLength: 10,
    services: ['COVID:18+', 'FLU:65+'],
    capacity: 2,
    childSessions: [],
    closures: []
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyDocumentationFixtures(recurringSessionsBySite, siteId) {
  if (String(siteId) !== DOCUMENTATION_SITE_ID) return;

  recurringSessionsBySite[siteId] = recurringSessionsBySite[siteId] || {};

  for (const [id, session] of Object.entries(recurringSessions)) {
    recurringSessionsBySite[siteId][id] = clone(session);
  }
}

module.exports = {
  DOCUMENTATION_SITE_ID,
  fixtureSeriesId,
  fixtureSingleId,
  occurrenceCancelFixture,
  recurringSessions,
  applyDocumentationFixtures
};
