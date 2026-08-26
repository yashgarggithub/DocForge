const fs = require('node:fs/promises');
const path = require('node:path');

const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

async function walk(root, current = root, result = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED.has(entry.name) || entry.name.startsWith('.env')) continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) await walk(root, fullPath, result);
    else result.push(fullPath);
  }
  return result;
}

function lineNumber(source, index) { return source.slice(0, index).split('\n').length; }

function readObjectKeys(text) {
  return [...text.matchAll(/(^|[,\n])\s*([A-Za-z_$][\w$]*)\s*:/g)].map(m => m[2]);
}

function inferFields(handler) {
  const fields = [];
  const patterns = [
    { source: 'body', regex: /const\s*\{([^}]+)\}\s*=\s*req\.body/g },
    { source: 'query', regex: /const\s*\{([^}]+)\}\s*=\s*req\.query/g },
    { source: 'params', regex: /const\s*\{([^}]+)\}\s*=\s*req\.params/g },
  ];
  for (const { source, regex } of patterns) {
    for (const match of handler.matchAll(regex)) {
      for (const raw of match[1].split(',')) {
        const name = raw.trim().split(/\s|=/)[0];
        if (name) fields.push({ name, location: source, required: !raw.includes('=') });
      }
    }
  }
  const checks = [...handler.matchAll(/!([A-Za-z_$][\w$]*)|!([A-Za-z_$][\w$]*)\.trim\(\)/g)];
  for (const check of checks) {
    const name = check[1] || check[2];
    const field = fields.find(item => item.name === name);
    if (field) field.required = true;
  }
  return fields;
}

function inferResponses(handler) {
  const responses = [];
  for (const match of handler.matchAll(/res\.status\((\d{3})\)\.json\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    responses.push({ status: Number(match[1]), fields: readObjectKeys(match[2]) });
  }
  if (/res\.json\(/.test(handler) && !responses.some(r => r.status === 200)) responses.push({ status: 200, fields: [] });
  for (const match of handler.matchAll(/res\.status\((\d{3})\)/g)) {
    const status = Number(match[1]);
    if (!responses.some(r => r.status === status)) responses.push({ status, fields: [] });
  }
  return responses.sort((a, b) => a.status - b.status);
}

function extractEvidence(handler) {
  const useful = handler.split('\n').map(line => line.trim()).filter(line => line && (
    /req\.(body|query|params)/.test(line) ||
    /res\.(status|json)/.test(line) ||
    /\.trim\(\)|typeof\s+\w+|!\w+|default|translate\(|bedrockGenerateText|ListFoundationModels/.test(line)
  ));
  return useful.join(' ').replace(/\s+/g, ' ').slice(0, 1800);
}

function parseExpressRoutes(source, relativePath) {
  const routes = [];
  const regex = /\bapp\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*,/g;
  for (const match of source.matchAll(regex)) {
    const start = match.index;
    const close = source.indexOf('\n});', start + 1);
    const handler = source.slice(start, close < 0 ? source.length : close);
    const method = match[1].toUpperCase();
    const endpoint = {
      id: `${method.toLowerCase()}-${match[2].replace(/[^a-zA-Z0-9]+/g, '-')}`.replace(/-$/, ''),
      method,
      path: match[2],
      sourceFile: relativePath,
      sourceLine: lineNumber(source, start),
      requestFields: inferFields(handler),
      responses: inferResponses(handler),
      integrations: [],
      sourceEvidence: extractEvidence(handler),
      summary: `${method} ${match[2]}`,
      description: 'Description inferred from the route implementation.',
      warnings: [],
      confidence: 0.65,
    };
    if (/Bedrock|BedrockRuntime|ConverseCommand|InvokeModelCommand/.test(handler)) endpoint.integrations.push('AWS Bedrock');
    if (/translate\(/.test(handler)) endpoint.integrations.push('Google Translate');
    if (endpoint.requestFields.length === 0 && method !== 'GET') endpoint.warnings.push('Request schema could not be inferred from this handler.');
    if (endpoint.responses.length === 0) endpoint.warnings.push('No JSON response shape was detected.');
    routes.push(endpoint);
  }
  return routes;
}

function traceFrontendCalls(source, relativePath) {
  const calls = [];
  const regex = /fetch\(\s*`?\$\{[^}]+\}(\/api\/[^`'"?\s)]+)|fetch\(\s*['"]([^'"]+\/api\/[^'"]+)/g;
  for (const match of source.matchAll(regex)) {
    const endpointPath = match[1] || match[2];
    const window = source.slice(Math.max(0, match.index - 120), Math.min(source.length, match.index + 500));
    const method = (window.match(/method:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i) || [])[1] || 'GET';
    calls.push({ method, path: endpointPath, sourceFile: relativePath, sourceLine: lineNumber(source, match.index) });
  }
  return calls;
}

function dependenciesFromPackage(pkg, relativePath) {
  return Object.entries({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).map(([name, version]) => ({ name, version, sourceFile: relativePath }));
}

function parseReadme(content) {
  const title = (content.match(/^#\s+(.+)$/m) || [])[1] || null;
  const sections = {};
  const headings = [...content.matchAll(/^##\s+(.+)$/gm)];
  for (let index = 0; index < headings.length; index += 1) {
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? content.length;
    sections[headings[index][1].trim()] = content.slice(start, end).trim().slice(0, 8000);
  }
  const overviewSection = Object.entries(sections).find(([name]) => /overview|what it does|why/i.test(name));
  const workflowSection = Object.entries(sections).find(([name]) => /how it works|workflow/i.test(name));
  const overview = overviewSection?.[1] || workflowSection?.[1] || content.split(/\n\s*\n/).slice(1, 3).join('\n\n');
  return { title, overview: overview.slice(0, 2400), sections: Object.fromEntries(Object.entries(sections).filter(([name]) => !/^api endpoints|ui components|development$/i.test(name))) };
}

async function analyzeProject(projectPath) {
  const stat = await fs.stat(projectPath);
  if (!stat.isDirectory()) throw new Error('projectPath must point to a directory.');
  const files = await walk(projectPath);
  const routes = [];
  const frontendCalls = [];
  const dependencies = [];
  const envNames = new Set();
  const detected = new Set();
  const warnings = [];
  let readme = null;
  const packageFiles = files.filter(file => path.basename(file) === 'package.json');
  const readmeFile = files.find(file => /^readme\.md$/i.test(path.basename(file)));
  if (readmeFile) readme = parseReadme(await fs.readFile(readmeFile, 'utf8'));

  for (const file of packageFiles) {
    try {
      const pkg = JSON.parse(await fs.readFile(file, 'utf8'));
      const relative = path.relative(projectPath, file);
      dependencies.push(...dependenciesFromPackage(pkg, relative));
      const all = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
      if (all.includes('express')) detected.add('Express.js');
      if (all.includes('react')) detected.add('React');
      if (all.includes('vite')) detected.add('Vite');
      if (all.some(name => name.startsWith('@aws-sdk/'))) detected.add('AWS SDK');
    } catch { warnings.push(`Could not parse ${path.relative(projectPath, file)}.`); }
  }

  for (const file of files.filter(file => SOURCE_EXTENSIONS.has(path.extname(file)))) {
    const source = await fs.readFile(file, 'utf8');
    const relative = path.relative(projectPath, file);
    if (/\bapp\.(get|post|put|patch|delete)\(/.test(source)) routes.push(...parseExpressRoutes(source, relative));
    if (/fetch\(/.test(source)) frontendCalls.push(...traceFrontendCalls(source, relative));
    for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) envNames.add(match[1]);
  }

  const routeKeys = new Set(routes.map(route => `${route.method} ${route.path}`));
  for (const call of frontendCalls) {
    const key = `${call.method} ${call.path}`;
    const route = routes.find(item => item.method === call.method && item.path === call.path);
    if (route) route.frontendConsumers = [...(route.frontendConsumers || []), call];
    else if (!routeKeys.has(key)) warnings.push(`Frontend calls ${key}, but no matching backend route was found.`);
  }
  if (files.some(file => path.basename(file) === '.env' || path.basename(file).startsWith('.env.'))) warnings.push('Environment files were detected and excluded from analysis output.');
  if (!detected.has('Express.js')) warnings.push('Express.js was not detected; route extraction may be incomplete.');

  return {
    project: { name: path.basename(projectPath), path: projectPath, analyzedAt: new Date().toISOString() },
    stack: [...detected],
    files: files.map(file => path.relative(projectPath, file)).filter(file => !file.includes('.env')),
    routes,
    frontendCalls,
    dependencies: dependencies.filter((item, index, all) => all.findIndex(other => other.name === item.name) === index),
    environmentVariables: [...envNames].sort(),
    readme,
    warnings,
    summary: { files: files.length, routes: routes.length, frontendCalls: frontendCalls.length, dependencies: dependencies.length, warnings: warnings.length },
  };
}

module.exports = { analyzeProject };
