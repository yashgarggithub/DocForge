const { mergeDocumentation, collectProductEvidence } = require('../documentation');
const { generateProviderText, parseJson } = require('./enrichment');

function cleanText(value, fallback = '') { return typeof value === 'string' ? value.trim().slice(0, 4000) : fallback; }
function cleanList(value, limit = 12) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return items.map(item => cleanText(item)).filter(Boolean).slice(0, limit);
}
function cleanArchitecture(value) { return Array.isArray(value) ? value.slice(0, 12).map(layer => ({ name: cleanText(layer?.name, 'Application layer'), technologies: cleanList(layer?.technologies, 12), responsibilities: cleanList(layer?.responsibilities, 12) })) : []; }

function normalizeDraftInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value.documentation || value.productDocumentation || value.product_documentation || value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  return {
    ...source,
    overview: source.overview ?? source.productOverview ?? source.product_overview,
    audience: source.audience ?? source.targetAudience ?? source.target_audience,
    useCases: source.useCases ?? source.use_cases ?? source.usecases,
    workflow: source.workflow ?? source.howItWorks ?? source.how_it_works,
    architecture: source.architecture ?? source.systemArchitecture ?? source.system_architecture,
    troubleshooting: source.troubleshooting ?? source.troubleshootingNotes ?? source.troubleshooting_notes,
  };
}

function validateDraft(value) {
  const source = normalizeDraftInput(value);
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Product documentation response must be a JSON object.');
  const draft = { overview: cleanText(source.overview), audience: cleanText(source.audience), useCases: cleanList(source.useCases), workflow: cleanList(source.workflow), architecture: cleanArchitecture(source.architecture), troubleshooting: Array.isArray(source.troubleshooting) ? source.troubleshooting.slice(0, 12).map(item => ({ title: cleanText(item?.title, 'Troubleshooting note'), guidance: cleanText(item?.guidance) })).filter(item => item.guidance) : [], warnings: cleanList(source.warnings), confidence: Math.max(0, Math.min(1, Number(source.confidence || 0))) };
  const missing = [];
  if (!draft.overview) missing.push('overview');
  if (!draft.audience) missing.push('audience');
  if (!draft.useCases.length) missing.push('useCases');
  if (!draft.workflow.length) missing.push('workflow');
  if (missing.length) throw new Error(`Product documentation response is missing required sections: ${missing.join(', ')}.`);
  return draft;
}

function contextFor(analysis) {
  return {
    project: { name: analysis.project?.name, repositoryUrl: analysis.project?.repositoryUrl || null },
    stack: analysis.stack || [], frameworks: analysis.frameworks || [],
    readme: { title: analysis.readme?.title || null, overview: (analysis.readme?.overview || '').slice(0, 2400), sections: Object.fromEntries(Object.entries(analysis.readme?.sections || {}).slice(0, 8).map(([key, value]) => [key, String(value).slice(0, 1800)])) },
    routes: (analysis.routes || []).slice(0, 80).map(route => ({ method: route.method, path: route.path, sourceFile: route.sourceFile, sourceLine: route.sourceLine, requestFields: route.requestFields, responses: route.responses, integrations: route.integrations, sourceEvidence: String(route.sourceEvidence || '').slice(0, 1200) })),
    frontendCalls: (analysis.frontendCalls || []).slice(0, 80), dependencies: (analysis.dependencies || []).slice(0, 120).map(item => ({ name: item.name, version: item.version })), environmentVariables: analysis.environmentVariables || [], architecture: analysis.architecture || { layers: [] }, warnings: analysis.warnings || [],
  };
}

function promptFor(analysis) {
  return `Create a developer-facing product documentation draft from the evidence below. Explain what the product is, who uses it, its real use cases, request-to-response workflow, architecture, and troubleshooting. Use only supplied evidence. Do not invent commands, authentication, business rules, or components. If evidence is incomplete, add a warning. Return JSON only with exactly these keys: overview, audience, useCases, workflow, architecture, troubleshooting, warnings, confidence. Never include absolute filesystem paths, temporary clone names, secrets, environment values, or Markdown fences.\n\nEVIDENCE:\n${JSON.stringify(contextFor(analysis), null, 2)}`;
}

function deterministicDraft(analysis) {
  const docs = mergeDocumentation(analysis, {}).documentation;
  return validateDraft({ overview: docs.overview, audience: analysis.product?.audience || 'Developers and maintainers.', useCases: docs.useCases, workflow: docs.workflow, architecture: docs.architecture, troubleshooting: docs.troubleshooting, warnings: analysis.warnings || [], confidence: 0.65 });
}

async function generateProductDraft(analysis, { provider = 'ollama', model } = {}) {
  if (provider === 'local') return { draft: deterministicDraft(analysis), provider: 'local', model: null, evidence: collectProductEvidence(analysis) };
  const result = await generateProviderText(provider, model, promptFor(analysis));
  const draft = validateDraft(parseJson(result.text));
  const evidence = collectProductEvidence({ ...analysis, documentation: draft });
  for (const section of Object.values(evidence)) for (const item of section || []) { item.origin = 'ai-draft'; item.provider = result.provider; item.model = result.model; }
  return { draft, provider: result.provider, model: result.model, evidence };
}

module.exports = { generateProductDraft, validateDraft, contextFor };
