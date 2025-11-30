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
   * Update player balance (with transaction)
   * @param {number} playerId
   * @param {number} newBalance
   * @returns {Object} Updated player
   */
  static updateBalance(playerId, newBalance) {
    db.prepare(`
      UPDATE players
      SET account_balance_gp = ?,
          last_active_at = CURRENT_TIMESTAMP
      WHERE player_id = ?
    `).run(newBalance, playerId);

    return Player.getById(playerId);
  }

  /**
   * Add gold to player account
   */
  static addGold(playerId, amount) {
    const player = Player.getById(playerId);
    const newBalance = player.account_balance_gp + amount;

    db.prepare(`
      UPDATE players
      SET account_balance_gp = account_balance_gp + ?,
          total_earned_gp = total_earned_gp + ?,
          last_active_at = CURRENT_TIMESTAMP
      WHERE player_id = ?
    `).run(amount, amount, playerId);

    return Player.getById(playerId);
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
          total_spent_gp = total_spent_gp + ?,
          last_active_at = CURRENT_TIMESTAMP
      WHERE player_id = ?
    `).run(amount, amount, playerId);

    return Player.getById(playerId);
  }

  /**
   * Get player stats
   */
  static getStats(playerId) {
    const player = Player.getById(playerId);

    const inventoryCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM player_inventory
      WHERE player_id = ? AND sold = 0
    `).get(playerId).count;

    const transactionCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM transactions
      WHERE player_id = ?
    `).get(playerId).count;

    return {
      ...player,
      inventory_count: inventoryCount,
      transaction_count: transactionCount
    };
  }

  /**
   * Get all players (admin function)
   */
  static getAll() {
    return db.prepare(`
      SELECT * FROM players ORDER BY created_at DESC
    `).all();
  }

  /**
   * Get top players by wealth
   */
  static getLeaderboard(limit = 10) {
    return db.prepare(`
      SELECT
        player_id,
        username,
        account_balance_gp,
        total_spent_gp,
        total_earned_gp,
        (SELECT COUNT(*) FROM player_inventory WHERE player_id = players.player_id AND sold = 0) as item_count
      FROM players
      ORDER BY account_balance_gp DESC
      LIMIT ?
    `).all(limit);
  }
}

module.exports = Player;