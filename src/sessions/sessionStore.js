const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const sessionDir = path.join(__dirname, '..', '..', 'data', 'sessions');
const validId = /^sess_[a-f0-9]{24}$/;

async function ensureStore() { await fs.mkdir(sessionDir, { recursive: true }); }
function fileFor(id) { if (!validId.test(id)) throw new Error('Invalid session ID.'); return path.join(sessionDir, `${id}.json`); }
function createId() { return `sess_${crypto.randomBytes(12).toString('hex')}`; }

async function writeSession(session) {
  await ensureStore();
  const target = fileFor(session.id);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(session, null, 2), 'utf8');
  await fs.rename(temporary, target);
  return session;
}

async function createSession({ analysis, source }) {
  const now = new Date().toISOString();
  return writeSession({ id: createId(), createdAt: now, updatedAt: now, lastAccessedAt: now, expiresAt: new Date(Date.now() + ttlMs()).toISOString(), source, analysis, enrichments: analysis.enrichments || [] });
}

function ttlMs() { return Math.max(1, Number(process.env.DOCFORGE_SESSION_TTL_HOURS || 24)) * 60 * 60 * 1000; }

async function getSession(id) {
  const session = JSON.parse(await fs.readFile(fileFor(id), 'utf8'));
  session.lastAccessedAt = new Date().toISOString();
  session.updatedAt = session.updatedAt || session.lastAccessedAt;
  session.expiresAt = new Date(Date.now() + ttlMs()).toISOString();
  await writeSession(session);
  return session;
}

async function updateSession(id, updates) {
  const session = await getSession(id);
  if (Array.isArray(updates.enrichments)) session.enrichments = updates.enrichments;
  if (updates.analysis && typeof updates.analysis === 'object') session.analysis = updates.analysis;
  session.updatedAt = new Date().toISOString();
  return writeSession(session);
}

async function listSessions() {
  await ensureStore();
  const files = (await fs.readdir(sessionDir)).filter(file => validId.test(file.replace(/\.json$/, '')));
  const sessions = await Promise.all(files.map(async file => { try { const session = JSON.parse(await fs.readFile(path.join(sessionDir, file), 'utf8')); return { id: session.id, name: session.analysis?.project?.name, sourceType: session.analysis?.project?.sourceType || 'local', repositoryUrl: session.analysis?.project?.repositoryUrl || null, updatedAt: session.updatedAt, expiresAt: session.expiresAt }; } catch { return null; } }));
  return sessions.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function deleteSession(id) { await fs.rm(fileFor(id), { force: true }); }

async function cleanupExpiredSessions() {
  await ensureStore();
  const now = Date.now();
  const files = (await fs.readdir(sessionDir)).filter(file => validId.test(file.replace(/\.json$/, '')));
  let removed = 0;
  for (const file of files) {
    const target = path.join(sessionDir, file);
    try {
      const session = JSON.parse(await fs.readFile(target, 'utf8'));
      const expiresAt = Date.parse(session.expiresAt || session.updatedAt || session.createdAt);
      if (!Number.isFinite(expiresAt) || expiresAt > now) continue;
      const clonePath = session.source?.projectPath;
      if (session.source?.type === 'github' && clonePath && path.dirname(clonePath) === os.tmpdir() && path.basename(clonePath).startsWith('docforge-github-')) await fs.rm(clonePath, { recursive: true, force: true });
      await fs.rm(target, { force: true });
      removed += 1;
    } catch { /* Ignore malformed files; they are not used for cleanup. */ }
  }
  return removed;
}

module.exports = { createSession, getSession, updateSession, listSessions, deleteSession, cleanupExpiredSessions, sessionDir, validId };
