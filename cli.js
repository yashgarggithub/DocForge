#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const { analyzeProject } = require('./src/analyzer');
const { openApiDocument, markdownDocument, htmlDocument } = require('./src/generators');
const { createDocumentationBundle } = require('./src/bundle');
const { evaluateQuality } = require('./src/quality');
const { mergeDocumentation } = require('./src/documentation');

const VERSION = require('./package.json').version;
const DEFAULT_CONFIG = { outputDir: '.docforge', minRouteCoverage: 0.8, minRouteConfidence: 0.7, minAverageConfidence: 0.75, includeWarnings: true };
const EXIT = { OK: 0, QUALITY: 1, USAGE: 2, ANALYSIS: 3, GENERATION: 4 };

function help() {
  return `DocForge ${VERSION}\n\nUsage:\n  docforge analyze <path> [options]\n  docforge generate <path> --format <markdown|openapi|html|bundle> [options]\n  docforge check <path> [options]\n\nOptions:\n  --config <file>  Configuration file (default: ./docforge.config.json)\n  --output <path>  Output file or directory\n  --json           Emit machine-readable output\n  --quiet          Suppress progress messages\n  --help           Show this help\n  --version        Show the version\n`;
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--version' || token === '-v') options.version = true;
    else if (token === '--json') options.json = true;
    else if (token === '--quiet') options.quiet = true;
    else if (token === '--config' || token === '--output' || token === '--format') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
      options[token.slice(2)] = value;
    } else if (token.startsWith('--')) throw new Error(`Unknown option: ${token}`);
    else options._.push(token);
  }
  return options;
}

async function readConfig(filename) {
  const configPath = path.resolve(filename || 'docforge.config.json');
  let parsed = {};
  try { parsed = JSON.parse(await fs.readFile(configPath, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Invalid config file: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Configuration must be a JSON object.');
  const allowed = new Set(Object.keys(DEFAULT_CONFIG));
  for (const key of Object.keys(parsed)) if (!allowed.has(key)) throw new Error(`Unknown configuration value: ${key}`);
  const config = { ...DEFAULT_CONFIG, ...parsed };
  for (const key of ['minRouteCoverage', 'minRouteConfidence', 'minAverageConfidence']) if (typeof config[key] !== 'number' || config[key] < 0 || config[key] > 1) throw new Error(`${key} must be a number between 0 and 1.`);
  if (typeof config.outputDir !== 'string' || typeof config.includeWarnings !== 'boolean') throw new Error('outputDir must be a string and includeWarnings must be boolean.');
  return config;
}

function redact(analysis) {
  return { ...analysis, project: { ...analysis.project, path: analysis.project?.repositoryUrl || analysis.project?.name, localName: undefined } };
}

async function writeArtifact(output, format, content) {
  const defaults = { analysis: 'analysis.json', markdown: 'product-documentation.md', openapi: 'openapi.json', html: 'index.html', bundle: 'documentation.zip' };
  const isFile = path.extname(output) !== '';
  const target = isFile ? path.resolve(output) : path.join(path.resolve(output), defaults[format]);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  return target;
}

async function run(command, options) {
  const projectPath = options._[1];
  if (!projectPath) throw Object.assign(new Error(`${command} requires a project path.\n\n${help()}`), { code: EXIT.USAGE });
  const config = await readConfig(options.config);
  let analysis;
  try { analysis = await analyzeProject(path.resolve(projectPath)); } catch (error) { throw Object.assign(new Error(error.message), { code: EXIT.ANALYSIS }); }
  analysis = mergeDocumentation(analysis, {});
  if (command === 'analyze') {
    const safe = redact(analysis);
    if (options.output) await writeArtifact(options.output, 'analysis', JSON.stringify(safe, null, 2));
    if (options.json) console.log(JSON.stringify(safe, null, 2));
    else if (!options.quiet) console.log(`Project: ${safe.project.name}\nFrameworks: ${(safe.frameworks || []).map(item => item.name).join(', ') || 'None detected'}\nRoutes: ${safe.routes.length}\nFrontend calls: ${safe.frontendCalls.length}\nWarnings: ${safe.warnings.length}`);
    return EXIT.OK;
  }
  if (command === 'check') {
    const report = evaluateQuality(analysis, config);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else if (!options.quiet) { console.log(`Routes: ${report.routes} (${report.documentedRoutes} documented)\nCoverage: ${(report.coverage * 100).toFixed(1)}% (minimum ${(report.thresholds.minRouteCoverage * 100).toFixed(1)}%)\nMinimum confidence: ${(report.minimumConfidence * 100).toFixed(1)}%\nAverage confidence: ${(report.averageConfidence * 100).toFixed(1)}%`); if (report.failures.length) console.error(`Quality checks failed: ${report.failures.map(item => item.route ? `${item.route}: ${item.reason}` : item.metric).join('; ')}`); }
    return report.passed ? EXIT.OK : EXIT.QUALITY;
  }
  const format = options.format;
  if (!['markdown', 'openapi', 'html', 'bundle'].includes(format)) throw Object.assign(new Error('generate requires --format markdown, openapi, html, or bundle.'), { code: EXIT.USAGE });
  try {
    let content;
    if (format === 'markdown') content = markdownDocument(analysis);
    else if (format === 'openapi') content = JSON.stringify(openApiDocument(analysis), null, 2);
    else if (format === 'html') content = htmlDocument(analysis);
    else { const bundle = await createDocumentationBundle(analysis); content = bundle.content; }
    const target = await writeArtifact(options.output || config.outputDir, format, content);
    if (!options.quiet) console.log(`Generated ${format}: ${target}`);
    return EXIT.OK;
  } catch (error) { throw Object.assign(new Error(error.message), { code: EXIT.GENERATION }); }
}

(async () => {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.version) { console.log(VERSION); return; }
    if (options.help || !options._[0]) { console.log(help()); process.exitCode = options.help ? EXIT.OK : EXIT.USAGE; return; }
    const command = options._[0];
    if (!['analyze', 'generate', 'check'].includes(command)) throw Object.assign(new Error(`Unknown command: ${command}`), { code: EXIT.USAGE });
    process.exitCode = await run(command, options);
  } catch (error) { console.error(`docforge: ${error.message}`); process.exitCode = error.code || EXIT.USAGE; }
})();
