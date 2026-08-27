function cleanList(value) { return Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : []; }

function mergeDocumentation(analysis, edits = {}) {
  const product = analysis.product || {};
  const merged = {
    overview: typeof edits.overview === 'string' && edits.overview.trim() ? edits.overview.trim() : (product.overview || analysis.readme?.overview || `Documentation for ${analysis.project.name}.`),
    useCases: cleanList(edits.useCases).length ? cleanList(edits.useCases) : cleanList(product.useCases),
    workflow: cleanList(edits.workflow).length ? cleanList(edits.workflow) : cleanList(product.workflow),
    architecture: Array.isArray(edits.architecture) && edits.architecture.length ? edits.architecture : (analysis.architecture?.layers || []),
    troubleshooting: Array.isArray(edits.troubleshooting) ? edits.troubleshooting : (analysis.warnings || []).map(warning => ({ title: 'Analysis warning', guidance: warning }))
  };
  return { ...analysis, documentation: merged, documentationEdits: edits };
}

function evidenceItem(id, text, origin, confidence, evidence = []) {
  return { id, text, origin, confidence: Math.max(0, Math.min(1, confidence || 0)), evidence: evidence.filter(Boolean) };
}

function collectRouteEvidence(analysis) {
  return (analysis.routes || []).flatMap(route => {
    const evidence = route.sourceEvidence ? [{ sourceFile: route.sourceFile, sourceLine: route.sourceLine, snippet: route.sourceEvidence }] : [];
    const origin = route.description === 'Description inferred from the route implementation.' ? 'inferred' : 'source';
    return [
      evidenceItem(`${route.id}:summary`, route.summary, origin, route.confidence, evidence),
      evidenceItem(`${route.id}:description`, route.description, origin, route.confidence, evidence),
      ...(route.requestFields || []).map(field => evidenceItem(`${route.id}:request:${field.name}`, `${field.name} supplied in the ${field.location}.`, origin, route.confidence, evidence)),
      ...(route.responses || []).flatMap(response => response.fields.map(field => evidenceItem(`${route.id}:response:${response.status}:${field}`, `${field} returned in the ${response.status} response.`, origin, route.confidence, evidence)))
    ];
  });
}

function collectProductEvidence(analysis) {
  const product = analysis.product || {};
  const readmeEvidence = analysis.readme?.overview ? [{ sourceFile: 'README.md', sourceLine: 1, snippet: analysis.readme.overview }] : [];
  const routeEvidence = (analysis.routes || []).map(route => ({ sourceFile: route.sourceFile, sourceLine: route.sourceLine, snippet: route.sourceEvidence })).filter(item => item.snippet);
  const frontendEvidence = (analysis.frontendCalls || []).map(call => ({ sourceFile: call.sourceFile, sourceLine: call.sourceLine, snippet: `${call.method} ${call.path}` }));
  const productEdits = analysis.documentationEdits || {};
  const edited = key => Array.isArray(productEdits[key]) ? 'edited' : (typeof productEdits[key] === 'string' ? 'edited' : 'inferred');
  return {
    overview: evidenceItem('product:overview', analysis.documentation?.overview || product.overview, edited('overview'), product.overview ? 0.85 : 0.45, readmeEvidence),
    useCases: (analysis.documentation?.useCases || product.useCases || []).map((text, index) => evidenceItem(`product:use-case:${index}`, text, edited('useCases'), 0.75, routeEvidence)),
    workflow: (analysis.documentation?.workflow || product.workflow || []).map((text, index) => evidenceItem(`product:workflow:${index}`, text, edited('workflow'), 0.72, [...routeEvidence, ...frontendEvidence])),
    architecture: (analysis.documentation?.architecture || analysis.architecture?.layers || []).flatMap((layer, index) => [evidenceItem(`product:architecture:${index}`, layer.name, edited('architecture'), 0.78, routeEvidence), ...layer.responsibilities.map((text, responsibilityIndex) => evidenceItem(`product:architecture:${index}:${responsibilityIndex}`, text, edited('architecture'), 0.7, routeEvidence))]),
    troubleshooting: (analysis.documentation?.troubleshooting || []).map((item, index) => evidenceItem(`product:troubleshooting:${index}`, `${item.title}: ${item.guidance}`, edited('troubleshooting'), 0.65, analysis.warnings.map(warning => ({ sourceFile: 'analysis', sourceLine: null, snippet: warning }))))
  };
}

module.exports = { mergeDocumentation, collectProductEvidence, collectRouteEvidence };
