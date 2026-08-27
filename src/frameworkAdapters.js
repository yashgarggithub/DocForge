const path = require('node:path');

function lineNumber(source, index) { return source.slice(0, index).split('\n').length; }
function fieldsFromNames(names, location = 'body') { return [...new Set(names.filter(Boolean))].map(name => ({ name, location, required: true, type: 'string', description: `${name} supplied in the ${location}.` })); }
function responseFields(text) { return [...text.matchAll(/(?:jsonify\s*\(|\.json\s*\()[\s\S]*?\{([^{}]*)\}/g)].flatMap(match => [...match[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map(item => item[1])); }
function route(id, method, routePath, sourceFile, source, start, requestFields = [], responses = [], framework, language, evidence = '') {
  return { id: `${framework}-${method.toLowerCase()}-${routePath.replace(/[^a-zA-Z0-9]+/g, '-')}`.replace(/-$/, ''), method, path: routePath || '/', sourceFile, sourceLine: lineNumber(source, start), framework, language, requestFields, responses: responses.length ? responses : [{ status: 200, fields: [] }], integrations: [], sourceEvidence: evidence || source.slice(start, Math.min(source.length, start + 900)).replace(/\s+/g, ' ').trim(), summary: `${method} ${routePath}`, description: 'Description inferred from the route implementation.', warnings: [], confidence: 0.65 };
}

function expressRoutes(source, relativePath) {
  const routes = [];
  for (const match of source.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*,/gi)) {
    const handler = source.slice(match.index, source.indexOf('\n});', match.index) < 0 ? match.index + 1500 : source.indexOf('\n});', match.index));
    const body = [...handler.matchAll(/req\.(body|query|params)\.([A-Za-z_$][\w$]*)|const\s*\{([^}]+)\}\s*=\s*req\.(body|query|params)/g)].flatMap(item => item[2] ? [{ name: item[2], location: item[1], required: false, type: 'string', description: `${item[2]} supplied in the ${item[1]}.` }] : item[3].split(',').map(raw => ({ name: raw.trim().split(/\s|=/)[0], location: item[4], required: !raw.includes('='), type: 'string', description: `${raw.trim().split(/\s|=/)[0]} supplied in the ${item[4]}.` })));
    const responses = [...handler.matchAll(/res\.status\((\d{3})\)\.json\(\s*\{([\s\S]*?)\}\s*\)/g)].map(item => ({ status: Number(item[1]), fields: [...item[2].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map(value => value[1]) }));
    routes.push(route('', match[1].toUpperCase(), match[2], relativePath, source, match.index, body, responses, 'express', 'javascript', handler));
  }
  return routes;
}

function fastifyRoutes(source, relativePath) {
  const routes = [];
  for (const match of source.matchAll(/(?:fastify|server|app)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gi)) routes.push(route('', match[1].toUpperCase(), match[2], relativePath, source, match.index, fieldsFromNames([...match[2].matchAll(/:([A-Za-z_$][\w]*)/g)].map(item => item[1]), 'params'), [], 'fastify', 'javascript', source.slice(match.index, match.index + 700)));
  for (const match of source.matchAll(/\.route\(\s*\{([\s\S]*?)\}\s*\)/g)) { const block = match[1]; const method = (block.match(/method\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i) || [])[1]; const routePath = (block.match(/(?:url|path)\s*:\s*['"]([^'"]+)['"]/i) || [])[1]; if (method && routePath) routes.push(route('', method.toUpperCase(), routePath, relativePath, source, match.index, fieldsFromNames([...block.matchAll(/schema\s*:\s*\{[\s\S]*?\}/g)].flatMap(item => [...item[0].matchAll(/([A-Za-z_$][\w]*)\s*:/g)].map(value => value[1]))), [], 'fastify', 'javascript', block)); }
  return routes;
}

function nestRoutes(source, relativePath) {
  const prefix = (source.match(/@Controller\(\s*['"]([^'"]*)['"]\s*\)/) || [])[1] || '';
  const routes = [];
  for (const match of source.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*['"]?([^'")]*)['"]?\s*\)/g)) {
    const method = match[1].toUpperCase(); const routePath = `${prefix}/${match[2]}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    const next = source.slice(match.index, source.indexOf('\n  }', match.index) < 0 ? match.index + 1200 : source.indexOf('\n  }', match.index));
    const requestFields = [...next.matchAll(/@(Body|Param|Query)\(\s*['"]?([A-Za-z_$][\w]*)?['"]?\s*\)\s+\w+\s*:\s*([A-Za-z_$][\w\[\]]*)/g)].map(item => ({ name: item[2] || 'body', location: item[1].toLowerCase(), required: true, type: item[3] || 'string', description: `${item[2] || 'body'} supplied in the ${item[1].toLowerCase()}.` }));
    routes.push(route('', method, routePath, relativePath, source, match.index, requestFields, [], 'nestjs', 'typescript', next));
  }
  return routes;
}

function fastApiRoutes(source, relativePath) {
  const routes = [];
  for (const match of source.matchAll(/@(\w+)\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']([\s\S]*?)\)\s*\n\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gi)) {
    const method = match[2].toUpperCase(); const routePath = match[3]; const params = match[6];
    const requestFields = params.split(',').map(raw => raw.trim()).filter(Boolean).map(raw => { const name = raw.split(/\s|:/)[0]; const location = /Path\s*\(/.test(raw) || routePath.includes(`{${name}}`) ? 'path' : /Query\s*\(/.test(raw) ? 'query' : /Body\s*\(/.test(raw) || /BaseModel/.test(raw) ? 'body' : 'query'; return { name, location, required: !/Optional|=/.test(raw), type: (raw.match(/:\s*([A-Za-z_][\w\[\]]*)/) || [])[1] || 'string', description: `${name} supplied in the ${location}.` }; });
    const status = Number((match[4].match(/status_code\s*=\s*(\d{3})/) || [])[1] || 200); routes.push(route('', method, routePath, relativePath, source, match.index, requestFields, [{ status, fields: [] }], 'fastapi', 'python', match[0]));
  }
  return routes;
}

function flaskRoutes(source, relativePath) {
  const routes = [];
  for (const match of source.matchAll(/@(?:\w+\.)?route\(\s*["']([^"']+)["']([\s\S]*?)\)\s*\n\s*def\s+(\w+)\s*\(([^)]*)\)/gi)) {
    const routePath = match[1]; const methods = (match[2].match(/methods\s*=\s*\[([^\]]+)\]/i) || [])[1]; const verbs = methods ? [...methods.matchAll(/["'](GET|POST|PUT|PATCH|DELETE)["']/gi)].map(item => item[1]) : ['GET'];
    const pathFields = [...routePath.matchAll(/<(?:(\w+):)?(\w+)>/g)].map(item => item[2]); const requestFields = [...fieldsFromNames(pathFields, 'params'), ...(/request\.(args|form|get_json)/.test(source.slice(match.index, match.index + 1200)) ? [{ name: 'request', location: 'body', required: false, type: 'object', description: 'Request payload supplied by the client.' }] : [])];
    for (const method of verbs) routes.push(route('', method, routePath.replace(/<(?:(\w+):)?(\w+)>/g, '{$2}'), relativePath, source, match.index, requestFields, [{ status: 200, fields: responseFields(source.slice(match.index, match.index + 1200)) }], 'flask', 'python', source.slice(match.index, match.index + 1000)));
  }
  return routes;
}

const adapters = [
  { id: 'express', displayName: 'Express', language: 'javascript', sourceExtensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'], detect: source => /\b(?:app|router)\.(?:get|post|put|patch|delete)\(/.test(source), extractRoutes: expressRoutes },
  { id: 'nestjs', displayName: 'NestJS', language: 'typescript', sourceExtensions: ['.ts', '.tsx'], detect: source => /@Controller\s*\(|@(?:Get|Post|Put|Patch|Delete)\s*\(/.test(source), extractRoutes: nestRoutes },
  { id: 'fastify', displayName: 'Fastify', language: 'javascript', sourceExtensions: ['.js', '.ts', '.mjs', '.cjs'], detect: source => /(?:fastify\s*\(|fastify\.(?:get|post|put|patch|delete)\s*\(|\.route\s*\(\s*\{)/.test(source), extractRoutes: fastifyRoutes },
  { id: 'fastapi', displayName: 'FastAPI', language: 'python', sourceExtensions: ['.py'], detect: source => /from\s+fastapi\s+import|import\s+fastapi|@\w+\.(?:get|post|put|patch|delete)\(/.test(source), extractRoutes: fastApiRoutes },
  { id: 'flask', displayName: 'Flask', language: 'python', sourceExtensions: ['.py'], detect: source => /from\s+flask\s+import|import\s+flask|@(?:\w+\.)?route\(/.test(source), extractRoutes: flaskRoutes },
];

module.exports = { adapters };
