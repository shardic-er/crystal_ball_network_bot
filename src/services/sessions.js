/**
 * Session management service
 * Handles session state for search, sell, and craft threads
 */

const fs = require('fs').promises;
const path = require('path');

const SESSIONS_FILE = path.join(__dirname, '..', 'cbn_sessions.json');

// Session state
let cbnSessions = {};

/**
 * Load sessions from file
 */
async function loadSessions() {
  console.log('Loading sessions...');
  try {
    const data = await fs.readFile(SESSIONS_FILE, 'utf-8');
    cbnSessions = JSON.parse(data);
    console.log(`Loaded ${Object.keys(cbnSessions).length} sessions`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing sessions file found, starting fresh');
      cbnSessions = {};
      await saveSessions();
    } else {
      console.error('Error loading sessions:', error);
    }
  }
}

/**
 * Save sessions to file
 */
async function saveSessions() {
  try {
    await fs.writeFile(SESSIONS_FILE, JSON.stringify(cbnSessions, null, 2));
  } catch (error) {
    console.error('Error saving sessions:', error);
  }
}

/**
 * Get a session by thread ID
 * @param {string} threadId - Discord thread ID
 * @returns {Object|null} Session data or null
 */
function getSession(threadId) {
  return cbnSessions[threadId] || null;
}

/**
 * Set a session
 * @param {string} threadId - Discord thread ID
 * @param {Object} data - Session data
 */
function setSession(threadId, data) {
  cbnSessions[threadId] = data;
}

/**
 * Update a session (merge with existing data)
 * @param {string} threadId - Discord thread ID
 * @param {Object} updates - Partial session data to merge
 * @returns {Object|null} Updated session or null if not found
 */
function updateSession(threadId, updates) {
  if (!cbnSessions[threadId]) {
    return null;
  }
  cbnSessions[threadId] = { ...cbnSessions[threadId], ...updates };
  return cbnSessions[threadId];
}

/**
 * Delete a session
 * @param {string} threadId - Discord thread ID
 * @returns {boolean} True if session was deleted
 */
function deleteSession(threadId) {
  if (cbnSessions[threadId]) {
    delete cbnSessions[threadId];
    return true;
  }
  return false;
}

/**
 * Get all sessions (copy)
 * @returns {Object} All sessions keyed by thread ID
 */
function getAllSessions() {
  return { ...cbnSessions };
}

/**
 * Get raw sessions object (for backward compatibility)
 * WARNING: Returns mutable internal state. Use with care.
 * @returns {Object} Direct reference to sessions object
 */
function getSessionsRef() {
  return cbnSessions;
}

/**
 * Get session IDs
 * @returns {string[]} Array of thread IDs
 */
function getSessionIds() {
  return Object.keys(cbnSessions);
}

/**
 * Check if a session exists
 * @param {string} threadId - Discord thread ID
 * @returns {boolean} True if session exists
 */
function hasSession(threadId) {
  return threadId in cbnSessions;
}

/**
 * Clear sessions by type (used during bootstrap)
 * @param {string[]} types - Session types to clear ('sell', 'search', 'craft')
 * @returns {number} Number of sessions cleared
 */
function clearSessionsByType(types) {
  const sessionIds = Object.keys(cbnSessions);
  let cleared = 0;
  for (const threadId of sessionIds) {
    const session = cbnSessions[threadId];
    if (types.includes(session.sessionType)) {
      delete cbnSessions[threadId];
      cleared++;
    }
  }
  return cleared;
}

module.exports = {
  loadSessions,
  saveSessions,
  getSession,
  setSession,
  updateSession,
  deleteSession,
  getAllSessions,
  getSessionsRef,
  getSessionIds,
  hasSession,
  clearSessionsByType
};
