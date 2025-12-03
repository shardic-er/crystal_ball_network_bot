# CLAUDE.md

Technical reference for Claude Code and developers working on the Crystal Ball Network Discord bot.

## Project Overview

A **diegetic magic item collection game** where players interact with "The Curator" - an AI-powered interdimensional merchant. Players browse AI-generated D&D items, purchase with emoji reactions (🛒), and build persistent inventories.

**Phase 1 Complete:** Seamless search, reaction-based purchasing, persistent inventory, balance-aware personality.

## Quick Reference

```bash
npm install        # Install dependencies
npm run dev        # Development mode with auto-restart
npm start          # Production mode
```

**Key files:**
- `src/bot.js` - Main bot logic (1486 lines)
- `src/cbn_system_prompt.md` - The Curator's personality (editable without restart)
- `src/cbn_pricing_prompt.md` - Pricing framework (editable without restart)
- `src/database/` - SQLite database with models

## Architecture Patterns

### Channel Structure

```
CRYSTAL BALL NETWORK (Category)
├── #welcome - Game info
├── #crystal-ball-network - Main portal (users type search queries here)
├── #accounts - Container for inventory threads
└── Private Threads:
    ├── search-[username]-[query] - Ephemeral (1hr auto-archive)
    └── inventory-[username] - Persistent, locked, never archives
```

### Core Principles

1. **One item per message** - Each item is a separate Discord message with 🛒 reaction
2. **Diegetic immersion** - All interactions stay in-character
3. **Emoji-driven** - React 🛒 to buy (💰 for selling in Phase 2)
4. **Balance-aware personality** - Curator's tone scales with player wealth (obsequious → rude)
5. **Fixed 500gp start** - All players begin with same balance
6. **Database-driven** - Balance always fetched fresh from DB, never cached

### Player Flow

**On join:**
1. `guildMemberAdd` fires → Create `inventory-{username}` thread
2. `Player.getOrCreate(discordId, username, 500)` → Database entry
3. Post inventory header showing 500gp balance

**Search:**
1. User types in #crystal-ball-network (e.g., "magic swords")
2. Bot deletes message → Shows "Opening portal..." (auto-deletes 3s)
3. Creates `search-{username}-{query}` thread
4. Sends neutral "crystal ball shimmers..." then processes with AI
5. AI determines if query is a search or question
6. If search: generates 3-5 items (JSON), each posted as separate message with 🛒

**Purchase:**
1. User clicks 🛒 → Bot validates balance from DB
2. If sufficient: `Player.deductGold()` → `Item.create()` → `Item.addToInventory()` → `Transaction.create()`
3. Delete item from search thread → Repost in inventory with 💰
4. Edit inventory header with new balance

### Two-Shot Pricing System

Item generation is split into two API calls to optimize costs:

1. **Generation** (Haiku by default for searches): Creates items without prices
   - Returns JSON with `name`, `itemType`, `rarity`, `description`, `history`, `properties`, `complication`
   - Uses `src/cbn_system_prompt.md` for personality and item generation rules

2. **Pricing** (Always Haiku): Adds prices based on D&D 5e framework
   - Takes generated items JSON, returns same structure with `priceGp` added
   - Uses `src/cbn_pricing_prompt.md` for pricing rules
   - Applies discounts for complications

This separation allows creative generation to use any model while keeping pricing fast and cheap.

### Database Layer (SQLite)

**Location:** `data/cbn.db` (auto-created from `src/database/schema.sql`)

**Key tables:**
- `players` - Discord accounts with `account_balance_gp` (500gp start)
- `items` - Master catalog of all generated items
- `player_inventory` - Items owned by players (ignore `equipped` column)
- `transactions` - Complete audit log of purchases/sales

**Models:** `src/database/models/` - Player, Item, Transaction, ShoppingSession, InventoryThread

**Critical:** Balance is ALWAYS fetched fresh from database, never stored in session:
```javascript
const player = Player.getByDiscordId(session.playerId);
// Use player.account_balance_gp - do NOT cache this value
```

### Model Configuration

**Available models:**
- `haiku` (default for searches) - Claude Haiku 4.5 - $1/MTok in, $5/MTok out
- `sonnet` - Claude Sonnet 4.5 - $3/MTok in, $15/MTok out

**Switching:** Users can use `!fast` (haiku) or `!fancy` (sonnet) in search threads.

**Cost tracking:** All usage logged to `src/cost_tracking.json` with per-session, per-player, and daily totals.

## File Structure

```
src/
├── bot.js                       # Main bot (1486 lines)
├── cbn_system_prompt.md         # Curator personality
├── cbn_pricing_prompt.md        # Pricing rules
├── item_schema.json             # JSON schema for items
├── cbn_sessions.json            # Active sessions (playerId, messages, modelMode)
├── cost_tracking.json           # API costs (auto-generated)
├── database/
│   ├── db.js                    # SQLite connection (WAL mode)
│   ├── schema.sql               # Auto-executed on first run
│   ├── README.md                # Database docs
│   └── models/
│       ├── Player.js
│       ├── Item.js
│       ├── Transaction.js
│       ├── ShoppingSession.js
│       └── InventoryThread.js
├── discord_channel_templates/   # Channel content templates
│   ├── welcome.md
│   ├── accounts.md
│   └── crystal-ball-network.md
└── templates/
    └── inventory_header.md      # Dynamic inventory header
```

## Environment Variables

Required in `.env`:
- `DISCORD_TOKEN` - Bot token from Discord Developer Portal
- `CLAUDE_API_KEY` - Anthropic API key
- `MODEL_MODE` - Default model (`haiku` or `sonnet`)

**Discord bot requirements:**
- MESSAGE CONTENT INTENT (required)
- SERVER MEMBERS INTENT (required for inventory creation)
- Permissions: Manage Channels, Manage Messages, Create Threads, Add Reactions, Change Nickname

## Item Display Format

Each item is one Discord message with 🛒 reaction:

```markdown
**Garrett Thornshield's Bracers of Ogre Might**
*Wondrous item, uncommon (requires attunement)*

Heavy leather bracers reinforced with river iron studs...

**History:** Worn by Garrett Thornshield, a halfling mercenary...

**Properties:** While wearing these bracers, your Strength score becomes 19...

**Complication:** These bracers are sized for a Small creature...

**Price: 175 gp**
```

In inventory threads, includes `*Purchased for: 175 gp*` and has 💰 instead of 🛒.

## Inventory Thread Header

First message in each `inventory-{username}` thread, **edited** (not recreated) on balance changes:

```markdown
📦 **Your Collection**

*Welcome to the Crystal Ball Network. This is your personal vault where all acquired items will appear.*

**Account Balance:** 325 gp
**Items Owned:** 3
**Collection Value:** 450 gp

---

Visit #crystal-ball-network and type your search query to begin browsing items.

Items you purchase will appear below this message...
```

## Discord Commands

**In #crystal-ball-network:** Type search queries directly (no command needed)

**Admin:** `!bootstrap` (owner-only) - Setup/refresh server

**In search threads:**
- `!cost` - View API usage stats
- `!fast` - Switch to Haiku
- `!fancy` - Switch to Sonnet

## Common Pitfalls

1. **Don't cache balance** - Always fetch from DB: `Player.getByDiscordId(session.playerId)`
2. **Don't create multiple items per message** - Each item MUST be its own message
3. **Don't create inventory threads on search** - Created on member join only
4. **Don't edit header by creating new message** - Use `channel.messages.edit()`
5. **Don't bypass two-shot pricing** - Generation and pricing must stay separate
6. **Don't disable foreign keys** - SQLite foreign keys must stay enabled in db.js

## Database Usage Patterns

```javascript
const { Player, Item, Transaction } = require('./database/models');

// On member join
const player = Player.getOrCreate(discordId, username, 500);

// Before showing items (ALWAYS fetch fresh)
const player = Player.getByDiscordId(session.playerId);
await sendToClaudeAPI(messages, threadId, player.account_balance_gp);

// On purchase
if (player.account_balance_gp >= price) {
  Player.deductGold(player.player_id, price);
  const item = Item.create(itemData, price);
  Item.addToInventory(item.item_id, player.player_id, price);
  Transaction.create(player.player_id, 'purchase', -price, item.item_id);
}

// Get inventory
const items = Item.getPlayerInventory(playerId, true, false);
```

## Modifying Behavior

**Curator personality:** Edit `src/cbn_system_prompt.md` (takes effect immediately, no restart)

**Pricing logic:** Edit `src/cbn_pricing_prompt.md` (takes effect immediately, no restart)

**Database schema:** Edit `src/database/schema.sql` then delete `data/cbn.db` to recreate

**Balance tiers:** Edit personality thresholds in `src/cbn_system_prompt.md` lines 33-51

## Development Priorities

**Phase 1 (Complete):**
- ✅ Seamless search (direct queries, no commands)
- ✅ One-item-per-message display
- ✅ Emoji purchase flow (🛒)
- ✅ Persistent inventory with database
- ✅ Balance-aware personality

**Phase 2 (Next):**
- Selling system (💰 reaction in inventory)
- Price negotiation
- Transaction history viewing

**Phase 3+:** Crafting, UI improvements, advanced features

See [docs/ROADMAP.md](docs/ROADMAP.md) for complete roadmap.

## Testing Notes

- Use `!bootstrap` to recreate channels and inventory threads
- Database is in `data/cbn.db` - delete to reset
- Cost tracking in `src/cost_tracking.json` - persists between restarts
- Sessions in `src/cbn_sessions.json` - cleared on bot restart

## Further Reading

- [README.md](README.md) - User guide and setup instructions
- [docs/ROADMAP.md](docs/ROADMAP.md) - Development phases
- [docs/UI_IMPROVEMENTS.md](docs/UI_IMPROVEMENTS.md) - UI/UX planning
- [src/database/README.md](src/database/README.md) - Complete database documentation
