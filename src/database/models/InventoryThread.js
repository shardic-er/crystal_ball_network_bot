const db = require('../db');
const { v4: uuidv4 } = require('uuid');

class InventoryThread {
  /**
   * Create a new inventory thread for a player
   * @param {number} playerId
   * @param {string} discordThreadId
   * @param {string} headerMessageId
   * @returns {Object} Created inventory thread
   */
  static create(playerId, discordThreadId, headerMessageId = null) {
    const threadId = uuidv4();

    const insert = db.prepare(`
      INSERT INTO inventory_threads (thread_id, player_id, discord_thread_id, header_message_id)
      VALUES (?, ?, ?, ?)
    `);

    insert.run(threadId, playerId, discordThreadId, headerMessageId);

    console.log(`[DB] Created inventory thread for player ${playerId}: ${discordThreadId}`);

    return InventoryThread.getById(threadId);
  }

  /**
   * Get inventory thread by ID
   */
  static getById(threadId) {
    return db.prepare(`
      SELECT * FROM inventory_threads WHERE thread_id = ?
    `).get(threadId);
  }

  /**
   * Get inventory thread by player ID
   */
  static getByPlayerId(playerId) {
    return db.prepare(`
      SELECT * FROM inventory_threads WHERE player_id = ?
    `).get(playerId);
  }

  /**
   * Get inventory thread by Discord thread ID
   */
  static getByDiscordThreadId(discordThreadId) {
    return db.prepare(`
      SELECT * FROM inventory_threads WHERE discord_thread_id = ?
    `).get(discordThreadId);
  }

  /**
   * Update header message ID
   */
  static updateHeaderMessageId(threadId, headerMessageId) {
    db.prepare(`
      UPDATE inventory_threads
      SET header_message_id = ?,
          last_updated_at = CURRENT_TIMESTAMP
      WHERE thread_id = ?
    `).run(headerMessageId, threadId);

    console.log(`[DB] Updated header message ID for thread ${threadId}`);

    return InventoryThread.getById(threadId);
  }

  /**
   * Touch last updated timestamp
   */
  static touch(threadId) {
    db.prepare(`
      UPDATE inventory_threads
      SET last_updated_at = CURRENT_TIMESTAMP
      WHERE thread_id = ?
    `).run(threadId);
  }

  /**
   * Check if player has inventory thread
   */
  static hasInventoryThread(playerId) {
    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM inventory_threads
      WHERE player_id = ?
    `).get(playerId);

    return result.count > 0;
  }

  /**
   * Get all inventory threads (admin function)
   */
  static getAll() {
    return db.prepare(`
      SELECT * FROM inventory_threads ORDER BY created_at DESC
    `).all();
  }
}

module.exports = InventoryThread;