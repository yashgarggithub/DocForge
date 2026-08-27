const { mergeDocumentation, collectProductEvidence } = require('../documentation');
const { generateProviderText, parseJson } = require('./enrichment');

function cleanText(value, fallback = '') { return typeof value === 'string' ? value.trim().slice(0, 4000) : fallback; }
function cleanList(value, limit = 12) { return Array.isArray(value) ? value.map(item => cleanText(item)).filter(Boolean).slice(0, limit) : []; }
function cleanArchitecture(value) { return Array.isArray(value) ? value.slice(0, 12).map(layer => ({ name: cleanText(layer?.name, 'Application layer'), technologies: cleanList(layer?.technologies, 12), responsibilities: cleanList(layer?.responsibilities, 12) })) : []; }

function validateDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Product documentation response must be a JSON object.');
  const draft = { overview: cleanText(value.overview), audience: cleanText(value.audience), useCases: cleanList(value.useCases), workflow: cleanList(value.workflow), architecture: cleanArchitecture(value.architecture), troubleshooting: Array.isArray(value.troubleshooting) ? value.troubleshooting.slice(0, 12).map(item => ({ title: cleanText(item?.title, 'Troubleshooting note'), guidance: cleanText(item?.guidance) })).filter(item => item.guidance) : [], warnings: cleanList(value.warnings), confidence: Math.max(0, Math.min(1, Number(value.confidence || 0))) };
  if (!draft.overview || !draft.audience || !draft.useCases.length || !draft.workflow.length) throw new Error('Product documentation response is missing required sections.');
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
