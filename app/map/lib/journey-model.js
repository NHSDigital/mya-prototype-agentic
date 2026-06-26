// -----------------------------------------------------------------------------
// /map view-model builder
// -----------------------------------------------------------------------------
// Turns the lean map.json manifests (+ insights.md / implementation.md) into the
// exact model shape the ported map-site-template templates and map.js consume:
//   - overview: { sections: [{ id, title, journeys: [{ title, summary, path }] }] }
//   - journey:  { title, version, versions, steps[], journeyFindings } (+ board fields)
//   - step:     { ...step fields, variants[], variantIndexJson, defaultVariant }
//
// Insights/implementation are JOURNEY-LEVEL markdown (rendered into .map-rich-text),
// so they are constant across a step's variants; only the screenshot varies per
// variant. Screenshot file ids match the capture script (primary shot = variant.id).
// -----------------------------------------------------------------------------

const { loadManifests, sanitizeForFileName } = require('./manifest');
const { getDocHtml, hasDoc } = require('./markdown');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function journeyPath(version, journey) {
  return `/map/${version}/${journey}`;
}

function buildRouteLinkWithData(path, data) {
  if (!path) return '';
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return path;
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${path}?_data=${encoded}`;
}
function stepPath(version, journey, stepId) {
  return `/map/${version}/${journey}/${stepId}`;
}
function screenshotUrl(journey, version, stepId, fileId) {
  return `/map-screenshots/${journey}/${version}/${stepId}/${fileId}.png`;
}

// Exact markup of the stepVariantScreenshot macro, for client-side switching.
function figureHtml(variant) {
  const src = escapeHtml(variant.screenshotPath);
  const alt = escapeHtml(variant.alt);
  const caption = variant.caption
    ? `\n    <figcaption>${escapeHtml(variant.caption)}</figcaption>`
    : '';
  return (
    `<figure class="map-step-display-screen">\n` +
    `    <a href="${src}" target="_blank" rel="noopener noreferrer" aria-label="Open screenshot in a new tab">\n` +
    `      <img src="${src}" alt="${alt}" loading="lazy">\n` +
    `    </a>${caption}\n` +
    `  </figure>`
  );
}

function richText(html) {
  return html ? `<div class="map-rich-text">${html}</div>` : '';
}

// Index every manifest and group versions per journey id.
function loadIndex() {
  const { models, warnings } = loadManifests();
  const byJourney = new Map();
  for (const model of models) {
    if (!byJourney.has(model.journey)) byJourney.set(model.journey, []);
    byJourney.get(model.journey).push(model);
  }
  return { models, warnings, byJourney };
}

function findModel(version, journeyId) {
  const { models } = loadIndex();
  return models.find((m) => m.version === version && m.journey === journeyId) || null;
}

// versions list for a journey id (sorted), as the templates expect.
function versionsForJourney(journeyId) {
  const { byJourney } = loadIndex();
  const list = byJourney.get(journeyId) || [];
  return list
    .map((m) => m.version)
    .sort()
    .map((v) => ({ id: v, label: v, tag: '', path: journeyPath(v, journeyId) }));
}

// ---- Overview ---------------------------------------------------------------
function buildOverviewModel() {
  const { models } = loadIndex();
  const sectionsMap = new Map();
  // newest-first so the default version of each journey is listed once per section
  const seen = new Set();
  for (const model of models.sort((a, b) => b.version.localeCompare(a.version))) {
    if (seen.has(model.journey)) continue; // one card per journey (latest version)
    seen.add(model.journey);
    const sectionTitle = model.section || 'Journeys';
    const sectionId = sanitizeForFileName(sectionTitle);
    if (!sectionsMap.has(sectionId)) {
      sectionsMap.set(sectionId, { id: sectionId, title: sectionTitle, journeys: [] });
    }
    sectionsMap.get(sectionId).journeys.push({
      title: model.title,
      summary: model.summary,
      path: journeyPath(model.version, model.journey),
    });
  }
  const sections = [...sectionsMap.values()].sort((a, b) => a.title.localeCompare(b.title));
  for (const s of sections) s.journeys.sort((a, b) => a.title.localeCompare(b.title));
  return { sections };
}

// ---- Per-variant data for a step -------------------------------------------
function buildVariants(model, step, insightsHtml, implementationHtml) {
  const detailInsightsHtml = richText(insightsHtml);
  const detailImplementationHtml = richText(implementationHtml);

  const variants = step.variants.map((v) => {
    const fileId = sanitizeForFileName(v.id);
    const screenshotPath = screenshotUrl(model.journey, model.version, step.id, fileId);
    const alt = v.alt || `Screenshot of ${step.title} — ${v.label}`;
    const screenshot = v.screenshots[0];
    const routeLink = screenshot
      ? buildRouteLinkWithData(screenshot.path, screenshot.data)
      : '';
    return {
      id: v.id,
      label: v.label,
      isDefaultVariant: v.id === step.defaultVariantId,
      screenshotPath,
      alt,
      caption: v.caption || '',
      routeLink,
    };
  });

  // The client-side switch index (map.js contract).
  const variantIndex = {};
  for (const v of variants) {
    variantIndex[v.id] = {
      screenshotPath: v.screenshotPath,
      alt: v.alt,
      insightsHtml: '',
      nextStepsHtml: '',
      notesHtml: '',
      routeLink: v.routeLink,
      detailScreenshotHtml: figureHtml(v),
      detailInsightsHtml,
      detailImplementationHtml,
    };
  }

  const defaultVariant = variants.find((v) => v.isDefaultVariant) || variants[0];
  // Board insight rows are journey-level markdown elsewhere; keep arrays empty.
  defaultVariant.insights = [];
  defaultVariant.nextSteps = [];

  return { variants, variantIndex, defaultVariant };
}

// ---- Journey (board) --------------------------------------------------------
function buildJourneyModel(version, journeyId) {
  const model = findModel(version, journeyId);
  if (!model) return null;

  const insightsHtml = getDocHtml(model.dir, 'insights.md');
  const implementationHtml = getDocHtml(model.dir, 'implementation.md');
  const versions = versionsForJourney(journeyId);

  const steps = model.steps.map((step, i) => {
    const { variants, variantIndex, defaultVariant } = buildVariants(
      model,
      step,
      insightsHtml,
      implementationHtml
    );
    return {
      slug: step.id,
      title: step.title,
      position: i + 1,
      detailPath: stepPath(version, journeyId, step.id),
      screenVersionId: version,
      isReusedFromEarlierVersion: false,
      defaultVariantId: step.defaultVariantId,
      variants,
      variantIndexJson: JSON.stringify(variantIndex),
      defaultVariant,
    };
  });

  return {
    title: model.title,
    version: { id: version, status: model.status || '', tag: '' },
    versions,
    steps,
    journeyFindings: { nextSteps: [] },
  };
}

// ---- Step detail ------------------------------------------------------------
function buildStepModel(version, journeyId, stepId) {
  const model = findModel(version, journeyId);
  if (!model) return null;
  const index = model.steps.findIndex((s) => s.id === stepId);
  if (index === -1) return null;
  const rawStep = model.steps[index];

  const insightsHtml = getDocHtml(model.dir, 'insights.md', stepId);
  const implementationHtml = getDocHtml(model.dir, 'implementation.md', stepId);
  const { variants, variantIndex, defaultVariant } = buildVariants(
    model,
    rawStep,
    insightsHtml,
    implementationHtml
  );

  const versionOptions = versionsForJourney(journeyId).map((v) => ({
    id: v.id,
    label: v.label,
    path: stepPath(v.id, journeyId, stepId),
  }));

  const stepify = (s, i) =>
    s && {
      position: i + 1,
      title: s.title,
      detailPath: stepPath(version, journeyId, s.id),
    };

  const step = {
    slug: rawStep.id,
    title: rawStep.title,
    position: index + 1,
    status: rawStep.status || model.status || '',
    defaultVariantId: rawStep.defaultVariantId,
    variants,
    variantIndexJson: JSON.stringify(variantIndex),
    defaultVariant,
    versionOptions,
    focusQuestions: [],
    linkedInsights: [],
    linkedNextSteps: [],
    insightsHtml: richText(insightsHtml),
    implementationHtml: richText(implementationHtml),
    hasImplementation: hasDoc(model.dir, 'implementation.md'),
    previousStep: index > 0 ? stepify(model.steps[index - 1], index - 1) : null,
    nextStep: index < model.steps.length - 1 ? stepify(model.steps[index + 1], index + 1) : null,
  };

  const journey = {
    title: model.title,
    version: { id: version, status: model.status || '', tag: '' },
  };

  return { journey, step };
}

module.exports = {
  loadIndex,
  findModel,
  buildOverviewModel,
  buildJourneyModel,
  buildStepModel,
  journeyPath,
  stepPath,
};
