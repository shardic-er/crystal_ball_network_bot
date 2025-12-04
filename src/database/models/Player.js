const db = require('../db');

class Player {
  /**
   * Get or create a player by Discord user ID
   * @param {string} discordUserId
   * @param {string} username
   * @param {number} startingBalance - Optional starting balance (defaults to Benford's Law)
   * @returns {Object} Player object
   */
  static getOrCreate(discordUserId, username, startingBalance = null) {
    // Try to find existing player
    let player = db.prepare(`
      SELECT * FROM players WHERE discord_user_id = ?
    `).get(discordUserId);

    if (player) {
      // Update last active and username (in case it changed)
      db.prepare(`
        UPDATE players
        SET last_active_at = CURRENT_TIMESTAMP, username = ?
        WHERE player_id = ?
      `).run(username, player.player_id);

      return player;
    }

    // Create new player
    const insert = db.prepare(`
      INSERT INTO players (discord_user_id, username, account_balance_gp)
      VALUES (?, ?, ?)
    `);

    const result = insert.run(discordUserId, username, startingBalance || 0);

    // Fetch the newly created player
    player = db.prepare(`
      SELECT * FROM players WHERE player_id = ?
    `).get(result.lastInsertRowid);

    console.log(`[DB] Created new player: ${username} (ID: ${player.player_id}) with ${player.account_balance_gp} gp`);

    return player;
  }

  /**
   * Get player by ID
   */
  static getById(playerId) {
    return db.prepare(`
      SELECT * FROM players WHERE player_id = ?
    `).get(playerId);
  }

  /**
   * Get player by Discord user ID
   */
  static getByDiscordId(discordUserId) {
    return db.prepare(`
      SELECT * FROM players WHERE discord_user_id = ?
    `).get(discordUserId);
  }

  /**
   * Deduct gold from player account (with validation)
   */
  static deductGold(playerId, amount) {
    const player = Player.getById(playerId);

    if (player.account_balance_gp < amount) {
      throw new Error(`Insufficient funds. Balance: ${player.account_balance_gp} gp, Required: ${amount} gp`);
    }

    db.prepare(`
      UPDATE players
      SET account_balance_gp = account_balance_gp - ?,
          last_active_at = CURRENT_TIMESTAMP
      WHERE player_id = ?
    `).run(amount, playerId);

    return Player.getById(playerId);
  }

  /**
   * Add gold to player account (for selling items)
   */
  static addGold(playerId, amount) {
    if (amount < 0) {
      throw new Error(`Cannot add negative gold amount: ${amount}`);
    }

    db.prepare(`
      UPDATE players
      SET account_balance_gp = account_balance_gp + ?,
          last_active_at = CURRENT_TIMESTAMP
      WHERE player_id = ?
    `).run(amount, playerId);

    return Player.getById(playerId);
  }

}

module.exports = Player;