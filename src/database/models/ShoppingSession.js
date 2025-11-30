const db = require('../db');
const { v4: uuidv4 } = require('uuid');

class ShoppingSession {
  /**
   * Create a new shopping session
   * @param {number} playerId
   * @param {string} discordThreadId
   * @returns {Object} Session object
   */
  static create(playerId, discordThreadId) {
    const sessionId = uuidv4();

    db.prepare(`
      INSERT INTO shopping_sessions (session_id, player_id, discord_thread_id, status)
      VALUES (?, ?, ?, 'active')
    `).run(sessionId, playerId, discordThreadId);

    console.log(`[DB] Created shopping session ${sessionId} for player ${playerId}`);

    return ShoppingSession.getById(sessionId);
  }

  /**
   * Get session by ID
   */
  static getById(sessionId) {
    return db.prepare(`
      SELECT * FROM shopping_sessions WHERE session_id = ?
    `).get(sessionId);
  }

  /**
   * Get session by Discord thread ID
   */
  static getByThreadId(threadId) {
    return db.prepare(`
      SELECT * FROM shopping_sessions WHERE discord_thread_id = ?
    `).get(threadId);
  }

  /**
   * Get active session for a player
   */
  static getActiveByPlayerId(playerId) {
    return db.prepare(`
      SELECT * FROM shopping_sessions
      WHERE player_id = ? AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(playerId);
  }

  /**
   * Update last activity timestamp
   */
  static updateActivity(sessionId) {
    db.prepare(`
      UPDATE shopping_sessions
      SET last_activity_at = CURRENT_TIMESTAMP
      WHERE session_id = ?
    `).run(sessionId);
  }

  /**
   * Cache search results in session
   */
  static cacheSearchResults(sessionId, query, items) {
    db.prepare(`
      UPDATE shopping_sessions
      SET last_search_query = ?,
          last_search_results = ?,
          last_search_at = CURRENT_TIMESTAMP,
          last_activity_at = CURRENT_TIMESTAMP
      WHERE session_id = ?
    `).run(query, JSON.stringify(items), sessionId);

    console.log(`[DB] Cached ${items.length} search results for session ${sessionId}`);
  }

  /**
   * Get cached search results
   */
  static getCachedSearchResults(sessionId) {
    const session = ShoppingSession.getById(sessionId);

    if (!session || !session.last_search_results) {
      return null;
    }

    // Check if results are still fresh (within 30 minutes)
    const searchTime = new Date(session.last_search_at);
    const now = new Date();
    const ageMinutes = (now - searchTime) / 1000 / 60;

    if (ageMinutes > 30) {
      console.log(`[DB] Search results expired (${ageMinutes.toFixed(1)} minutes old)`);
      return null;
    }

    return {
      query: session.last_search_query,
      items: JSON.parse(session.last_search_results),
      searchedAt: session.last_search_at
    };
  }

  /**
   * Lock session (after purchase or expiry)
   */
  static lock(sessionId, reason = 'manual') {
    db.prepare(`
      UPDATE shopping_sessions
      SET status = 'locked',
          locked_at = CURRENT_TIMESTAMP,
          lock_reason = ?
      WHERE session_id = ?
    `).run(reason, sessionId);

    console.log(`[DB] Locked session ${sessionId} (reason: ${reason})`);
  }

  /**
   * Mark session as expired
   */
  static expire(sessionId) {
    db.prepare(`
      UPDATE shopping_sessions
      SET status = 'expired',
          locked_at = CURRENT_TIMESTAMP,
          lock_reason = 'inactivity'
      WHERE session_id = ?
    `).run(sessionId);

    console.log(`[DB] Expired session ${sessionId}`);
  }

  /**
   * Find expired sessions (inactive for 30+ minutes)
   */
  static findExpired(inactivityMinutes = 30) {
    return db.prepare(`
      SELECT * FROM shopping_sessions
      WHERE status = 'active'
      AND datetime(last_activity_at, '+${inactivityMinutes} minutes') < datetime('now')
    `).all();
  }

  /**
   * Get session history for a player
   */
  static getPlayerHistory(playerId, limit = 10) {
    return db.prepare(`
      SELECT * FROM shopping_sessions
      WHERE player_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(playerId, limit);
  }

  /**
   * Get session stats
   */
  static getStats(sessionId) {
    const session = ShoppingSession.getById(sessionId);

    if (!session) return null;

    const messageCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM conversation_messages
      WHERE session_id = ?
    `).get(sessionId).count;

    const itemsGenerated = db.prepare(`
      SELECT COUNT(*) as count
      FROM items
      WHERE generated_in_session_id = ?
    `).get(sessionId).count;

    return {
      ...session,
      message_count: messageCount,
      items_generated: itemsGenerated
    };
  }

  /**
   * Clean up old sessions (admin function)
   */
  static cleanupOld(daysOld = 30) {
    const result = db.prepare(`
      DELETE FROM shopping_sessions
      WHERE datetime(created_at, '+${daysOld} days') < datetime('now')
      AND status != 'active'
    `).run();

    console.log(`[DB] Cleaned up ${result.changes} old sessions`);
    return result.changes;
  }
}

module.exports = ShoppingSession;