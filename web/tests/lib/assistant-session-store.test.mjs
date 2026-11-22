import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  getAssistantSession,
  setAssistantSession,
  deleteAssistantSession,
} from '../../src/lib/assistant-session-store.mjs';

test('assistant session store manages CLI sessions per conversation', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-session-test-'));
  try {
    const chatId = randomUUID();
    const otherChatId = randomUUID();

    // Initially null
    assert.equal(getAssistantSession(root, chatId, 'antigravity'), null);
    assert.equal(getAssistantSession(root, 'invalid-id', 'antigravity'), null);

    // Save antigravity session
    setAssistantSession(root, chatId, 'antigravity', 'session-agy-123');
    assert.equal(getAssistantSession(root, chatId, 'antigravity'), 'session-agy-123');

    // Other chat has no session
    assert.equal(getAssistantSession(root, otherChatId, 'antigravity'), null);

    // Add claude session for the same chat
    setAssistantSession(root, chatId, 'claude', 'session-claude-456');
    assert.equal(getAssistantSession(root, chatId, 'antigravity'), 'session-agy-123');
    assert.equal(getAssistantSession(root, chatId, 'claude'), 'session-claude-456');

    // Update antigravity session
    setAssistantSession(root, chatId, 'antigravity', 'session-agy-789');
    assert.equal(getAssistantSession(root, chatId, 'antigravity'), 'session-agy-789');
    assert.equal(getAssistantSession(root, chatId, 'claude'), 'session-claude-456');

    // Delete chat session
    deleteAssistantSession(root, chatId);
    assert.equal(getAssistantSession(root, chatId, 'antigravity'), null);
    assert.equal(getAssistantSession(root, chatId, 'claude'), null);

    // Deleting again is a safe no-op
    assert.doesNotThrow(() => deleteAssistantSession(root, chatId));
    assert.doesNotThrow(() => deleteAssistantSession(root, 'invalid-uuid'));

    // Corrupted file handling
    const corruptId = randomUUID();
    setAssistantSession(root, corruptId, 'antigravity', 'valid-session');
    const corruptFile = join(root, '.career-ops-web', 'assistant-sessions', `${corruptId}.json`);
    writeFileSync(corruptFile, 'not-valid-json');
    assert.equal(getAssistantSession(root, corruptId, 'antigravity'), null);
    // Setting on corrupt file overwrites cleanly
    setAssistantSession(root, corruptId, 'antigravity', 'repaired-session');
    assert.equal(getAssistantSession(root, corruptId, 'antigravity'), 'repaired-session');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
