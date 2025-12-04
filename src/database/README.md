# Crystal Ball Network Database

SQLite database layer for persistent account management and inventory.

## Structure

```
database/
├── db.js                   # Database connection and initialization
├── schema.sql              # Database schema (auto-executed on first run)
├── models/
│   ├── index.js           # Centralized exports
│   ├── Player.js          # Player accounts and balances
│   ├── Item.js            # Item catalog and inventory
│   └── InventoryThread.js # Inventory thread tracking
```

## Quick Start

```javascript
const { Player, Item, InventoryThread } = require('./database/models');

// Create or get a player
const player = Player.getOrCreate('discord_user_123', 'PlayerName', 500);

// Get player by Discord ID (always fetch fresh for balance)
const player = Player.getByDiscordId('discord_user_123');

// Create an item
const item = Item.create({
  name: 'Belt of Hill Giant Strength',
  itemType: 'Wondrous item',
  rarity: 'rare',
  description: 'A thick leather belt...',
  history: 'Forged by...',
  properties: 'Your Strength score is 21...',
  complication: 'The belt is cursed...'
}, 8000);

// Add to player inventory
Item.addToInventory(item.item_id, player.player_id, 8000);

// Deduct gold from player (on purchase)
Player.deductGold(player.player_id, 8000);

// Add gold to player (on sale)
Player.addGold(player.player_id, 7500);

// Get player inventory
const inventory = Item.getPlayerInventory(player.player_id);

// Remove item from inventory (on sale - keeps item record, deletes ownership link)
const result = Item.removeFromInventory(inventoryId, player.player_id);

// Find inventory item by name
const invItem = Item.findInventoryByName(player.player_id, 'Belt of Hill Giant Strength');
```

## Models

### Player
- `getOrCreate(discordUserId, username, startingBalance)` - Get existing or create new player
- `getById(playerId)` - Get player by ID
- `getByDiscordId(discordUserId)` - Get player by Discord ID
- `deductGold(playerId, amount)` - Deduct gold (with validation)
- `addGold(playerId, amount)` - Add gold (for sales)

### Item
- `create(itemData, priceGp)` - Add item to catalog
- `getById(itemId)` - Get item by ID
- `addToInventory(itemId, playerId, purchasePrice)` - Add to player inventory
- `getPlayerInventory(playerId, includeEquipped, includeSold)` - Get player's items
- `getInventoryItem(inventoryId)` - Get single inventory item with joined data
- `removeFromInventory(inventoryId, playerId)` - Delete ownership link (for sales)
- `findInventoryByName(playerId, itemName)` - Find item by name in player inventory
- `getStatistics()` - Get item statistics

### InventoryThread
- `create(playerId, discordThreadId, headerMessageId)` - Create inventory thread record
- `getByPlayerId(playerId)` - Get thread by player ID
- `getByDiscordThreadId(discordThreadId)` - Get by Discord thread ID

## Database Location

SQLite database file: `data/cbn.db`

## Schema Notes

The `transactions` and `shopping_sessions` tables exist in the schema for audit logging
and session tracking. Transaction records are created on purchases and sales.

## Backup

```bash
# Manual backup
cp data/cbn.db data/backups/cbn_$(date +%Y%m%d_%H%M%S).db

# Or use SQLite backup API (in code)
const db = require('./database/db');
db.backup('data/backups/backup.db');
```

## Migration Path

If you need to migrate to PostgreSQL later:

```bash
# Export
sqlite3 data/cbn.db .dump > backup.sql

# Import to PostgreSQL
psql cbn_database < backup.sql
```
