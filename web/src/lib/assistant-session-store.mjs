import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function sessionsDir(root) {
  const dir = join(root, '.career-ops-web', 'assistant-sessions');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionPath(root, chatId) {
  if (typeof chatId !== 'string' || !UUID_RE.test(chatId)) return null;
  return join(sessionsDir(root), `${chatId}.json`);
}

export function getAssistantSession(root, chatId, cliId) {
  const file = sessionPath(root, chatId);
  if (!file) return null;
  try {
    const raw = readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    if (data?.sessions && typeof data.sessions[cliId] === 'string' && data.sessions[cliId].trim()) {
      return data.sessions[cliId].trim();
    }
    if (data?.sessionId && data?.cliId === cliId && typeof data.sessionId === 'string' && data.sessionId.trim()) {
      return data.sessionId.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export function setAssistantSession(root, chatId, cliId, sessionId) {
  const file = sessionPath(root, chatId);
  if (!file || typeof sessionId !== 'string' || !sessionId.trim() || typeof cliId !== 'string' || !cliId.trim()) return;
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    /* new file */
  }
  const sessions = (existing && typeof existing.sessions === 'object' && existing.sessions !== null)
    ? { ...existing.sessions }
    : {};
  sessions[cliId.trim()] = sessionId.trim();
  const payload = {
    chatId,
    sessions,
    updatedAt: new Date().toISOString(),
  };
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    renameSync(temp, file);
  } catch (err) {
    try { unlinkSync(temp); } catch { /* ignore */ }
    throw err;
  }
}

export function deleteAssistantSession(root, chatId) {
  const file = sessionPath(root, chatId);
  if (!file) return;
  try {
    unlinkSync(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}
