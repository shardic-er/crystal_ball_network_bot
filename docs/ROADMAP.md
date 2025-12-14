# Crystal Ball Network - Development Roadmap

## Vision

A diegetic D&D item shop simulator that evolves into an adventuring guild management game. Players start as shopkeepers - buying, selling, and crafting magic items through an AI-powered interdimensional merchant network. As they build reputation and relationships with NPCs, they unlock the ability to commission crafted items, recruit adventurers, and eventually manage a full adventuring guild that runs quests for profit and loot.

**Core Fantasy Progression:**
1. Shopkeeper - Buy low, sell high, build your collection
2. Craftsman's Patron - Commission custom items by gathering materials
3. Guild Manager - Equip adventurers, send them on quests, reap rewards (or pay medical bills)

---

## Current State (Implemented)

### Core Shopping Loop
- [x] Seamless search - type directly in #crystal-ball-network (no commands)
- [x] One-item-per-message with Discord embeds and rarity colors
- [x] Reaction-based purchasing (cart emoji)
- [x] Persistent inventory threads (scales emoji to initiate sale)
- [x] Balance-aware Curator personality

### NPC Buyer System
- [x] 3 AI-generated buyers with different offers per sale
- [x] Speech bubble to negotiate, moneybag to accept
- [x] Walk-away mechanic when player demands too much
- [x] Parallel pricing calls for natural variance between buyers

### Technical Foundation
- [x] SQLite database with players, items, inventory, transactions
- [x] Extended thinking for accurate D&D pricing
- [x] Time-based session expiry (1 hour)
- [x] Retry logic for API errors
- [x] Cost tracking per session/player/day

---

## Phase 1: Performance & Polish (Current)

**Goal:** Make the experience feel snappy and seamless

### 1.1 Speed Improvements
- [ ] Profile search flow - identify bottlenecks
- [ ] Consider caching common item types
- [ ] Optimize parallel API calls
- [ ] Reduce Discord API round-trips where possible

### 1.2 UX Refinements
- [ ] Better loading indicators during generation
- [ ] Clearer error messages
- [ ] Smoother thread creation flow
- [ ] Research auto-expiring ephemeral messages (currently we have a timeout function edit / delete messages, but ephemeral messages might allow thread creation confirmation messages to be sent to individual players without notifying other players. This has clear advantages, but currently ephemeral messages require the user to manually dismiss, as the bot lacks permission to remove them)

### 1.3 Targeted Buyer Prompt

**Goal:** Let players specify what kind of buyer they want before generating offers

Instead of immediately generating random buyers, add a prompt step where players can describe their ideal buyer. This rewards creativity - a "Potion of Plant Growth" might get standard offers from random buyers, but if you specify "an ent" or "a treant druid", the AI generates buyers that fit that concept and might value the item differently.

**Flow (update to existing sell flow):**
1. Player clicks scales on inventory item
2. Bot creates sell thread, shows item card
3. Bot asks: "Who are you trying to sell to? (Describe buyer type, or say 'anyone' for random buyers)"
4. Player types target (e.g., "an alchemist", "someone building a fire-resistant fortress", "an ent")
5. Bot generates 3 buyers matching that description
6. Rest of flow unchanged (moneybag to accept, speech bubble to negotiate)

**Implementation:**
- [ ] Add prompt step after thread creation
- [ ] Pass player's buyer description to buyer generation prompt
- [ ] "anyone" / "skip" / empty = current random behavior
- [ ] Buyer prompt includes player's description as constraint

**Benefits:**
- Minimal change to existing flow
- Rewards player creativity and game knowledge
- Natural stepping stone to full NPC pitch system in Phase 2
- Cursed items become opportunities ("infinite rust = infinite iron oxide for an alchemist")

### 1.4 Selection Flow System

**Goal:** Reusable UI pattern for "select N items/NPCs for a purpose" - foundation for crafting, quests, trading

Discord's select menus are limited to 25 options. This system handles pagination, multi-step selection, and validation in a clean message-per-step pattern.

**Pattern: Message-Per-Selection**

Each selection step is its own message. Pagination edits the message in-place.

```
┌─────────────────────────────────────────────────────┐
│ Select first item (1-25 of 56)                      │
│                                                     │
│ [Dropdown: 25 items]                                │
│                                                     │
│ [< Prev] [Next >]                                   │
└─────────────────────────────────────────────────────┘
          │
          │ user selects item
          v
┌─────────────────────────────────────────────────────┐
│ Select first item                                   │
│                                                     │
│ Selected: **Scroll of Silence**                     │
│                                                     │
│ [Change] [Confirm]                                  │
└─────────────────────────────────────────────────────┘
          │
          │ user confirms, bot posts NEW message
          v
┌─────────────────────────────────────────────────────┐
│ Select second item (1-25 of 55)                     │
│                                                     │
│ [Dropdown: excludes already-selected items]         │
│                                                     │
│ [< Prev] [Next >] [Back]                            │
└─────────────────────────────────────────────────────┘
```

**Use Cases This Enables:**

| Feature | Selections | Source | Notes |
|---------|------------|--------|-------|
| Experimental Crafting | 2 items | Inventory | Both consumed |
| Quest Party Assembly | 1-3 NPCs | Adventurer contacts | Filter by trust level |
| Commission Materials | 1 item per requirement | Inventory | Semantic validation |
| Future: Trading | N items | Inventory | To another player |

**Flow Definition Structure:**

```javascript
const experimentalCraftFlow = {
  type: 'experimental_craft',
  steps: [
    {
      prompt: 'Select first item',
      source: (player) => Item.getPlayerInventory(player.player_id),
      filter: null,
      required: true
    },
    {
      prompt: 'Select second item',
      source: (player) => Item.getPlayerInventory(player.player_id),
      filter: (item, selections) => !selections.includes(item.inventory_id),
      required: true
    }
  ],
  confirm: {
    prompt: 'Both items will be destroyed. This cannot be undone.',
    buttonLabel: 'Combine',
    onConfirm: async (playerId, selections) => { /* execute */ }
  }
};
```

**Key Features:**
- **Pre-filtering**: Source function can filter by trust, type, availability
- **Progressive exclusion**: Already-selected items excluded from later steps
- **Optional steps**: Skip button for "select 2nd adventurer (optional)"
- **Validation hooks**: Commission materials get semantic AI check before proceeding

**State Management:**

In-memory Map keyed by thread ID for quick flows (experimental crafting, quest party assembly). No database needed - selection is fast and no items are consumed until confirmation. If bot restarts mid-selection, user just restarts (a few clicks).

```javascript
const activeSelections = new Map();
// Key: threadId
// Value: { playerId, flowType, currentStep, selections[], page, messageId }
```

Commission material gathering is different - that's a long-running process (days/weeks) and uses the `commission_materials` table for persistence. The selection UI for commissions writes to DB immediately on each material submission.

**Implementation:**
- [ ] Build generic selection message renderer (dropdown + pagination buttons)
- [ ] Handle dropdown interaction -> update state, edit message or post next
- [ ] Handle pagination buttons -> edit message with new page
- [ ] Handle confirm/change/back buttons -> state transitions
- [ ] Add validation callback support for commission materials
- [ ] Test with experimental crafting flow (simplest case)

### 1.5 Item Showcase System

**Goal:** Let players publicly display prized items in a social, non-ephemeral thread

Players can showcase items from their inventory to a public thread where other players can see and discuss their collection. Creates social engagement and "show off" opportunities.

**Channel Structure:**
```
CRYSTAL BALL NETWORK (Category)
+-- #gallery-of-wonders          <-- NEW: Container for showcase threads
    +-- showcase-[username]       <-- Per-player, public, 7-day auto-archive
```

**Flow:**
1. Player clicks showcase emoji on item in inventory thread
2. Bot retrieves fresh item data from DB (by inventory_id, not text parsing)
3. If player has no showcase thread, create one in #gallery-of-wonders
   - Thread is public, unlocked, 7-day auto-archive (or max duration)
   - Named `showcase-[username]`
4. Post item card to showcase thread (no special reaction emojis)
5. In inventory thread:
   - Remove showcase emoji from item message
   - Remove bot's reaction
   - Add "un-showcase" emoji to item message
6. Track showcase in database (item_id -> showcase_message_id)

**Un-showcase Flow:**
1. Player clicks un-showcase emoji on item in inventory thread
2. Bot deletes the item message from showcase thread
3. Remove un-showcase emoji, re-add showcase emoji
4. Update database to remove showcase record

**On Item Sale:**
1. When item is sold via normal sell flow
2. Check if item is showcased
3. If showcased, delete message from showcase thread
4. Clean up showcase record in database

**Reaction Behavior:**
- Showcase emoji only works on inventory items that aren't already showcased
- Un-showcase emoji only works on inventory items that are showcased
- Clicking wrong emoji = no action (silent ignore)
- Items in showcase thread have no special reactions (social interactions work normally)

**Database Schema:**
```sql
-- Track showcased items
CREATE TABLE showcased_items (
  showcase_id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL,
  inventory_id INTEGER NOT NULL,
  showcase_message_id TEXT NOT NULL,  -- Discord message ID in showcase thread
  showcased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(player_id),
  FOREIGN KEY (inventory_id) REFERENCES player_inventory(inventory_id),
  UNIQUE(inventory_id)  -- Each item can only be showcased once
);

-- Track player showcase threads
CREATE TABLE showcase_threads (
  thread_id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL UNIQUE,
  discord_thread_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(player_id)
);
```

**Key Design Decisions:**
- Use item IDs for tracking, never text extraction or regex
- Fresh DB retrieval prevents stale data issues
- Public threads encourage social interaction
- 7-day archive keeps threads tidy without manual cleanup
- Selling auto-removes showcase (no orphaned displays)

**Implementation:**
- [ ] Create #gallery-of-wonders channel (add to bootstrap)
- [ ] Add showcase_threads and showcased_items tables to schema
- [ ] Add showcase emoji reaction handler
- [ ] Implement showcase thread creation (per-player, public, 7-day archive)
- [ ] Post item to showcase thread (no special emojis)
- [ ] Swap reactions on inventory item (showcase -> un-showcase)
- [ ] Add un-showcase emoji reaction handler
- [ ] Delete showcase message on un-showcase
- [ ] Hook into sell flow to remove showcased items on sale
- [ ] Add ShowcaseThread model (similar to InventoryThread)

---

## Phase 2: Persistent NPCs & Reputation

**Goal:** NPCs become memorable characters you build relationships with

### 2.1 NPC Database Schema
```sql
-- NPCs as first-class entities
CREATE TABLE npcs (
  npc_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  personality TEXT NOT NULL,      -- personality traits for consistent dialogue
  alignment TEXT NOT NULL,        -- 'lawful_good', 'chaotic_neutral', etc.
  archetype TEXT NOT NULL,        -- 'merchant', 'adventurer', 'craftsman'
  is_shopper BOOLEAN DEFAULT 0,   -- can appear as buyer
  is_adventurer BOOLEAN DEFAULT 0, -- can go on quests
  is_craftsman BOOLEAN DEFAULT 0, -- can craft items
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Player-NPC relationships
CREATE TABLE player_npcs (
  player_id INTEGER NOT NULL,
  npc_id INTEGER NOT NULL,
  trust_level INTEGER DEFAULT 0,  -- increases with successful deals
  times_met INTEGER DEFAULT 0,
  last_interaction DATETIME,
  PRIMARY KEY (player_id, npc_id)
);

-- Player alignment/reputation
ALTER TABLE players ADD COLUMN alignment_good_evil INTEGER DEFAULT 0;  -- negative = evil, positive = good
ALTER TABLE players ADD COLUMN alignment_lawful_chaotic INTEGER DEFAULT 0;  -- negative = chaotic, positive = lawful
ALTER TABLE players ADD COLUMN reputation INTEGER DEFAULT 0;  -- overall standing
```

### 2.2 Buyer/Reason Separation
- [ ] Separate NPC identity from "why they want the item"
- [ ] NPC personality drives negotiation style
- [ ] Purchase reason is generated per-interaction
- [ ] Same NPC can appear multiple times with different needs

### 2.3 Relationship System
- [ ] Track trust per player-NPC pair
- [ ] Walk-aways damage trust
- [ ] Successful sales build trust
- [ ] Higher trust = better offers, special requests

### 2.4 Alignment System
- [ ] Sales affect player alignment (+1/-1 good/evil, lawful/chaotic)
- [ ] Alignment based on: item type, NPC alignment, negotiation tactics
- [ ] Player alignment influences which NPCs appear
- [ ] Similar alignments more likely to be pulled from NPC cache

### 2.5 Familiar Faces
- [ ] Mix of new NPCs and returning characters
- [ ] Returning NPCs reference past deals
- [ ] Build a "contacts" list of NPCs you know

### 2.6 Targeted Sales (Pitch System)

**Goal:** Reward player creativity by letting them pitch items to specific NPCs

Instead of auto-soliciting random buyers, players can approach a known NPC with a specific item and make a pitch. This rewards game knowledge - an "Infinitely Rusty Dagger" might be worth 100gp as a cursed weapon, but 1000gp to an alchemist who sees it as an infinite iron oxide generator.

**Flow:**
1. Player opens contacts list (NPCs they know)
2. Player selects an NPC to approach
3. Player selects an item from inventory to discuss
4. Creates ephemeral pitch thread: `pitch-[username]-[npc]-[item]`
5. Item card injected into conversation context
6. Player makes their case via dialogue
7. NPC evaluates based on: pitch quality, their profession/needs, trust level
8. Normal negotiation/sale mechanics apply

**UI Challenge:** Cross-referencing contacts list with inventory
- Option A: Two-step selection (pick NPC, then pick item)
- Option B: "Pitch" button on inventory items -> shows list of contacts
- Option C: Conversation-driven ("I want to talk to Grimwald about the rusty dagger")

**Tool Chain:**
- [ ] Message scanner to detect item references
- [ ] Match against player inventory
- [ ] Inject item card into AI context
- [ ] NPC evaluates pitch based on their archetype/profession
- [ ] Higher trust = more willing to hear creative pitches

**Balance:**
- Targeted pitches can yield higher prices than random buyers
- But require: knowing the right NPC, building trust, making a good argument
- Failed pitches may damage trust ("You wasted my time with this junk")

---

## Phase 3: Crafting System

**Goal:** Two distinct crafting paths - commissioned high-end items from NPCs, and experimental combination crafting

### 3.1 Commissioned Crafting (High-End)

For powerful, specific items. Requires NPC relationships and material gathering.

**Flow:**
1. Player contacts a known craftsman NPC (from contacts list)
2. Plausibility check: Can this NPC make what you're asking for?
3. If plausible, craftsman quotes price and lists required materials
4. Materials are described abstractly (e.g., "Dragon Heart", "Essence of Silence")
5. Player provides items from inventory to satisfy requirements
6. Agent evaluates if provided items match criteria semantically
7. Some materials may require recursive commissions or quest loot
8. When all requirements met, craftsman creates the item
9. Items consumed, commissioned item added to inventory

**Material Matching Examples:**
- "Dragon Heart" - YES: "Drakthar's Phylactery: the still-beating heart of an immortal dragon"
- "Dragon Heart" - NO: "Heart-Shaped Dragon Cookies"
- "Essence of Silence" - YES: "Bottled Void from the Plane of Silence"
- "Essence of Silence" - NO: "Potion of Deafness"

**Requirements:**
- [ ] Contact known craftsman NPC (requires reputation from Phase 2)
- [ ] Plausibility agent: Can this NPC make this item?
- [ ] Material requirement generation (abstract descriptions)
- [ ] Semantic matching agent: Does this inventory item satisfy this requirement?
- [ ] Recursive commission support (material requires its own crafting)
- [ ] Trust level affects: willingness, pricing, not quality, never material flexibility

### 3.2 Experimental Crafting (Combination)

For creative, unpredictable results. Combine two items blindly and see what happens.

**Flow:**
1. Player selects two items from inventory
2. Bot sends both items to AI with no guidance on outcome
3. AI determines what combining them would produce
4. Result is unpredictable - could be amazing, useless, or dangerous
5. Both source items consumed, result added to inventory

**Example Outcomes:**
- Scroll of Silence + Scroll of Permanency -> "Scroll of Permanent Silence" (hoped for)
- Scroll of Silence + Scroll of Permanency -> "Scroll of Permanency, Metamagic: Silent" (can silently cast permanency)
- Scroll of Silence + Scroll of Permanency -> "Ruined Parchment" (failure)
- Potion of Fire Breath + Potion of Water Breathing -> "Potion of Steam Form"
- Potion of Fire Breath + Potion of Water Breathing -> "Potion of Fire Breathing"
- Potion of Fire Breath + Potion of Water Breathing -> "Potion of Billowing Smoke"
- Bag of Holding + Portable Hole -> Catastrophic failure (both destroyed, possible consequences)

**Design Notes:**
- No preview or confirmation - true blind combination
- Outcomes should be creative and follow item logic
- Failures should be possible but not dominant
- Dangerous combinations (Bag of Holding + Portable Hole) should have lore-accurate consequences
- This is gambling with items - high risk, potentially high reward
- Consider rolling dice 1%-100% on how 'good' the result is, and providing to the model in the request. I.e. give a result that score a 37% quality check.
- Possible future ways to boost this score via metagame progression / research tree.

**Implementation:**
- [ ] Two-item selection UI in inventory (how?)
- [ ] Combination prompt that encourages creative outcomes
- [ ] No hints about result before committing
- [ ] Failure/partial success possibilities
- [ ] Track combination history? (optional - for discovering "recipes")

### 3.3 Craftsman NPCs

- [ ] Craftsman archetype for NPCs (from Phase 2)
- [ ] Specialties: weapons, armor, wondrous items, potions, scrolls
- [ ] Trust level affects: willingness, pricing
- [ ] Can refuse commissions if trust too, complexity too high, or request implausible
- [ ] High-trust craftsmen may boost the dice roll, high alignment match with NPC may boost dice-roll

### 3.4 Database Schema

```sql
-- Active commissions
CREATE TABLE commissions (
  commission_id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL,
  npc_id INTEGER NOT NULL,
  requested_item TEXT NOT NULL,      -- What the player asked for -- Implication here is that the item is already generated and saved in DB as soon as it's requested, we just haven't formed the player_item relationship yet. Leaving it persisted, but in a 'pending' state.
  quoted_price INTEGER,              -- Gold cost (paid on completion)
  status TEXT DEFAULT 'pending',     -- 'pending', 'in_progress', 'complete', 'cancelled'
  created_at DATETIME,               -- not populated until the player actually completes the item
  FOREIGN KEY (player_id) REFERENCES players(player_id),
  FOREIGN KEY (npc_id) REFERENCES npcs(npc_id)
);

-- Materials required for a commission | is this table needed?
CREATE TABLE commission_materials (
  material_id INTEGER PRIMARY KEY,
  commission_id INTEGER NOT NULL,
  description TEXT NOT NULL,         -- "Dragon Heart", "Essence of Silence"
  satisfied_by INTEGER,              -- inventory_id of item that satisfied this
  satisfied_at DATETIME,
  FOREIGN KEY (commission_id) REFERENCES commissions(commission_id),
  FOREIGN KEY (satisfied_by) REFERENCES player_inventory(inventory_id)
);

-- Combination crafting history (optional) | again this might be okay to skip, and just do in memory
CREATE TABLE combinations (
  combination_id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL,
  item1_id INTEGER NOT NULL,
  item2_id INTEGER NOT NULL,
  result_id INTEGER,                 -- NULL if failure
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(player_id)
);
```

### 3.5 Thread Teardown System

- [ ] Unified teardown logic for: walk-away, completed sale, completed craft
- [ ] Pass thread to evaluation agent for stat changes
- [ ] Post summary (reputation change, alignment shift) before locking
- [ ] Consistent cleanup across all session types

---

## Phase 4: Adventuring & Quests

**Goal:** Send NPC adventurers on quests for profit and loot

### 4.1 Channel Structure

```
CRYSTAL BALL NETWORK (Category)
+-- #welcome
+-- #crystal-ball-network
+-- #accounts
+-- #quest-board              <-- NEW: Quest listings and party assembly
+-- Private Threads:
    +-- quest-[username]-[questslug]  <-- NEW: Active quest narratives
```

### 4.2 Quest Board
- [ ] #quest-board channel shows available quests
- [ ] Each quest displays: name, description, base gold reward, turn limit
- [ ] Player reacts to accept a quest
- [ ] Bot prompts for party assembly (select adventurer NPCs)
- [ ] Creates quest thread once party is confirmed

### 4.3 Adventurer NPCs & Equipment
- [ ] Adventurer archetype for NPCs (from Phase 2)
- [ ] Each adventurer tracks 3 "attuned" items (last 3 items sold to them)
- [ ] Attuned items appear in quest context, affect available options
- [ ] Items are key - narrator highlights when items enable solutions
- [ ] Payment model: TBD (flat fee, loot cut, trust-based, post-quest settlement)

### 4.4 Quest Execution

**Turn-Based Narrative:**
- Each turn = one message in the thread (caps context length naturally)
- Narrator shows `[Turn X of Y remaining]` in each message
- Player types free-form input OR sends party autonomously (gets summary at end)
- Combat abstracted: "The party engages - Harwick's Flame Tongue proves decisive. 2 turns consumed, minor injuries."
- Items matter more than stats for resolution

**Quest Thread State (survives restarts):**
- All state stored in database
- Bootstrap can regenerate thread from DB
- Regenerate react emoji on first message to rebuild thread if needed
- Abandoned quests auto-fail after timeout (24h?)

### 4.5 Quest File Structure

```markdown
# Quest Name

## Metadata
- turn_limit: 10
- base_reward: 75

## Description
[Posted on quest board - the hook for players]

## Library
[World bible - setting, NPCs, locations, tone]
[Always in narrator context]
[MUST specify to highlight when party items are relevant]

## Scenes
[Structured encounter flow for AI reference]

## Resolution Conditions
[What triggers success/partial/failure]

## Loot Table
[Possible items with conditions for earning them]
```

### 4.6 Death & Injury
- [ ] AI determines if adventurers are downed (0 HP) during quest
- [ ] Downed NPCs are disabled post-quest
- [ ] Player pays healing cost (react emoji) to restore them
- [ ] If not healed, NPC remains disabled (can't shop, can't quest)
- [ ] Permanent death possible for catastrophic failures?

### 4.7 Teardown Pipeline

When quest ends (resolution or turn limit reached), a multi-step pipeline processes the results:

**Step 1: Teardown Analysis** (`quest_teardown_prompt.md`)
- Input: Full quest transcript + quest metadata + party composition
- Determines: outcome (success/partial/failure)
- Outputs structured summary:
  ```
  **Quest Complete: [Quest Name]**
  **Outcome: [success/partial/failure]**

  **Gold Earned:**
  Base reward: X gp
  [Bonus condition]: Y gp
  **Total: Z gp**

  **Loot Obtained:**
  - [Item 1 name]
  - [Item 2 name]

  **Party Status:**
  - [NPC 1]: Fine
  - [NPC 2]: Injured (300 gp to heal), Item Lost (Flame Tongue)

  **Reputation Impact:**
  - [Event] (+1 Good / -1 Lawful / etc.)
  ```

**NPC Status Conditions:**
- Fine: No issues
- Injured: Requires healing gold (100-500 gp)
- Dead: Requires resurrection (1000+ gp)
- Item Lost: Attuned item destroyed/consumed (specify which)
- Shaken: Psychological trauma, requires intervention before next quest

**Step 2: Loot Generation** (`quest_loot_generator_prompt.md`, called per item)
- Input: Full transcript + teardown summary + "Generate stat block for: [Item Name]"
- Output: Full item JSON with quest-flavored history/complications
- Authoritative: Does NOT refuse or nerf items - quest rewards are earned
- More permissive than shop generator on power level

**Step 3: System Processing**
- Parse teardown summary
- Call loot generator for each item obtained
- Add generated items to player inventory
- Credit gold to player balance
- Update NPC status (disabled, disabled_reason)
- Apply alignment/reputation changes
- Mark quest as "cleared" if first completion
- Post summary to Discord, log to console

### 4.8 Database Schema

```sql
CREATE TABLE quests (
  quest_id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  turn_limit INTEGER DEFAULT 10,
  base_gold_reward INTEGER,
  quest_file_path TEXT
);

CREATE TABLE quest_runs (
  run_id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL,
  quest_id INTEGER NOT NULL,
  discord_thread_id TEXT NOT NULL,
  turns_remaining INTEGER NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  outcome TEXT,
  cleared BOOLEAN DEFAULT 0,
  FOREIGN KEY (player_id) REFERENCES players(player_id),
  FOREIGN KEY (quest_id) REFERENCES quests(quest_id)
);

CREATE TABLE quest_party (
  run_id INTEGER NOT NULL,
  npc_id INTEGER NOT NULL,
  status TEXT DEFAULT 'active',  -- 'active', 'downed', 'dead'
  PRIMARY KEY (run_id, npc_id),
  FOREIGN KEY (run_id) REFERENCES quest_runs(run_id),
  FOREIGN KEY (npc_id) REFERENCES npcs(npc_id)
);

CREATE TABLE quest_messages (
  message_id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  discord_message_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  role TEXT NOT NULL,             -- 'narrator', 'player'
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES quest_runs(run_id)
);

-- Add to npcs table (from Phase 2)
ALTER TABLE npcs ADD COLUMN disabled BOOLEAN DEFAULT 0;
ALTER TABLE npcs ADD COLUMN disabled_reason TEXT;
```

### 4.9 Economy Balance
- [ ] Questing should be slightly more profitable than item flipping
- [ ] But more complex and risky (adventurer injury costs)
- [ ] Creates demand for specific items (gear for adventurers)
- [ ] Loot provides items you can't buy through normal shopping
- [ ] Quests are replayable but "cleared" status tracked

---

## Phase 5: Guild Management (Endgame)

**Goal:** Graduate from shopkeeper to adventuring guild master

### 5.1 Guild Features
- [ ] Guild hall (dedicated channel structure)
- [ ] Multiple adventuring parties
- [ ] Simultaneous quests
- [ ] Guild reputation and rankings

### 5.2 Advanced Systems
- [ ] Adventurer recruitment and training
- [ ] Guild upgrades and investments
- [ ] Competing guilds?
- [ ] Seasonal events and legendary quests

### 5.3 Player-to-Player Features (Stretch)
- [ ] Trade items between players
- [ ] Shared guild membership?
- [ ] Leaderboards

---

## Technical Debt & Future Work

### URGENT: bot.js Refactoring
**Priority: HIGH** - bot.js has grown too large (2400+ lines) and needs modular extraction.

Proposed module structure:
```
src/
+-- bot.js                    # Entry point, Discord client setup, event routing
+-- handlers/
|   +-- search.js             # Search flow (message handling, AI calls)
|   +-- purchase.js           # Purchase reactions, inventory management
|   +-- sell.js               # Sell flow, buyer generation, negotiation
|   +-- craft.js              # Experimental crafting, synergy scoring
+-- services/
|   +-- claude.js             # AI client wrapper, cost tracking
|   +-- pricing.js            # Two-shot pricing system
|   +-- inventory.js          # Inventory thread management
+-- ui/
|   +-- selectionFlow.js      # Generic selection UI (already started)
|   +-- embeds.js             # Discord embed formatting
+-- utils/
    +-- prompts.js            # Prompt loading
    +-- session.js            # Session management
```

- [ ] Extract handlers into separate modules
- [ ] Create shared services layer
- [ ] Move selection flow to ui/
- [ ] Consolidate prompt loading
- [ ] Add proper exports/imports

### Database
- [ ] NPC tables and relationships
- [ ] Alignment tracking columns
- [ ] Commission/crafting progress tables
- [ ] Quest and adventurer state tables

### Architecture
- [ ] Unified thread teardown system
- [ ] Stat change evaluation agent
- [ ] NPC caching with alignment-based selection
- [ ] Quest simulation engine

### Performance
- [ ] Profile and optimize search flow
- [ ] Consider read replicas for high-traffic queries
- [ ] Caching layer for NPC data

---

## Open Design Questions

1. **Pitch UI:** How to cross-reference contacts with inventory? Two-step selection, pitch button, or conversation-driven?
2. **Adventurer Payment:** How do adventurers get paid for quests? Flat fee, loot cut, trust-based, or post-quest settlement?
3. **Alignment Effects:** What concrete gameplay effects does alignment have beyond NPC selection?
4. **Crafting Criteria:** How specific should material requirements be? Exact items or categories?
5. **Permanent Death:** Should catastrophic quest failures result in permanent NPC death, or just extended disability?

---

## Success Metrics

- **Phase 1:** Search-to-purchase feels instant and smooth
- **Phase 2:** Players recognize returning NPCs, alignment affects gameplay
- **Phase 3:** Players complete crafting commissions, trust system matters
- **Phase 4:** Players send adventurers on quests, loot economy works
- **Phase 5:** Players manage multi-party guilds, endgame content exists

---

**Last Updated:** 2025-12-14
**Current Phase:** Phase 1 - Performance & Polish
