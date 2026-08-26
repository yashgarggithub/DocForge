function fallback(endpoint) {
  const requestFields = (endpoint.requestFields || []).map(field => ({
    name: field.name,
    description: `Value supplied in the ${field.location}.`,
    example: field.name.toLowerCase().includes('lang') ? 'en' : field.name.toLowerCase().includes('email') ? 'user@example.com' : `example ${field.name}`,
    confidence: 0.7,
  }));
  const response = Object.fromEntries((endpoint.responses?.find(item => item.status < 300)?.fields || []).map(field => [field, `example ${field}`]));
  return {
    summary: endpoint.method + ' ' + endpoint.path,
    description: endpoint.description,
    requestFields,
    responseDescription: 'Returns a JSON response described by the implementation.',
    examples: { request: Object.fromEntries(requestFields.map(field => [field.name, field.example])), response },
    warnings: ['Local deterministic enrichment is active. Review this description before publishing.'],
    assumptions: [],
    confidence: 0.55,
    provider: 'deterministic-local',
  };
}

function validate(result, endpoint) {
  if (!result || typeof result.summary !== 'string' || typeof result.description !== 'string' || !Array.isArray(result.requestFields) || !result.examples) throw new Error('Enrichment did not match the required schema.');
  const allowed = new Set((endpoint.requestFields || []).map(field => field.name));
  result.requestFields = result.requestFields.filter(field => allowed.has(field.name)).map(field => ({ name: field.name, description: String(field.description || ''), example: field.example, confidence: Math.max(0, Math.min(1, Number(field.confidence || 0))) }));
  result.warnings = Array.isArray(result.warnings) ? result.warnings.map(String) : [];
  result.assumptions = Array.isArray(result.assumptions) ? result.assumptions.map(String) : [];
  result.confidence = Math.max(0, Math.min(1, Number(result.confidence || 0)));
  return result;
}

async function enrichEndpoints(endpoints) {
  return endpoints.map(endpoint => ({ endpointId: endpoint.id, enrichment: validate(fallback(endpoint), endpoint) }));
}

module.exports = { enrichEndpoints };
