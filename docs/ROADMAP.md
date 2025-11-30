# Crystal Ball Network - Development Roadmap

## Project Vision

Transform CBN into a **diegetic magic item shop simulator** where players browse, collect, and eventually sell D&D magic items through an immersive Discord experience. Players interact with the "Crystal Ball Network" - a mysterious interdimensional merchant - through reaction-based UI and persistent inventory threads.

## Current Status: Architecture Redesign Phase

The bot is being redesigned from a chat-based prototype into a reaction-driven collection game with clear separation between ephemeral shopping sessions and persistent inventory management.

### New Architecture (In Development)
- **Diegetic portal channel:** #crystal-ball-network serves as entry point with immersive flavor text
- **Emoji-based purchasing:** React with 🛒 to buy items, no text commands needed
- **One item per message:** Each item gets its own Discord message for clean UI
- **Persistent inventory threads:** Each player gets a permanent private thread showing their collection
- **Ephemeral shopping sessions:** Temporary threads for browsing/searching (24hr auto-archive)
- **500gp starting balance:** Simple, fixed starting amount for all players
- **Onboarding on join:** Inventory threads created when players join the server

### What Works Now (Phase 0 - Chat Prototype)
- Claude AI generates unique D&D magic items with JSON structure
- Two-shot pricing system (generation + pricing)
- Session-based conversations in Discord threads
- Multi-model support (Sonnet/Haiku/GPT-4o-mini)
- Cost tracking and budget limits
- SQLite database schema (needs session_type column added)

### What's Being Built
- Reaction-based purchasing system
- Per-player persistent inventory threads
- Diegetic portal channel with auto-cleanup
- Member join event handling for inventory creation
- One-item-per-message display format

---

## Development Phases

### Phase 1: Core Backend Integration (CURRENT)
**Goal:** Players can browse items, purchase via reactions, and view persistent inventory threads

#### 1.1 Server Structure & Onboarding
- [ ] Update `!bootstrap` to create #crystal-ball-network channel with diegetic prompt
- [ ] Implement member join event handler
- [ ] Create persistent inventory thread for new members (500gp starting balance)
- [ ] Auto-delete non-command messages in #crystal-ball-network

#### 1.2 Shopping Flow
- [ ] Implement `!search` command in #crystal-ball-network
- [ ] Create ephemeral search threads with personalized greeting
- [ ] Refactor item generation to one-item-per-message format
- [ ] Add 🛒 reaction to each item message
- [ ] Store generated items in database with session_type tracking

#### 1.3 Reaction-Based Purchase System
- [ ] Implement 🛒 reaction handler for purchasing
- [ ] Deduct gold from player balance
- [ ] Delete item message from search thread
- [ ] Repost item in player's inventory thread
- [ ] Update inventory thread header with new balance
- [ ] Integrate `Transaction.executePurchase()` for audit logging

#### 1.4 Inventory Thread Management
- [ ] Format inventory thread starter message
- [ ] Add 💰 reaction to items posted in inventory
- [ ] Stub out 💰 reaction handler (console.log for now)
- [ ] Update header message when balance changes
- [ ] Track total items and collection value

#### 1.5 Database Integration
- [ ] Add `session_type` column to shopping_sessions table
- [ ] Use `Player.getOrCreate()` on member join
- [ ] Store all generated items in items table
- [ ] Track all purchases in transactions table
- [ ] Remove `equipped` column from player_inventory (or ignore it)

**Success Criteria:** Players can join server → get inventory thread → type !search → browse items → click 🛒 → item appears in inventory thread.

---

### Phase 2: Selling & Economy
**Goal:** Full buy/sell economy with player-to-player market

#### 2.1 Sell System
- [ ] Implement 💰 reaction handler (currently stubbed)
- [ ] Create ephemeral sell thread when user clicks 💰 on inventory item
- [ ] Claude negotiates price based on item condition/rarity
- [ ] Price calculation (50% of purchase price? Dynamic?)
- [ ] Add gold to player balance
- [ ] Delete item from inventory thread
- [ ] Generate sell receipts in sell thread

#### 2.2 Player Market
- [ ] List player-sold items in marketplace
- [ ] Filter between CBN-generated and player-sold items
- [ ] Implement consignment system (CBN takes cut?)
- [ ] Price negotiation mechanics?

#### 2.3 Financial Services
- [ ] `DEPOSIT` command - add gold to account
- [ ] `WITHDRAW` command - convert to physical currency
- [ ] Transaction history view
- [ ] Account statements

**Success Criteria:** Players can sell items back or to other players, manage gold deposits/withdrawals.

---

### Phase 3: Crafting System
**Goal:** Players can craft new items

#### 3.1 Crafting Basics
- [ ] Define crafting recipes (components + gold + time?)
- [ ] `CRAFT` command to start crafting
- [ ] Claude AI generates custom crafted items based on components
- [ ] Crafting skill progression?

#### 3.2 Component System
- [ ] Identify craftable components from disenchanted items
- [ ] `DISENCHANT` command to break items into parts
- [ ] Component inventory separate from item inventory
- [ ] Rare material discovery

**Success Criteria:** Players can disenchant items for components and craft new items.

---

### Phase 4: UI/UX Improvements
**Goal:** Polished Discord interface

#### 4.1 Remove Bot-Commands Channel
- [ ] Implement slash commands (`/start`, `/shop`, `/inventory`)
- [ ] Or use reaction-based UI in welcome channel
- [ ] Direct message initiation option?
- [ ] Persistent "Shop" button in a main channel

#### 4.2 Enhanced Item Display
- [ ] Discord embeds for items (color-coded by rarity)
- [ ] Thumbnail images (AI-generated item art?)
- [ ] Buttons for quick actions (Buy, Details, Compare)
- [ ] Item tooltips on hover (if possible)

#### 4.3 Session Management
- [ ] Multiple simultaneous sessions (browsing while crafting?)
- [ ] Session history browser
- [ ] Favorites/wishlist system
- [ ] Shopping cart for multi-item purchases

**Success Criteria:** Clean, intuitive Discord UI without clunky command channel.

---

### Phase 5: Advanced Features
**Goal:** Deep RPG mechanics

#### 5.1 Character Progression
- [ ] Player levels and experience
- [ ] Crafting skills and specializations
- [ ] Merchant reputation system
- [ ] Unlock premium items at higher levels

#### 5.2 Quests & Events
- [ ] Daily deals and limited-time offers
- [ ] Fetch quests ("find me a +2 longsword")
- [ ] Crafting commissions from NPCs
- [ ] Seasonal events (holiday items)

#### 5.3 Guild/Shop Management
- [ ] Players can open their own shops
- [ ] Shop customization and branding
- [ ] Hire NPCs to run shop while offline?
- [ ] Leaderboards for top merchants

**Success Criteria:** Full merchant simulation experience.

---

## Technical Debt & Refactoring

### Now
- Remove outdated references to "ephemeral sessions" (now persistent)
- Clarify when sessions lock (after purchase? time-based?)
- Session expiry cleanup automation

### Later
- Consider PostgreSQL migration for multi-server support
- Add caching layer for frequently-browsed items
- Implement rate limiting per player
- Add admin dashboard for game balance monitoring

---

## Documentation Improvements Needed

### Immediate
- [x] Update CLAUDE.md with roadmap context
- [ ] Update README.md with shopkeeper RPG vision
- [ ] Add CONTRIBUTING.md for future developers
- [ ] Document planned command structure

### Ongoing
- Update README.md after each phase completion
- Keep CLAUDE.md in sync with architecture changes
- Maintain changelog for breaking changes

---

## Next Actions (Current Sprint)

1. **Update planning documentation** (In Progress)
   - Update ROADMAP.md with new architecture ✓
   - Update UI_IMPROVEMENTS.md with emoji-based flow
   - Update COMMANDS.md to remove obsolete commands
   - Update CLAUDE.md with new patterns

2. **Server structure & onboarding** (Phase 1.1)
   - Update !bootstrap for #crystal-ball-network channel
   - Implement guildMemberAdd handler
   - Create inventory threads with 500gp starting balance

3. **Shopping flow** (Phase 1.2)
   - Implement !search command
   - Refactor to one-item-per-message display
   - Add 🛒 reactions automatically

4. **Purchase system** (Phase 1.3)
   - Implement reaction handler for 🛒
   - Move items from search to inventory threads
   - Update balances and headers

---

## Open Questions - RESOLVED

1. ~~**Session locking:**~~ → Allow multiple purchases per session, no locking needed
2. ~~**Bot-commands replacement:**~~ → #crystal-ball-network portal channel with !search only
3. **Item persistence:** Do generated items persist in catalog even if not purchased? (YES - store all)
4. **Pricing:** Should player resale prices be lower than purchase prices? (TBD - Phase 2)
5. **Crafting time:** Real-time delays or instant crafting? (TBD - Phase 3)
6. ~~**Equipping items:**~~ → Removed entirely, this is a collection game not combat

---

## Success Metrics

- **Phase 1:** Players can join → get inventory → !search → click 🛒 → collect items
- **Phase 2:** Daily active merchants selling items via 💰 reaction
- **Phase 3:** X% of items are player-crafted
- **Phase 4:** 90% of interactions via emoji reactions (not text commands)
- **Phase 5:** Average session length >15 minutes (engagement)

---

**Last Updated:** 2025-11-29
**Current Phase:** Phase 1 - Core Backend Integration (Architecture Redesign)
**Next Milestone:** First successful emoji-based purchase with persistent inventory thread