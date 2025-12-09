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

**Goal:** Commission custom items by gathering materials for craftsman NPCs

### 3.1 Crafting Flow
1. Player describes desired item to craftsman NPC
2. Craftsman quotes price and lists required materials (checklist)
3. Player acquires items matching criteria (buy, loot, trade)
4. Items are consumed when criteria met
5. Craftsman creates the commissioned item
6. Item added to inventory, thread locked

### 3.2 Craftsman NPCs
- [ ] Craftsman archetype for NPCs
- [ ] Each craftsman has specialties (weapons, armor, wondrous items)
- [ ] Trust level affects quality and pricing
- [ ] Can refuse commissions if trust too low

### 3.3 Material Gathering
- [ ] Criteria matching system ("any rare weapon", "dragon-related item")
- [ ] Track commission progress in database
- [ ] Multiple ways to acquire materials: buy, quest loot, trade

### 3.4 Thread Teardown System
- [ ] Unified teardown logic for: walk-away, completed sale, completed craft
- [ ] Pass thread to evaluation agent for stat changes
- [ ] Post summary (reputation change, alignment shift) before locking
- [ ] Consistent cleanup across all session types

---

## Phase 4: Adventuring & Quests

**Goal:** Send NPC adventurers on quests for profit and loot

### 4.1 Quest Board UI
- [ ] Design quest board channel/thread structure
- [ ] Quests appear with stated rewards ("10,000 gp on success")
- [ ] Hidden rewards possible ("killing the cube, Aldrich finds an item")
- [ ] Quest difficulty ratings

### 4.2 Adventurer NPCs
- [ ] Adventurer archetype for NPCs
- [ ] Track adventurer "inventory" (items you've given/sold them)
- [ ] Adventurer stats/capabilities affect quest success
- [ ] Party composition for harder quests

### 4.3 Quest Execution
- [ ] Quest "story" thread - simulation using D&D 5e rules
- [ ] AI narrates the adventure scene-by-scene
- [ ] Success/failure based on party gear and dice
- [ ] Loot generation on success
- [ ] Medical bills on failure (or death?)

### 4.4 Adventurer Relationships
- [ ] Talk with adventurers between quests
- [ ] Build trust and loyalty
- [ ] Risk of adventurer death on failed quests?
- [ ] Equip adventurers from your inventory

### 4.5 Economy Balance
- [ ] Questing should be slightly more profitable than item flipping
- [ ] But more complex and risky
- [ ] Creates demand for specific items (adventurer gear)
- [ ] Loot provides items you can't buy

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
2. **Quest UI:** How to display quest board? Separate channel? Thread per quest?
3. **Party Composition:** How many adventurers per quest? Player choice or auto-assigned?
4. **Death Mechanics:** Can adventurers die permanently? Resurrection costs?
5. **Alignment Effects:** What concrete gameplay effects does alignment have beyond NPC selection?
6. **Crafting Criteria:** How specific should material requirements be? Exact items or categories?

---

## Success Metrics

- **Phase 1:** Search-to-purchase feels instant and smooth
- **Phase 2:** Players recognize returning NPCs, alignment affects gameplay
- **Phase 3:** Players complete crafting commissions, trust system matters
- **Phase 4:** Players send adventurers on quests, loot economy works
- **Phase 5:** Players manage multi-party guilds, endgame content exists

---

**Last Updated:** 2025-12-05
**Current Phase:** Phase 1 - Performance & Polish
