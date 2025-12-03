# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Discord bot that creates a **diegetic magic item collection game** powered by Claude AI. Players interact with the "Crystal Ball Network" - a mysterious interdimensional merchant - through emoji reactions and persistent inventory threads.

### Current Development Phase: Phase 1 Complete

Core collection game is functional. Players browse items by typing search queries directly in #crystal-ball-network, purchase with 🛒 emoji reactions, and build persistent inventories.

**Working features:**
- One-command setup with `!bootstrap`
- Auto-inventory creation on member join (500gp starting balance)
- Ephemeral search threads (1hr auto-archive)
- AI-generated items with two-shot pricing
- Optional budget filtering via `filterByBudget` JSON field
- Emoji purchases (🛒) with balance validation
- Locked read-only inventory threads
- Balance-aware personality (rude when broke, obsequious when rich)

See [docs/ROADMAP.md](docs/ROADMAP.md) for Phase 2+ features.

## Development Commands

```bash
# Install dependencies
npm install

# Run in development (auto-restart on changes)
npm run dev

# Run in production
npm start
```

## Key Architecture Patterns

### Channel Structure

```
CRYSTAL BALL NETWORK (Category)
├── #welcome - Info about the bot
├── #crystal-ball-network - Diegetic portal (accepts direct search queries)
└── Private Threads:
    ├── search-[username]-[id] - Ephemeral shopping (1hr auto-archive)
    ├── inventory-[username] - Persistent collection (locked, never archives)
    └── sell-[username]-[id] - Ephemeral selling (Phase 2)
```

### Core Principles

1. **Diegetic immersion** - Split greeting (static intro + AI-generated balance-aware message)
2. **One item per message** - Each item gets its own Discord message with emoji reaction
3. **Emoji-driven interactions** - React 🛒 to buy, 💰 to sell (Phase 2)
4. **Locked inventory threads** - Read-only display of player collections
5. **Optional budget filtering** - Claude sets `filterByBudget: true` in JSON when requested
6. **Fixed starting balance** - All players start with 500gp
7. **Comedic personality tiers** - Rudeness scales with poverty for entertainment

### Player Onboarding Flow

When a player joins the server (`guildMemberAdd` event):

1. Bot detects new member
2. Bot creates persistent private thread: `inventory-[username]`
3. Bot creates player in database with `Player.getOrCreate(discordId, username, 500)`
4. Bot posts header message in inventory thread showing 500gp balance
5. Player can immediately go to #crystal-ball-network and type a search query

**Critical:** Inventory threads are created on join, NOT on first search.

### Shopping Flow

**Step 1: Enter portal**
- User types search query directly in #crystal-ball-network channel (e.g., "magic swords")
- Bot deletes user's message immediately
- Bot creates ephemeral thread: `search-[username]-[query]`
- Bot posts brief "Opening search portal" confirmation in channel, then deletes after 3 seconds
- Channel stays clean showing only diegetic prompt

**Step 2: Browse items**
- Bot posts greeting in search thread with player's current balance
- User describes what they want: "Show me strength items under 500 gold"
- Bot generates 3-5 items via Claude AI
- **Each item appears as separate message** with 🛒 reaction

**Step 3: Purchase**
- User clicks 🛒 on item message
- Bot validates balance
- If sufficient funds:
  - Deduct gold from database
  - Delete item from search thread
  - Repost item in player's inventory thread
  - Add 💰 reaction to inventory item
  - Update inventory header with new balance
  - Log transaction

**Step 4: View collection**
- Player opens their `inventory-[username]` thread
- Header shows current balance, item count, collection value
- All purchased items appear below (one per message, newest at bottom)

### Two-Shot Pricing System

Item generation uses a two-model approach (bot.js:491-574):
1. Main model (Sonnet/Haiku/GPT-4o-mini) generates items with JSON structure (no prices)
2. Pricing model (always Haiku or GPT-4o-mini) adds prices in separate API call
3. `addPricingToItems()` function handles the second shot
4. Pricing prompt in `src/cbn_pricing_prompt.md` contains D&D 5e pricing framework

This separation allows main model to focus on creative generation while cheap model handles price calculation based on rarity and complications.

### Database Layer (SQLite)

Persistent storage structure in `src/database/`:
- `db.js` - Database connection with WAL mode enabled
- `schema.sql` - Auto-executed on first run, creates tables
- `models/` - Data access layer with methods for each entity

Key tables:
- `players` - Discord user accounts with balances (500gp starting balance)
- `shopping_sessions` - Ephemeral browsing sessions (needs `session_type` column)
- `items` - Master catalog of generated items
- `player_inventory` - Items owned by players (ignore `equipped` column)
- `transactions` - Complete audit log

Database file location: `data/cbn.db` (auto-created)

### Item Display Format

**Critical change:** One item per message, not multiple items in one message.

Each item appears as:
```markdown
**Garrett Thornshield's Bracers of Ogre Might**
*Wondrous item, uncommon (requires attunement)*

Heavy leather bracers reinforced with river iron studs, sized for smaller hands but radiating surprising power...

**History:** Worn by Garrett Thornshield, a halfling mercenary...

**Properties:** While wearing these bracers, your Strength score becomes 19...

**Complication:** These bracers are sized for a Small creature...

**Price: 175 gp**
```

Bot immediately adds 🛒 reaction.

In inventory threads, format is identical but includes:
```markdown
*Purchased for: 175 gp*
```

And has 💰 reaction instead of 🛒.

### Inventory Thread Header

The first message in each inventory thread is a header that updates after every purchase:

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

Bot must **edit this message** when balance changes, NOT create a new message.

### Multi-Provider AI Support

The bot supports three model configurations (bot.js:34-63):
- **sonnet**: Claude Sonnet 4.5 (Anthropic) - $3/MTok input, $15/MTok output
- **haiku**: Claude Haiku 4.5 (Anthropic) - $1/MTok input, $5/MTok output
- **cheap**: GPT-4o-mini (OpenAI) - $0.25/MTok input, $2/MTok output

Users can switch models mid-session with `!fast`, `!fancy`, or `!cheap` commands. The `sendToClaudeAPI()` function (bot.js:379-423) routes to the appropriate provider based on `session.modelMode`.

### Cost Tracking System

Cost tracking prevents NaN issues with validation:
- `validateModelConfig()` checks all configs on startup (bot.js:65-87)
- `calculateCost()` computes costs including cache tokens (bot.js:258-265)
- `trackCost()` validates results and throws if NaN detected (bot.js:272-362)
- Tracks per-session, per-player, and per-day spending
- Daily budget limits enforced before processing messages
- All cost data saved to `src/cost_tracking.json`

## File Structure

```
src/
├── bot.js                          # Main bot logic (needs refactoring)
├── cbn_system_prompt.md            # CBN personality and instructions
├── cbn_pricing_prompt.md           # Pricing framework for second shot
├── item_schema.json                # JSON schema for item structure
├── cbn_sessions.json               # Session storage (being phased out)
├── cost_tracking.json              # API cost tracking (auto-created)
├── database/
│   ├── db.js                       # Database connection
│   ├── schema.sql                  # Table definitions (needs session_type)
│   ├── README.md                   # Database documentation
│   └── models/
│       ├── index.js                # Centralized exports
│       ├── Player.js               # Player accounts
│       ├── ShoppingSession.js      # Ephemeral sessions
│       ├── Item.js                 # Item catalog
│       └── Transaction.js          # Transaction logging
└── discord_channel_templates/
    ├── welcome.md
    ├── about-cbn.md
    └── crystal-ball-network.md     # (needs creation)
```

## Environment Configuration

Required in `.env`:
- `DISCORD_TOKEN`: Bot token from Discord Developer Portal
- `CLAUDE_API_KEY`: Anthropic API key
- `OPENAI_API_KEY`: (Optional) Only needed for `!cheap` mode
- `MODEL_MODE`: Default model (sonnet/haiku/cheap)

Critical Discord bot permissions:
- MESSAGE CONTENT INTENT (must be enabled in Developer Portal)
- SERVER MEMBERS INTENT (must be enabled in Developer Portal - needed for guildMemberAdd)
- Manage Channels, Manage Messages, Create Threads, Change Nickname

## Message Flow (New Architecture)

**Player joins server:**
1. `guildMemberAdd` event fires
2. Bot creates `inventory-[username]` thread
3. Bot creates player in database with 500gp
4. Bot posts header message in inventory thread

**Player starts shopping:**
1. User types search query directly in #crystal-ball-network channel (e.g., "magic swords")
2. Bot deletes user's message immediately
3. Bot creates `search-[username]-[query]` thread
4. Bot posts balance-aware "searching" message immediately
5. Bot calls `sendToClaudeAPI()` with search query
6. Claude generates items (JSON format)
7. Bot calls `addPricingToItems()` for second shot
8. **Bot sends each item as separate message with 🛒 reaction**

**Player purchases item:**
1. User reacts 🛒 to item message
2. Bot detects `messageReactionAdd` event
3. Bot validates balance via database
4. If sufficient:
   - `Player.deductGold(playerId, price)`
   - `Item.create()` to store item in catalog
   - `Item.addToInventory()` to add to player's collection
   - `Transaction.create()` to log purchase
   - Delete item message from search thread
   - Repost item in inventory thread with 💰 reaction
   - Edit inventory header with new balance
5. If insufficient:
   - Send error message in search thread

**Player sells item (Phase 2):**
1. User reacts 💰 to item in inventory thread
2. Bot creates `sell-[username]-[timestamp]` thread
3. Bot offers price
4. User accepts/declines
5. Gold added, item deleted, transaction logged

## Common Pitfalls

1. **Don't create multiple items per message**: Each item MUST be its own Discord message
2. **Don't create inventory threads on search**: Inventory threads created on member join
3. **Don't use Benford's Law**: Fixed 500gp starting balance for all players
4. **Don't implement equipping**: This is a collection game, not combat
5. **Don't skip member join handler**: Critical for inventory creation
6. **Don't forget to add 🛒/💰 reactions**: Items without reactions can't be purchased/sold
7. **Don't create new header messages**: Edit existing header when balance changes
8. **Don't remove cost validation**: The NaN checks prevent tracking failures
9. **Don't bypass two-shot pricing**: Item generation and pricing are separate for cost optimization
10. **Don't disable foreign keys**: SQLite foreign keys must stay enabled (db.js:19)

## Development Priorities

When implementing new features, follow this priority order:

1. **Phase 1 (Completed):** Reaction-based purchasing
   - ✅ Update !bootstrap for #crystal-ball-network channel
   - ✅ Implement guildMemberAdd for inventory creation
   - ✅ Implement seamless search (direct queries, no command needed)
   - ✅ Refactor to one-item-per-message display
   - ✅ Add 🛒 reaction handler
   - ✅ Move items between threads on purchase
   - ✅ Update inventory headers

2. **Phase 2:** Selling system
   - Implement 💰 reaction handler
   - Create sell threads with price negotiation

3. **Phase 3:** Crafting system

4. **Phase 4:** UI/UX improvements (Discord embeds, slash commands)

5. **Phase 5:** Advanced RPG features

See [docs/ROADMAP.md](docs/ROADMAP.md) for complete details on each phase.

## Modifying CBN Behavior

To change item generation or personality:
- Edit `src/cbn_system_prompt.md`
- Changes take effect immediately (prompt loaded on each request)
- No need to restart bot for prompt changes

To change pricing logic:
- Edit `src/cbn_pricing_prompt.md`
- Changes take effect immediately
- No need to restart bot

To modify database schema:
- Edit `src/database/schema.sql`
- Add migration for session_type column
- Or delete `data/cbn.db` to force re-initialization

## Discord Commands

**In #crystal-ball-network channel:**
- Type any search query directly (e.g., "magic swords", "healing potions")

**In any channel (admin):**
- `!bootstrap` - (Owner only) Create/refresh category and channels

**In search threads:**
- `!cost` - View API usage statistics
- `!fast` - Switch to Claude Haiku
- `!fancy` - Switch to Claude Sonnet
- `!cheap` - Switch to GPT-4o-mini

**Emoji reactions:**
- 🛒 - Purchase item (in search threads)
- 💰 - Sell item (in inventory threads, Phase 2)

**Removed commands:**
- ❌ `!search` - Replaced by direct search queries
- ❌ `!start` - Replaced by direct search queries
- ❌ `!inventory` - Inventory is a persistent thread
- ❌ `!balance` - Check inventory thread header
- ❌ `!sell` - Use 💰 reaction instead
- ❌ `buy [item]` - Use 🛒 reaction instead

## Database Usage Patterns

```javascript
const { Player, ShoppingSession, Item, Transaction } = require('./database/models');

// Create player on member join
const player = Player.getOrCreate(discordUserId, username, 500);

// Create search session
const session = ShoppingSession.create(player.player_id, threadId, 'search');

// Store generated item
const item = Item.create(itemData, priceGp, sessionId, playerId);

// Purchase flow
const player = Player.getByDiscordId(discordUserId);
if (player.account_balance_gp >= price) {
  Player.deductGold(player.player_id, price);
  const inventoryId = Item.addToInventory(itemId, player.player_id, price, sessionId);
  Transaction.create(player.player_id, 'purchase', -price, itemId, sessionId);
}

// Get inventory for display
const items = Item.getPlayerInventory(playerId, true, false);

// Update player balance in header
const updatedPlayer = Player.getById(playerId);
// Edit inventory thread header with updatedPlayer.account_balance_gp
```

Refer to `src/database/README.md` for complete model API documentation.

## Diegetic Text Templates

### Crystal Ball Network Channel Prompt

```markdown
🔮 **The Crystal Ball Network**

You approach an ornate crystal orb, its surface swirling with gray smoke and distant lights. As your fingers brush the cool glass, reality shifts around you. You find yourself standing in a vast, ethereal space—neither fully real nor entirely imagined.

A voice emanates from everywhere and nowhere:

*"Welcome, traveler. I am the Curator of Bewildering Networks. I can help you acquire wondrous items... or relieve you of those you no longer need. What brings you to my domain today?"*

**How to Use:**
Simply type what you're looking for in this channel. The Curator will create a private browsing session and show you matching items.

**Examples:**
- `magic swords`
- `healing potions`
- `items for a wizard`
- `cheap uncommon items`

The crystal ball awaits your command...
```

### Search Thread Greeting

```markdown
The smoky void coalesces into a comfortable study. Shelves lined with curious objects stretch into impossible distances. The voice speaks again:

*"Ah, seeking to expand your collection, are we? Splendid! Your current funds: **{balance} gp**. Now then, what manner of item catches your fancy today?"*

Describe what you're looking for, and I'll show you what I have in stock...
```

### Inventory Thread Header

```markdown
📦 **Your Collection**

*Welcome to the Crystal Ball Network. This is your personal vault where all acquired items will appear.*

**Account Balance:** {balance} gp
**Items Owned:** {count}
**Collection Value:** {value} gp

---

Visit #crystal-ball-network and type your search query to begin browsing items.

Items you purchase will appear below this message...
```

## Testing

For local testing without waiting for members to join:
1. Manually call the inventory creation function with your Discord ID
2. Or temporarily trigger it on any message in a test channel
3. Remember to restore proper guildMemberAdd handler before deployment

## Further Reading

- [docs/ROADMAP.md](docs/ROADMAP.md) - Development phases and timeline
- [docs/UI_IMPROVEMENTS.md](docs/UI_IMPROVEMENTS.md) - Detailed UI/UX specifications
- [docs/COMMANDS.md](docs/COMMANDS.md) - User-facing command reference
- [src/database/README.md](src/database/README.md) - Database schema and model documentation