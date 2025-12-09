const db = require('../db');

class Item {
  /**
   * Create a new item in the catalog
   * @param {Object} itemData - Item properties from JSON
   * @param {number} priceGp - Final price in gold pieces
   * @returns {Object} Created item
   */
  static create(itemData, priceGp) {
    // Validate that itemData is an object
    if (typeof itemData !== 'object' || itemData === null) {
      console.error('[DB ERROR] itemData is not an object:', itemData);
      throw new Error('itemData must be an object');
    }

    // Log the data being inserted for debugging
    console.log('[DB] Creating item:', {
      name: itemData.name,
      itemType: itemData.itemType,
      rarity: itemData.rarity,
      priceGp: priceGp
    });

    const insert = db.prepare(`
      INSERT INTO items (
        name, item_type, rarity, requires_attunement, attunement_requirement,
        description, history, properties, complication, base_price_gp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const params = [
      itemData.name,
      itemData.itemType,
      itemData.rarity,
      itemData.requiresAttunement ? 1 : 0,
      itemData.attunementRequirement || null,
      itemData.description,
      itemData.history,
      itemData.properties,
      itemData.complication,
      priceGp
    ];

    // Validate all params are bindable types
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      const type = typeof param;
      if (param !== null && type !== 'string' && type !== 'number' && type !== 'bigint' && !Buffer.isBuffer(param)) {
        console.error(`[DB ERROR] Parameter at index ${i} has invalid type:`, type, param);
        throw new Error(`Parameter at index ${i} is type ${type}, expected string/number/bigint/buffer/null`);
      }
    }

    const result = insert.run(...params);

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
   * @param {string} discordMessageId - ID of the item message in inventory thread
   * @returns {number} inventory_id
   */
  static addToInventory(itemId, playerId, purchasePrice, discordMessageId) {
    const insert = db.prepare(`
      INSERT INTO player_inventory (player_id, item_id, purchase_price_gp, discord_message_id)
      VALUES (?, ?, ?, ?)
    `);

    const result = insert.run(playerId, itemId, purchasePrice, discordMessageId);

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
   * Get inventory item by Discord message ID
   * @param {string} discordMessageId - Discord message ID
   * @returns {Object|null} Inventory item with joined item data
   */
  static getByMessageId(discordMessageId) {
    return db.prepare(`
      SELECT
        inv.*,
        items.*,
        inv.purchase_price_gp as paid_price,
        items.base_price_gp as catalog_price
      FROM player_inventory inv
      JOIN items ON inv.item_id = items.item_id
      WHERE inv.discord_message_id = ?
    `).get(discordMessageId);
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

  /**
   * Remove item from player inventory (deletes the link, keeps item in items table)
   * Used when selling items to NPCs
   * @param {number} inventoryId - The inventory record ID
   * @param {number} playerId - Player ID for ownership verification
   * @returns {Object} { success: boolean, itemId: number }
   */
  static removeFromInventory(inventoryId, playerId) {
    // First verify ownership
    const item = Item.getInventoryItem(inventoryId);

    if (!item) {
      throw new Error(`Inventory item ${inventoryId} not found`);
    }

    if (item.player_id !== playerId) {
      throw new Error(`Item ${inventoryId} is not owned by player ${playerId}`);
    }

    if (item.sold) {
      throw new Error(`Item ${inventoryId} has already been sold`);
    }

    // Delete the inventory record (orphan the item)
    const result = db.prepare(`
      DELETE FROM player_inventory
      WHERE inventory_id = ? AND player_id = ?
    `).run(inventoryId, playerId);

    if (result.changes === 0) {
      throw new Error(`Failed to remove item ${inventoryId} from inventory`);
    }

    console.log(`[DB] Removed item ${item.item_id} from player ${playerId} inventory (inventory_id: ${inventoryId})`);

    return {
      success: true,
      itemId: item.item_id,
      itemName: item.name
    };
  }

  /**
   * Find inventory item by item name for a player
   * Used when we need to look up an item from a Discord message
   * @param {number} playerId
   * @param {string} itemName
   * @returns {Object|null} Inventory item with joined data
   */
  static findInventoryByName(playerId, itemName) {
    return db.prepare(`
      SELECT
        inv.*,
        items.*,
        inv.purchase_price_gp as paid_price,
        items.base_price_gp as catalog_price
      FROM player_inventory inv
      JOIN items ON inv.item_id = items.item_id
      WHERE inv.player_id = ? AND items.name = ? AND inv.sold = 0
      LIMIT 1
    `).get(playerId, itemName);
  }
}

module.exports = Item;