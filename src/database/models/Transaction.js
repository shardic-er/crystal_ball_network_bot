const db = require('../db');
const Player = require('./Player');

class Transaction {
  /**
   * Record a transaction (with automatic balance tracking)
   * @param {Object} transactionData
   * @returns {Object} Created transaction
   */
  static create(transactionData) {
    const {
      playerId,
      transactionType,
      amountGp,
      itemId = null,
      inventoryId = null,
      sessionId = null,
      description = null
    } = transactionData;

    const player = Player.getById(playerId);
    const balanceBefore = player.account_balance_gp;

    // Validate transaction type
    const validTypes = ['purchase', 'sale', 'deposit', 'withdrawal'];
    if (!validTypes.includes(transactionType)) {
      throw new Error(`Invalid transaction type: ${transactionType}`);
    }

    // Calculate balance after based on transaction type
    let balanceAfter;
    if (transactionType === 'purchase' || transactionType === 'withdrawal') {
      balanceAfter = balanceBefore - amountGp;
    } else if (transactionType === 'sale' || transactionType === 'deposit') {
      balanceAfter = balanceBefore + amountGp;
    }

    // Validate sufficient funds for purchases/withdrawals
    if ((transactionType === 'purchase' || transactionType === 'withdrawal') && balanceAfter < 0) {
      throw new Error(`Insufficient funds. Balance: ${balanceBefore} gp, Required: ${amountGp} gp`);
    }

    const insert = db.prepare(`
      INSERT INTO transactions (
        player_id, transaction_type, amount_gp,
        balance_before_gp, balance_after_gp,
        item_id, inventory_id, session_id, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      playerId,
      transactionType,
      amountGp,
      balanceBefore,
      balanceAfter,
      itemId,
      inventoryId,
      sessionId,
      description
    );

    console.log(`[DB] Transaction recorded: ${transactionType} ${amountGp} gp for player ${playerId} (${balanceBefore} -> ${balanceAfter})`);

    return Transaction.getById(result.lastInsertRowid);
  }

  /**
   * Execute a purchase (transaction + inventory update)
   * @param {number} playerId
   * @param {number} itemId
   * @param {number} priceGp
   * @param {string} sessionId
   * @returns {Object} { transaction, inventoryId }
   */
  static executePurchase(playerId, itemId, priceGp, sessionId) {
    // Use database transaction for atomicity
    const purchaseTransaction = db.transaction(() => {
      // 1. Record the transaction
      const transaction = Transaction.create({
        playerId,
        transactionType: 'purchase',
        amountGp: priceGp,
        itemId,
        sessionId,
        description: `Purchased item from CBN`
      });

      // 2. Update player balance
      Player.deductGold(playerId, priceGp);

      // 3. Add to inventory
      const Item = require('./Item');
      const inventoryId = Item.addToInventory(itemId, playerId, priceGp, sessionId);

      return {
        transaction,
        inventoryId
      };
    });

    return purchaseTransaction();
  }

  /**
   * Execute a sale (transaction + inventory update)
   * @param {number} playerId
   * @param {number} inventoryId
   * @param {number} salePrice
   * @returns {Object} { transaction, item }
   */
  static executeSale(playerId, inventoryId, salePrice) {
    const saleTransaction = db.transaction(() => {
      const Item = require('./Item');
      const inventoryItem = Item.getInventoryItem(inventoryId);

      if (!inventoryItem || inventoryItem.player_id !== playerId) {
        throw new Error('Item not found or not owned by player');
      }

      // 1. Mark item as sold
      const soldItem = Item.sellItem(inventoryId, playerId, salePrice);

      // 2. Record transaction
      const transaction = Transaction.create({
        playerId,
        transactionType: 'sale',
        amountGp: salePrice,
        itemId: inventoryItem.item_id,
        inventoryId,
        description: `Sold ${inventoryItem.name} back to CBN`
      });

      // 3. Update player balance
      Player.addGold(playerId, salePrice);

      return {
        transaction,
        item: soldItem
      };
    });

    return saleTransaction();
  }

  /**
   * Get transaction by ID
   */
  static getById(transactionId) {
    return db.prepare(`
      SELECT * FROM transactions WHERE transaction_id = ?
    `).get(transactionId);
  }

  /**
   * Get player's transaction history
   */
  static getPlayerHistory(playerId, limit = 50, offset = 0) {
    return db.prepare(`
      SELECT
        t.*,
        i.name as item_name
      FROM transactions t
      LEFT JOIN items i ON t.item_id = i.item_id
      WHERE t.player_id = ?
      ORDER BY t.timestamp DESC
      LIMIT ? OFFSET ?
    `).all(playerId, limit, offset);
  }

  /**
   * Get recent transactions for a player
   */
  static getRecentByPlayer(playerId, limit = 10) {
    return Transaction.getPlayerHistory(playerId, limit, 0);
  }

  /**
   * Get transactions by type
   */
  static getByType(playerId, transactionType, limit = 50) {
    return db.prepare(`
      SELECT
        t.*,
        i.name as item_name
      FROM transactions t
      LEFT JOIN items i ON t.item_id = i.item_id
      WHERE t.player_id = ? AND t.transaction_type = ?
      ORDER BY t.timestamp DESC
      LIMIT ?
    `).all(playerId, transactionType, limit);
  }

  /**
   * Get transactions in a date range
   */
  static getByDateRange(playerId, startDate, endDate) {
    return db.prepare(`
      SELECT
        t.*,
        i.name as item_name
      FROM transactions t
      LEFT JOIN items i ON t.item_id = i.item_id
      WHERE t.player_id = ?
      AND t.timestamp BETWEEN ? AND ?
      ORDER BY t.timestamp DESC
    `).all(playerId, startDate, endDate);
  }

  /**
   * Get transaction summary for a player
   */
  static getPlayerSummary(playerId) {
    const summary = db.prepare(`
      SELECT
        transaction_type,
        COUNT(*) as count,
        SUM(amount_gp) as total_amount
      FROM transactions
      WHERE player_id = ?
      GROUP BY transaction_type
    `).all(playerId);

    const total = db.prepare(`
      SELECT COUNT(*) as total_transactions
      FROM transactions
      WHERE player_id = ?
    `).get(playerId);

    return {
      total_transactions: total.total_transactions,
      by_type: summary
    };
  }

  /**
   * Get all transactions (admin function)
   */
  static getAll(limit = 100, offset = 0) {
    return db.prepare(`
      SELECT
        t.*,
        p.username,
        i.name as item_name
      FROM transactions t
      JOIN players p ON t.player_id = p.player_id
      LEFT JOIN items i ON t.item_id = i.item_id
      ORDER BY t.timestamp DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  /**
   * Get transaction statistics
   */
  static getStatistics() {
    const totalTransactions = db.prepare(`
      SELECT COUNT(*) as count FROM transactions
    `).get().count;

    const byType = db.prepare(`
      SELECT
        transaction_type,
        COUNT(*) as count,
        SUM(amount_gp) as total_amount
      FROM transactions
      GROUP BY transaction_type
    `).all();

    const totalGoldFlow = db.prepare(`
      SELECT
        SUM(CASE WHEN transaction_type IN ('purchase', 'withdrawal') THEN amount_gp ELSE 0 END) as total_spent,
        SUM(CASE WHEN transaction_type IN ('sale', 'deposit') THEN amount_gp ELSE 0 END) as total_earned
      FROM transactions
    `).get();

    return {
      total_transactions: totalTransactions,
      by_type: byType,
      gold_flow: totalGoldFlow
    };
  }
}

module.exports = Transaction;