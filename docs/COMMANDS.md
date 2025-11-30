# Command Reference

Complete guide to interacting with the Crystal Ball Network bot.

---

## Overview

The Crystal Ball Network uses a **minimal command** approach. Most interactions happen through natural language and emoji reactions rather than typed commands.

**Core interaction pattern:**
1. Join server → Inventory thread auto-created with 500gp
2. Go to #crystal-ball-network → Type `!search`
3. Browse items → React 🛒 to purchase
4. View collection in your inventory thread

---

## Server Setup Commands

### !bootstrap
**Location:** Any channel
**Permission:** Server owner only
**Description:** Creates or refreshes the CBN channel structure

Creates:
- "Crystal Ball Network" category
- `#welcome` - General information
- `#about-cbn` - Lore and technology
- `#crystal-ball-network` - Portal channel (command entry point)

Also sets the bot's nickname to "Crystal Ball Network"

**Example:**
```
!bootstrap
```

**Note:** After bootstrapping, the bot will post a persistent diegetic prompt in #crystal-ball-network explaining how to use the system.

---

## Shopping Commands

### !search
**Location:** `#crystal-ball-network` channel only
**Description:** Creates an ephemeral shopping session

What happens:
1. Bot creates a private thread: `search-[username]-[timestamp]`
2. Greeting message shows your current balance
3. You can describe what items you're looking for
4. Bot generates 3-5 unique items
5. Each item appears as a separate message with 🛒 reaction

**Example:**
```
User types in #crystal-ball-network:
!search

Bot creates thread and you can browse:
Show me strength items under 500 gold
I need a magic weapon for a rogue
Looking for uncommon items around 200 gp
```

**Thread lifetime:** Auto-archives after 24 hours of inactivity

---

## Emoji Interactions

### 🛒 Purchase Item
**Location:** Search threads
**Action:** React to any item message with 🛒 to purchase

What happens:
1. Bot checks your balance
2. If sufficient funds:
   - Deducts gold from your account
   - Deletes item from search thread
   - Posts item in your inventory thread
   - Adds 💰 reaction to inventory item
   - Updates your inventory header with new balance
3. If insufficient funds:
   - Bot sends error message with current balance

**No confirmation needed** - clicking 🛒 immediately purchases the item

---

### 💰 Sell Item (Phase 2 - Coming Soon)
**Location:** Inventory threads
**Action:** React to owned items with 💰 to sell

**Current behavior (Phase 1):**
- Click 💰 on any item in your inventory
- Bot logs the action to console
- No other effect yet

**Planned behavior (Phase 2):**
- Creates ephemeral sell thread
- Bot offers price based on item value
- React ✅ to confirm or ❌ to cancel
- Gold added to balance, item removed from inventory

---

## In-Session Commands

These commands work inside your search threads.

### Natural Language Shopping

Just describe what you're looking for:

**Examples:**
```
Show me strength items under 500 gold
I need a magic weapon for a rogue
What items increase Charisma?
Do you have any cloaks?
Looking for uncommon items around 200 gp
What can I afford with 300 gp?
```

The bot will generate 3-5 unique items matching your query. Each item appears as its own message with full details and a 🛒 reaction.

---

### !cost
**Location:** Any thread
**Description:** View API usage statistics for current session

Shows:
- Cost of last message
- Total session cost
- Message count
- Daily total spend
- Your lifetime cost

**Example:**
```
!cost

Session Statistics:
Message #5 cost: $0.023
Session total: $0.12
Daily total: $1.45
Your lifetime: $3.78
```

---

### !fast
**Location:** Search threads
**Description:** Switch to Claude Haiku (faster, cheaper)

Changes model for current session only. Haiku is good for quick browsing with lower cost.

**Costs:** $1/MTok input, $5/MTok output

**Example:**
```
!fast
Switched to Claude Haiku. Faster responses, lower cost.
```

---

### !fancy
**Location:** Search threads
**Description:** Switch to Claude Sonnet (highest quality)

Best item generation quality with richest descriptions.

**Costs:** $3/MTok input, $15/MTok output

**Example:**
```
!fancy
Switched to Claude Sonnet. Premium quality responses.
```

---

### !cheap
**Location:** Search threads
**Description:** Switch to GPT-4o-mini (lowest cost)

Requires OPENAI_API_KEY in .env file.

**Costs:** $0.25/MTok input, $2/MTok output

**Example:**
```
!cheap
Switched to GPT-4o-mini. Minimal cost mode.
```

---

## Your Inventory Thread

### Automatic Creation
When you join the server, the bot automatically creates a persistent private thread called `inventory-[yourname]`.

This thread contains:
- **Header message** with your current balance, item count, and collection value
- **All items you've purchased** (one per message, newest at bottom)
- **💰 reactions** on each item (for selling in Phase 2)

### Checking Your Balance
Simply scroll to the top of your inventory thread. The header message always shows:
```
📦 Your Collection

Account Balance: 325 gp
Items Owned: 3
Collection Value: 175 gp
```

This updates automatically after every purchase.

### Viewing Your Items
Scroll through your inventory thread to see all owned items. Each item message includes:
- Full item details (same as when you browsed it)
- "Purchased for: [price] gp" line
- 💰 reaction (for future selling)

---

## Removed/Obsolete Commands

These commands **no longer exist** in the new architecture:

❌ `!start` - Replaced by !search in #crystal-ball-network
❌ `!inventory` - Your inventory is a persistent thread
❌ `!balance` - Check your inventory thread header
❌ `!sell` - Use 💰 reaction on inventory items instead
❌ `buy [item]` - Use 🛒 reaction on search results
❌ `equip [item]` - Removed (this is a collection game, not combat)

---

## Command Summary Table

| Command | Location | Purpose |
|---------|----------|---------|
| `!bootstrap` | Any channel | Server setup (owner only) |
| `!search` | #crystal-ball-network | Start shopping session |
| `!cost` | Any thread | View API costs |
| `!fast` | Search threads | Switch to Haiku |
| `!fancy` | Search threads | Switch to Sonnet |
| `!cheap` | Search threads | Switch to GPT-4o-mini |
| 🛒 reaction | Search threads | Purchase item |
| 💰 reaction | Inventory threads | Sell item (Phase 2) |

---

## Tips

1. **Starting balance:** All new players start with 500 gp

2. **One item per message:** Each item gets its own message in search threads, making it easy to identify and purchase exactly what you want

3. **Instant purchase:** Clicking 🛒 immediately buys the item - no confirmation needed

4. **Persistent inventory:** Your inventory thread never archives - all your items are permanently saved there

5. **Multiple purchases:** You can buy multiple items in one search session - no need to create a new session each time

6. **Cost tracking:** Use `!cost` regularly to monitor API usage if you're concerned about costs

7. **Model switching:** Start with `!fancy` for best quality, or `!fast` if you want cheaper/faster responses

8. **Session cleanup:** Search threads auto-archive after 24 hours, keeping your thread list clean

---

## Getting Help

- Lost your inventory thread? Check your Discord threads sidebar
- Bot not responding? Ensure MESSAGE CONTENT INTENT is enabled in Discord Developer Portal
- Need to check balance? Open your inventory thread and look at the header
- Want to browse again? Go to #crystal-ball-network and type `!search`

---

**Last Updated:** 2025-11-29
**Current Phase:** Phase 1 - Reaction-based purchasing with persistent inventory