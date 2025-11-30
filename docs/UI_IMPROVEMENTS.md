# UI/UX Improvement Plans

This document outlines the new reaction-based UI architecture for the Crystal Ball Network bot, focusing on emoji-driven interactions, diegetic immersion, and persistent inventory threads.

---

## Architecture Overview

### Channel Structure

```
CRYSTAL BALL NETWORK (Category)
├── #welcome - Info about the bot
├── #about-cbn - Lore and technology
├── #crystal-ball-network - Diegetic portal (command entry point)
└── Private Threads:
    ├── search-[username]-[id] - Ephemeral shopping (24hr)
    ├── sell-[username]-[id] - Ephemeral selling (24hr, Phase 2)
    └── inventory-[username] - Persistent collection
```

### Core Principles

1. **One item per message** - Each item gets its own Discord message for clean reactions
2. **Emoji-driven** - React 🛒 to buy, 💰 to sell (no text commands during shopping)
3. **Diegetic immersion** - Flavor text creates atmosphere
4. **Persistent inventory** - Each player's collection lives in a permanent thread
5. **Ephemeral sessions** - Shopping/selling sessions auto-archive after 24hr

---

## Phase 1: Item Display & Purchasing (Current Priority)

### Crystal Ball Network Channel (#crystal-ball-network)

**Purpose:** Entry portal with diegetic flavor, accepts only `!search` command

**Persistent bot message:**
```markdown
🔮 **The Crystal Ball Network**

You approach an ornate crystal orb, its surface swirling with gray smoke and distant lights. As your fingers brush the cool glass, reality shifts around you. You find yourself standing in a vast, ethereal space—neither fully real nor entirely imagined.

A voice emanates from everywhere and nowhere:

*"Welcome, traveler. I am the Curator of Bewildering Networks. I can help you acquire wondrous items... or relieve you of those you no longer need. What brings you to my domain today?"*

**Available Commands:**
`!search` - Browse items for purchase

Type `!search` to begin your journey...
```

**Channel behavior:**
- User types `!search`
- Bot creates ephemeral thread: `search-[username]-[timestamp]`
- Bot posts brief confirmation, then deletes both user command and confirmation after 3 seconds
- Non-command messages are auto-deleted with gentle reminder
- Channel stays clean showing only the diegetic prompt

**Permissions:**
- Users can send messages (for commands)
- Bot manages message cleanup
- No conversations allowed (purely a transit point)

---

### Search Thread (Ephemeral Shopping Session)

**Thread name:** `search-[username]-[session-id]`
**Auto-archive:** 24 hours after last activity

**Initial greeting:**
```markdown
The smoky void coalesces into a comfortable study. Shelves lined with curious objects stretch into impossible distances. The voice speaks again:

*"Ah, seeking to expand your collection, are we? Splendid! Your current funds: **{balance} gp**. Now then, what manner of item catches your fancy today?"*

Describe what you're looking for, and I'll show you what I have in stock...
```

**Item Display Format - One Item Per Message:**

Each item appears as a separate message:

```markdown
**Garrett Thornshield's Bracers of Ogre Might**
*Wondrous item, uncommon (requires attunement)*

Heavy leather bracers reinforced with river iron studs, sized for smaller hands but radiating surprising power. The leather has aged well, maintaining flexibility despite decades of wear.

**History:** Worn by Garrett Thornshield, a halfling mercenary who earned fame defending merchant caravans through the Greycloak Hills. Despite his small stature, he once wrestled a hill giant to submission—these bracers made it possible.

**Properties:** While wearing these bracers, your Strength score becomes 19. If your Strength is already 19 or higher, the bracers have no effect. You must attune to these bracers to gain their benefit.

**Complication:** These bracers are sized for a Small creature. Medium or Large creatures can wear them, but they feel uncomfortably tight and may chafe during extended use.

**Price: 175 gp**
```

Bot immediately adds 🛒 reaction to each item message.

**Advantages:**
- Clean, scannable UI
- Easy to identify which item you want
- Reaction attached directly to item
- No ambiguity about what you're buying
- Can scroll to review items independently

**Multiple items:**
- User asks: "Show me strength items under 500 gold"
- Bot generates 3-5 items
- Each appears as separate message with 🛒
- User can browse, scroll, and react to any

---

### Purchase Flow

1. **User clicks 🛒 on an item message**
2. **Bot validates:**
   - Check player balance
   - Ensure item not already purchased
3. **Bot executes purchase:**
   - Deduct gold from player balance in database
   - Delete item message from search thread
   - Find/create player's inventory thread
   - Repost exact same item in inventory thread
   - Add 💰 reaction to inventory item (for future selling)
   - Update inventory thread header with new balance
   - Log transaction in database
4. **Bot sends confirmation in search thread:**
   ```markdown
   ✅ Purchase complete!

   You acquired: **Garrett Thornshield's Bracers of Ogre Might**
   Price: 175 gp

   New balance: 3,072 gp

   Check your inventory thread to see your collection!
   ```

**Error handling:**
```markdown
❌ Insufficient funds!

This item costs 8,000 gp but you only have 3,247 gp.

*"Ah, a fine eye for quality... but perhaps beyond your current means. Might I suggest something more... affordable?"*
```

---

### Inventory Thread (Persistent Collection)

**Thread name:** `inventory-[username]`
**Auto-archive:** Never (persistent)
**Created:** When player joins server (guildMemberAdd event)

**Initial header message:**
```markdown
📦 **Your Collection**

*Welcome to the Crystal Ball Network. This is your personal vault where all acquired items will appear.*

**Account Balance:** 500 gp
**Items Owned:** 0
**Collection Value:** 0 gp

---

Visit #crystal-ball-network and type `!search` to begin browsing items.

Items you purchase will appear below this message...
```

**After first purchase:**

Header updates to:
```markdown
📦 **Your Collection**

**Account Balance:** 325 gp
**Items Owned:** 1
**Collection Value:** 175 gp

---

Items appear below in purchase order (newest at bottom)...
```

**Item format in inventory:**

Same format as search thread, but with 💰 reaction instead of 🛒:

```markdown
**Garrett Thornshield's Bracers of Ogre Might**
*Wondrous item, uncommon (requires attunement)*
*Purchased for: 175 gp*

[Full item details...]
```

Bot adds 💰 reaction automatically.

**Sell reaction (Phase 1 - Stubbed):**
- User clicks 💰 on inventory item
- Bot logs to console: `[SELL] User @username clicked sell on item: Garrett's Bracers`
- No other action taken yet
- Phase 2 will create sell thread

---

## Phase 2: Selling System

### Sell Thread (Ephemeral Selling Session)

**Triggered by:** Clicking 💰 reaction on inventory item
**Thread name:** `sell-[username]-[session-id]`
**Auto-archive:** 24 hours after last activity

**Initial greeting:**
```markdown
The space shifts, becoming more austere—a merchant's appraisal room. Display cases line the walls.

*"So, looking to part with an acquisition? Very well. Let me appraise: **{item name}**..."*

*The Curator examines the item carefully, testing its weight and inspecting its enchantments.*

*"I can offer you **{price} gp** for this piece. It's a fair price, given current market conditions."*

React with ✅ to accept the offer, or ❌ to keep the item.
```

**Sell flow:**
1. User clicks 💰 on inventory item
2. Bot creates sell thread
3. Bot offers price (50% of purchase price? TBD)
4. User reacts ✅ to confirm or ❌ to cancel
5. If confirmed:
   - Add gold to player balance
   - Delete item from inventory thread
   - Update inventory header
   - Log transaction
6. Sell thread archives after completion

---

## Phase 4: Advanced UI Features

### Discord Embeds (Future Enhancement)

Replace markdown with color-coded embeds:

```javascript
const rarityColors = {
  common: 0x9E9E9E,      // Gray
  uncommon: 0x00FF00,    // Green
  rare: 0x0096FF,        // Blue
  'very rare': 0x9B59B6, // Purple
  legendary: 0xFF8C00,   // Orange
  artifact: 0xFFD700     // Gold
};

const embed = new EmbedBuilder()
  .setTitle('Garrett Thornshield\'s Bracers of Ogre Might')
  .setColor(rarityColors[item.rarity.toLowerCase()])
  .addFields(
    { name: 'Type', value: 'Wondrous item', inline: true },
    { name: 'Rarity', value: 'Uncommon', inline: true },
    { name: 'Price', value: '175 gp', inline: true },
    { name: 'Attunement', value: 'Required', inline: true },
    { name: 'Description', value: item.description },
    { name: 'History', value: item.history },
    { name: 'Properties', value: item.properties },
    { name: 'Complication', value: item.complication }
  )
  .setFooter({ text: 'React with 🛒 to purchase' });
```

**Advantages:**
- Visual rarity identification
- Professional appearance
- Can add thumbnails/images
- Better field organization

**Phase 4 implementation:**
- Keep one-item-per-message structure
- Replace markdown with embeds
- Maintain 🛒/💰 reactions

---

## Removed Features

### No Longer Implemented

❌ **Item numbering** - Not needed with one-item-per-message
❌ **"buy [number]" commands** - Replaced with emoji reactions
❌ **"inventory" command** - Inventory is a persistent thread
❌ **"balance" command** - Check inventory thread header
❌ **"equip" system** - This is a collection game, not combat
❌ **Info/trash reactions** - Simplified to just purchase/sell
❌ **Shopping cart** - Direct purchase is cleaner
❌ **Item comparison** - May revisit in Phase 5

---

## Summary of UI by Phase

### Phase 1 (Current)
- [x] Diegetic #crystal-ball-network portal channel
- [ ] !search creates ephemeral shopping thread
- [ ] One item per message with 🛒 reaction
- [ ] Persistent inventory threads (created on member join)
- [ ] 💰 reactions on inventory (stubbed, just console.log)
- [ ] Header message updates with balance

### Phase 2
- [ ] 💰 reaction creates sell thread
- [ ] Price negotiation in sell thread
- [ ] Item deletion from inventory after sale

### Phase 4
- [ ] Discord embeds with rarity colors
- [ ] Thumbnail images (AI-generated?)
- [ ] Enhanced field formatting
- [ ] Possible slash command integration

### Phase 5
- [ ] Collection statistics view
- [ ] Leaderboards
- [ ] Item search/filter in inventory
- [ ] Wishlist system

---

**Last Updated:** 2025-11-29
**Current Focus:** Phase 1 - Reaction-based purchasing with persistent inventory threads