const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { analyzeProject } = require('./src/analyzer');
const { openApiDocument, markdownDocument } = require('./src/generators');
const { enrichEndpoints } = require('./src/ai/enrichment');
const { cloneGithubRepository } = require('./src/github');
const { createSession, getSession, updateSession, listSessions, deleteSession, cleanupExpiredSessions, validId } = require('./src/sessions/sessionStore');
const { createDocumentationBundle } = require('./src/bundle');

const port = Number(process.env.PORT || 5050);
const publicDir = path.join(__dirname, 'public');

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Request body is too large.');
  }
  return JSON.parse(body || '{}');
}

async function serveStatic(req, res) {
  const pathname = req.url.split('?')[0];
  const requested = pathname === '/' || pathname === '' ? '/index.html' : pathname;
  const filePath = path.resolve(publicDir, `.${requested}`);
  if (!filePath.startsWith(publicDir)) return sendJson(res, 403, { error: 'Forbidden' });
  try {
    const content = await fs.readFile(filePath);
    const type = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  try {
    if (req.method === 'GET' && req.url === '/api/health') return sendJson(res, 200, { status: 'ok', service: 'docforge' });
    if (req.method === 'POST' && req.url === '/api/analyze') {
      const input = await readJson(req);
      const source = input.githubUrl ? await cloneGithubRepository(input.githubUrl) : { projectPath: input.projectPath || process.env.DOCFORGE_PROJECT_PATH, repositoryUrl: null, temporary: false };
      const projectPath = source.projectPath;
      if (!projectPath || !path.isAbsolute(projectPath)) {
        return sendJson(res, 400, { error: 'projectPath must be an absolute local path.' });
      }
      const analysis = await analyzeProject(projectPath);
      analysis.project.sourceType = source.repositoryUrl ? 'github' : 'local';
      analysis.project.repositoryUrl = source.repositoryUrl;
      analysis.project.temporary = source.temporary;
      const session = await createSession({ analysis, source: { type: source.repositoryUrl ? 'github' : 'local', repositoryUrl: source.repositoryUrl, commit: source.commit || null, projectPath } });
      analysis.project.sessionId = session.id;
      analysis.project.commit = source.commit || null;
      analysis.enrichments = session.enrichments;
      return sendJson(res, 200, analysis);
    }
    if (req.method === 'GET' && req.url === '/api/sessions') { await cleanupExpiredSessions(); return sendJson(res, 200, await listSessions()); }
    if (req.method === 'GET' && req.url.startsWith('/api/sessions/')) {
      const sessionId = decodeURIComponent(req.url.slice('/api/sessions/'.length).split('?')[0]);
      if (!validId.test(sessionId)) return sendJson(res, 400, { error: 'Invalid session ID.' });
      const session = await getSession(sessionId);
      const analysis = session.analysis;
      analysis.enrichments = session.enrichments || [];
      analysis.project.sessionId = session.id;
      return sendJson(res, 200, analysis);
    }
    if (req.method === 'PATCH' && req.url.startsWith('/api/sessions/')) {
      const sessionId = decodeURIComponent(req.url.slice('/api/sessions/'.length).split('?')[0]);
      if (!validId.test(sessionId)) return sendJson(res, 400, { error: 'Invalid session ID.' });
      const input = await readJson(req);
      const session = await updateSession(sessionId, input);
      return sendJson(res, 200, { id: session.id, updatedAt: session.updatedAt });
    }
    if (req.method === 'DELETE' && req.url.startsWith('/api/sessions/')) {
      const sessionId = decodeURIComponent(req.url.slice('/api/sessions/'.length).split('?')[0]);
      if (!validId.test(sessionId)) return sendJson(res, 400, { error: 'Invalid session ID.' });
      let session;
      try { session = await getSession(sessionId); } catch { return sendJson(res, 404, { error: 'Session not found or already deleted.' }); }
      const clonePath = session.source?.projectPath;
      if (session.source?.type === 'github' && clonePath && path.dirname(clonePath) === os.tmpdir() && path.basename(clonePath).startsWith('docforge-github-')) await fs.rm(clonePath, { recursive: true, force: true });
      await deleteSession(sessionId);
      return sendJson(res, 200, { status: 'deleted', sessionId });
    }
    if (req.method === 'POST' && req.url === '/api/generate') {
      const input = await readJson(req);
      const projectPath = input.projectPath || process.env.DOCFORGE_PROJECT_PATH;
      if (!projectPath || !path.isAbsolute(projectPath)) return sendJson(res, 400, { error: 'projectPath must be an absolute local path.' });
      const analysis = await analyzeProject(projectPath);
      if (Array.isArray(input.enrichments)) analysis.enrichments = input.enrichments;
      return sendJson(res, 200, { analysis, openapi: openApiDocument(analysis), markdown: markdownDocument(analysis) });
    }
    if (req.method === 'POST' && req.url === '/api/bundle') {
      const input = await readJson(req);
      const projectPath = input.projectPath || process.env.DOCFORGE_PROJECT_PATH;
      if (!projectPath || !path.isAbsolute(projectPath)) return sendJson(res, 400, { error: 'projectPath must be an absolute path.' });
      const analysis = await analyzeProject(projectPath);
      if (Array.isArray(input.enrichments)) analysis.enrichments = input.enrichments;
      const bundle = await createDocumentationBundle(analysis);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${bundle.filename}"`, 'Content-Length': bundle.content.length, 'Access-Control-Allow-Origin': '*' });
      return res.end(bundle.content);
    }
    if (req.method === 'POST' && (req.url === '/api/enrich' || req.url === '/api/enrich/all')) {
      const input = await readJson(req);
      const projectPath = input.projectPath || process.env.DOCFORGE_PROJECT_PATH;
      if (!projectPath || !path.isAbsolute(projectPath)) return sendJson(res, 400, { error: 'projectPath must be an absolute local path.' });
      const analysis = await analyzeProject(projectPath);
      const selected = req.url === '/api/enrich' && Array.isArray(input.endpointIds) ? analysis.routes.filter(route => input.endpointIds.includes(route.id)) : analysis.routes;
      const enrichments = await enrichEndpoints(selected);
      if (input.sessionId && validId.test(input.sessionId)) await updateSession(input.sessionId, { enrichments });
      return sendJson(res, 200, { enrichments, mode: process.env.DOCFORGE_AI_PROVIDER || 'ollama' });
    }
    return serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
});

cleanupExpiredSessions().then(removed => {
  if (removed) console.log(`Removed ${removed} expired DocForge session${removed === 1 ? '' : 's'}.`);
  server.listen(port, () => console.log(`DocForge running at http://127.0.0.1:${port}`));
}).catch(error => {
  console.error('Session cleanup failed:', error.message);
  server.listen(port, () => console.log(`DocForge running at http://127.0.0.1:${port}`));
});
