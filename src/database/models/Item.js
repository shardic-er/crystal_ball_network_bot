const db = require('../db');

class Item {
  /**
   * Create a new item in the catalog
   * @param {Object} itemData - Item properties from JSON
   * @param {number} priceGp - Final price in gold pieces
   * @param {string} sessionId - Shopping session where it was generated
   * @param {number} playerId - Player it was generated for
   * @returns {Object} Created item
   */
  static create(itemData, priceGp, sessionId, playerId) {
    const insert = db.prepare(`
      INSERT INTO items (
        name, item_type, rarity, requires_attunement, attunement_requirement,
        description, history, properties, complication, base_price_gp,
        generated_in_session_id, generated_for_player_id, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      itemData.name,
      itemData.itemType,
      itemData.rarity,
      itemData.requiresAttunement ? 1 : 0,
      itemData.attunementRequirement || null,
      itemData.description,
      itemData.history,
      itemData.properties,
      itemData.complication,
      priceGp,
      sessionId,
      playerId,
      JSON.stringify({ ...itemData, priceGp })
    );

    console.log(`[DB] Created item: ${itemData.name} (ID: ${result.lastInsertRowid})`);

    return Item.getById(result.lastInsertRowid);
  }

  /**
   * Get item by ID
   */
  static getById(itemId) {
    return db.prepare(`
      SELECT * FROM items WHERE item_id = ?
    `).get(itemId);
  }

  /**
   * Search items by name
   */
  static searchByName(searchTerm, limit = 20) {
    return db.prepare(`
      SELECT * FROM items
      WHERE name LIKE ?
      ORDER BY generated_at DESC
      LIMIT ?
    `).all(`%${searchTerm}%`, limit);
  }

  /**
   * Get items by rarity
   */
  static getByRarity(rarity, limit = 20) {
    return db.prepare(`
      SELECT * FROM items
      WHERE rarity = ?
      ORDER BY generated_at DESC
      LIMIT ?
    `).all(rarity, limit);
  }

  /**
   * Get items generated in a session
   */
  static getBySession(sessionId) {
    return db.prepare(`
      SELECT * FROM items
      WHERE generated_in_session_id = ?
      ORDER BY generated_at ASC
    `).all(sessionId);
  }

  /**
   * Get recently generated items
   */
  static getRecent(limit = 50) {
    return db.prepare(`
      SELECT * FROM items
      ORDER BY generated_at DESC
      LIMIT ?
    `).all(limit);
  }

  /**
   * Get item statistics
   */
  static getStatistics() {
    const total = db.prepare(`
      SELECT COUNT(*) as count FROM items
    `).get().count;

    const byRarity = db.prepare(`
      SELECT rarity, COUNT(*) as count
      FROM items
      GROUP BY rarity
      ORDER BY count DESC
    `).all();

    const avgPrice = db.prepare(`
      SELECT AVG(base_price_gp) as avg_price FROM items
    `).get().avg_price;

    const priceRange = db.prepare(`
      SELECT MIN(base_price_gp) as min_price, MAX(base_price_gp) as max_price
      FROM items
    `).get();

    return {
      total_items: total,
      by_rarity: byRarity,
      average_price: Math.round(avgPrice || 0),
      price_range: priceRange
    };
  }

  /**
   * Add item to player inventory
   * @param {number} itemId
   * @param {number} playerId
   * @param {number} purchasePrice
   * @param {string} sessionId
   * @returns {number} inventory_id
   */
  static addToInventory(itemId, playerId, purchasePrice, sessionId) {
    const insert = db.prepare(`
      INSERT INTO player_inventory (player_id, item_id, purchase_price_gp, purchased_in_session_id)
      VALUES (?, ?, ?, ?)
    `);

    const result = insert.run(playerId, itemId, purchasePrice, sessionId);

    console.log(`[DB] Added item ${itemId} to player ${playerId} inventory (inventory_id: ${result.lastInsertRowid})`);

    return result.lastInsertRowid;
  }

  /**
   * Get player's inventory
   */
  static getPlayerInventory(playerId, includeEquipped = true, includeSold = false) {
    let query = `
      SELECT
        inv.*,
        items.*,
        inv.purchase_price_gp as paid_price,
        items.base_price_gp as catalog_price
      FROM player_inventory inv
      JOIN items ON inv.item_id = items.item_id
      WHERE inv.player_id = ?
    `;

    const params = [playerId];

    if (!includeSold) {
      query += ` AND inv.sold = 0`;
    }

    query += ` ORDER BY inv.purchased_at DESC`;

    return db.prepare(query).all(...params);
  }

  /**
   * Get inventory item details
   */
  static getInventoryItem(inventoryId) {
    return db.prepare(`
      SELECT
        inv.*,
        items.*,
        inv.purchase_price_gp as paid_price,
        items.base_price_gp as catalog_price
      FROM player_inventory inv
      JOIN items ON inv.item_id = items.item_id
      WHERE inv.inventory_id = ?
    `).get(inventoryId);
  }

  /**
   * Equip an item
   */
  static equipItem(inventoryId, playerId) {
    // First unequip all items of the same type
    const item = Item.getInventoryItem(inventoryId);

    if (!item || item.player_id !== playerId) {
      throw new Error('Item not found or not owned by player');
    }

    db.prepare(`
      UPDATE player_inventory
      SET equipped = 1
      WHERE inventory_id = ? AND player_id = ?
    `).run(inventoryId, playerId);

    console.log(`[DB] Player ${playerId} equipped item ${inventoryId}`);
  }

  /**
   * Unequip an item
   */
  static unequipItem(inventoryId, playerId) {
    db.prepare(`
      UPDATE player_inventory
      SET equipped = 0
      WHERE inventory_id = ? AND player_id = ?
    `).run(inventoryId, playerId);

    console.log(`[DB] Player ${playerId} unequipped item ${inventoryId}`);
  }

  /**
   * Sell item back (marks as sold, doesn't delete)
   */
  static sellItem(inventoryId, playerId, salePrice) {
    const item = Item.getInventoryItem(inventoryId);

    if (!item || item.player_id !== playerId) {
      throw new Error('Item not found or not owned by player');
    }

    if (item.sold) {
      throw new Error('Item already sold');
    }

    db.prepare(`
      UPDATE player_inventory
      SET sold = 1,
          sold_at = CURRENT_TIMESTAMP,
          sold_price_gp = ?,
          equipped = 0
      WHERE inventory_id = ?
    `).run(salePrice, inventoryId);

    console.log(`[DB] Player ${playerId} sold item ${inventoryId} for ${salePrice} gp`);

    return Item.getInventoryItem(inventoryId);
  }

  /**
   * Get item count for player
   */
  static getPlayerItemCount(playerId, includeSold = false) {
    let query = `
      SELECT COUNT(*) as count
      FROM player_inventory
      WHERE player_id = ?
    `;

    if (!includeSold) {
      query += ` AND sold = 0`;
    }

    return db.prepare(query).get(playerId).count;
  }
}

module.exports = Item;