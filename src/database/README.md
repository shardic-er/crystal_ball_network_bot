# Crystal Ball Network Database

SQLite database layer for persistent account management, inventory, and transactions.

## Structure

```
database/
├── db.js                   # Database connection and initialization
├── schema.sql              # Database schema (auto-executed on first run)
├── models/
│   ├── index.js           # Centralized exports
│   ├── Player.js          # Player accounts and balances
│   ├── ShoppingSession.js # Ephemeral shopping sessions
│   ├── Item.js            # Item catalog and inventory
│   └── Transaction.js     # Transaction logging and execution
```

## Quick Start

```javascript
const { Player, ShoppingSession, Item, Transaction } = require('./database/models');

// Create or get a player
const player = Player.getOrCreate('discord_user_123', 'PlayerName', 1234);

// Create a shopping session
const session = ShoppingSession.create(player.player_id, 'thread_abc_123');

// Cache search results
ShoppingSession.cacheSearchResults(session.session_id, 'strength items', [
  { name: 'Belt of Hill Giant Strength', priceGp: 8000, ...itemData },
  { name: 'Gauntlets of Ogre Power', priceGp: 175, ...itemData }
]);

// Execute a purchase (atomic transaction)
const purchase = Transaction.executePurchase(
  player.player_id,
  itemId,
  priceGp,
  session.session_id
);

// Get player inventory
const inventory = Item.getPlayerInventory(player.player_id);

// Lock session after purchase
ShoppingSession.lock(session.session_id, 'purchase');
```

## Models

### Player
- `getOrCreate(discordUserId, username, startingBalance)` - Get existing or create new player
- `getById(playerId)` - Get player by ID
- `getByDiscordId(discordUserId)` - Get player by Discord ID
- `updateBalance(playerId, newBalance)` - Update balance
- `addGold(playerId, amount)` - Add gold
- `deductGold(playerId, amount)` - Deduct gold (with validation)
- `getStats(playerId)` - Get player statistics
- `getLeaderboard(limit)` - Get top players by wealth

### ShoppingSession
- `create(playerId, discordThreadId)` - Create new session
- `getById(sessionId)` - Get session by ID
- `getByThreadId(threadId)` - Get session by Discord thread ID
- `updateActivity(sessionId)` - Update last activity timestamp
- `cacheSearchResults(sessionId, query, items)` - Cache search results
- `getCachedSearchResults(sessionId)` - Get cached results (expires after 30min)
- `lock(sessionId, reason)` - Lock session (becomes read-only)
- `expire(sessionId)` - Mark as expired
- `findExpired(inactivityMinutes)` - Find sessions to expire
- `getPlayerHistory(playerId, limit)` - Get session history

### Item
- `create(itemData, priceGp, sessionId, playerId)` - Add item to catalog
- `getById(itemId)` - Get item by ID
- `searchByName(searchTerm, limit)` - Search by name
- `getByRarity(rarity, limit)` - Get by rarity
- `addToInventory(itemId, playerId, purchasePrice, sessionId)` - Add to player inventory
- `getPlayerInventory(playerId, includeEquipped, includeSold)` - Get player's items
- `equipItem(inventoryId, playerId)` - Mark as equipped
- `unequipItem(inventoryId, playerId)` - Unequip
- `sellItem(inventoryId, playerId, salePrice)` - Sell back to CBN
- `getStatistics()` - Get item statistics

### Transaction
- `create(transactionData)` - Record a transaction
- `executePurchase(playerId, itemId, priceGp, sessionId)` - Atomic purchase
- `executeSale(playerId, inventoryId, salePrice)` - Atomic sale
- `getPlayerHistory(playerId, limit, offset)` - Get transaction history
- `getByType(playerId, transactionType, limit)` - Filter by type
- `getPlayerSummary(playerId)` - Get summary statistics
- `getStatistics()` - Get global statistics

## Database Location

SQLite database file: `data/cbn.db`

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

## Session Expiry

Sessions automatically expire after 30 minutes of inactivity. Implement this in bot.js:

```javascript
// Run every 5 minutes
setInterval(async () => {
  const expired = ShoppingSession.findExpired(30);

  for (const session of expired) {
    await lockDiscordThread(session.discord_thread_id);
    ShoppingSession.expire(session.session_id);
  }
}, 5 * 60 * 1000);
```