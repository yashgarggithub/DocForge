const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

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
  return writeSession({ id: createId(), createdAt: now, updatedAt: now, lastAccessedAt: now, source, analysis, enrichments: analysis.enrichments || [] });
}

async function getSession(id) {
  const session = JSON.parse(await fs.readFile(fileFor(id), 'utf8'));
  session.lastAccessedAt = new Date().toISOString();
  session.updatedAt = session.updatedAt || session.lastAccessedAt;
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
  const sessions = await Promise.all(files.map(async file => { try { const session = JSON.parse(await fs.readFile(path.join(sessionDir, file), 'utf8')); return { id: session.id, name: session.analysis?.project?.name, sourceType: session.analysis?.project?.sourceType || 'local', repositoryUrl: session.analysis?.project?.repositoryUrl || null, updatedAt: session.updatedAt }; } catch { return null; } }));
  return sessions.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function deleteSession(id) { await fs.rm(fileFor(id), { force: true }); }

module.exports = { createSession, getSession, updateSession, listSessions, deleteSession, sessionDir, validId };
