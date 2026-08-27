function fallback(endpoint) {
  const requestFields = (endpoint.requestFields || []).map(field => ({
    name: field.name,
    description: `Value supplied in the ${field.location}.`,
    example: field.name.toLowerCase().includes('lang') ? 'en' : field.name.toLowerCase().includes('email') ? 'user@example.com' : `example ${field.name}`,
    confidence: 0.7,
  }));
  const response = Object.fromEntries((endpoint.responses?.find(item => item.status < 300)?.fields || []).map(field => [field, `example ${field}`]));
  const description = endpoint.path === '/api/translate'
    ? 'Translates input text from a source language into a requested target language using the Google Translate integration.'
    : endpoint.path === '/api/bedrock/generate-translate'
      ? 'Generates a response through AWS Bedrock in a target language, then translates the generated result back to English for comparison.'
      : endpoint.path === '/api/bedrock/generate'
        ? 'Generates text through AWS Bedrock using the requested language and model configuration.'
        : endpoint.path === '/api/bedrock/models'
          ? 'Lists on-demand foundation models available in the configured AWS region.'
          : endpoint.path === '/health'
            ? 'Reports whether the backend service is running.'
            : endpoint.path === '/api/example'
              ? 'Returns a small response used to verify that the API is reachable.'
              : endpoint.description;
  return {
    summary: description.split('.')[0],
    description,
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
  const readable = value => typeof value === 'string' ? value : JSON.stringify(value);
  result.warnings = Array.isArray(result.warnings) ? result.warnings.map(readable) : [];
  result.assumptions = Array.isArray(result.assumptions) ? result.assumptions.map(readable) : [];
  result.modelConfidence = Math.max(0, Math.min(1, Number(result.confidence || 0)));
  result.confidence = evidenceConfidence(endpoint, result);
  return result;
}

function evidenceConfidence(endpoint, enrichment) {
  let score = 0.2;
  const evidence = endpoint.sourceEvidence || '';
  if (evidence) score += 0.15;
  if ((endpoint.requestFields || []).length === 0 || enrichment.requestFields.length >= endpoint.requestFields.length) score += 0.2;
  if ((endpoint.responses || []).length > 0) score += 0.15;
  if ((endpoint.integrations || []).length > 0) score += 0.1;
  if (/if\s*\(|typeof\s|\.trim\(\)|status\((4|5)/.test(evidence)) score += 0.1;
  score -= (enrichment.assumptions || []).length * 0.05;
  score -= (enrichment.warnings || []).filter(warning => /assumption|unavailable|insufficient|invent/i.test(warning)).length * 0.05;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function promptFor(endpoint) {
  return `You are documenting one backend API endpoint for a developer portal. Use the route facts and source evidence below. Write endpoint-specific documentation, not generic text. Explain what the endpoint actually does, name the detected integration, and describe validation and errors only when evidence supports them. Never invent undocumented fields, authentication, or behavior. If evidence is insufficient, add a warning and an assumption. Return JSON only, with no Markdown fences.\n\nROUTE FACTS:\n${JSON.stringify(endpoint, null, 2)}\n\nREQUIRED JSON SHAPE:\n{"summary":"specific one-line summary","description":"2-4 sentence developer-facing description","requestFields":[{"name":"exact field name","description":"specific purpose","example":"realistic example","confidence":0.0}],"responseDescription":"specific response explanation","examples":{"request":{},"response":{}},"warnings":[],"assumptions":[],"confidence":0.0}`;
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI provider returned no JSON object.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function ollamaEnrich(endpoint) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, format: 'json', messages: [{ role: 'system', content: 'You produce accurate, concise API documentation grounded in source evidence.' }, { role: 'user', content: promptFor(endpoint) }] }),
    signal: AbortSignal.timeout(Number(process.env.DOCFORGE_AI_TIMEOUT_MS || 30000)),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}. Is the model installed?`);
  const payload = await response.json();
  return { ...validate(parseJson(payload.message?.content), endpoint), provider: 'ollama', model };
}

async function geminiEnrich(endpoint) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const baseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: 'You produce accurate, concise API documentation grounded in source evidence. Return valid JSON only.' }] }, contents: [{ role: 'user', parts: [{ text: promptFor(endpoint) }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
    signal: AbortSignal.timeout(Number(process.env.DOCFORGE_AI_TIMEOUT_MS || 30000)),
  });
  if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}. Check the API key and model.`);
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
  if (!text) throw new Error('Gemini returned an empty response.');
  return { ...validate(parseJson(text), endpoint), provider: 'gemini', model };
}

async function enrichEndpoints(endpoints) {
  const provider = process.env.DOCFORGE_AI_PROVIDER || 'ollama';
  const results = [];
  for (const endpoint of endpoints) {
    if (provider === 'local') {
      results.push({ endpointId: endpoint.id, enrichment: validate(fallback(endpoint), endpoint) });
      continue;
    }
    try {
      const enrichment = provider === 'gemini' ? await geminiEnrich(endpoint) : await ollamaEnrich(endpoint);
      results.push({ endpointId: endpoint.id, enrichment });
    } catch (error) {
      const local = validate(fallback(endpoint), endpoint);
      local.warnings.unshift(`${provider} unavailable: ${error.message}`);
      results.push({ endpointId: endpoint.id, enrichment: local });
    }
  }
  return results;
}

module.exports = { enrichEndpoints };
