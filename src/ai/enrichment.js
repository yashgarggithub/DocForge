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

function promptFor(endpoint) {
  return `You enrich API documentation. Use only the supplied source-grounded facts. Never invent undocumented fields or behavior. Return JSON only. Mark uncertainty in warnings.\n\nFACTS:\n${JSON.stringify(endpoint, null, 2)}\n\nReturn this shape: {"summary":string,"description":string,"requestFields":[{"name":string,"description":string,"example":string,"confidence":number}],"responseDescription":string,"examples":{"request":object,"response":object},"warnings":string[],"assumptions":string[],"confidence":number}`;
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Ollama returned no JSON object.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function ollamaEnrich(endpoint) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, format: 'json', messages: [{ role: 'user', content: promptFor(endpoint) }] }),
    signal: AbortSignal.timeout(Number(process.env.DOCFORGE_AI_TIMEOUT_MS || 30000)),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}. Is the model installed?`);
  const payload = await response.json();
  return { ...validate(parseJson(payload.message?.content), endpoint), provider: 'ollama', model };
}

async function enrichEndpoints(endpoints) {
  const provider = process.env.DOCFORGE_AI_PROVIDER || 'ollama';
  const results = [];
  for (const endpoint of endpoints) {
    if (provider !== 'ollama') {
      results.push({ endpointId: endpoint.id, enrichment: validate(fallback(endpoint), endpoint) });
      continue;
    }
    try {
      results.push({ endpointId: endpoint.id, enrichment: await ollamaEnrich(endpoint) });
    } catch (error) {
      const local = validate(fallback(endpoint), endpoint);
      local.warnings.unshift(`Ollama unavailable: ${error.message}`);
      results.push({ endpointId: endpoint.id, enrichment: local });
    }
  }
  return results;
}

module.exports = { enrichEndpoints };
