# Design Patterns & Current UI

Reference documentation for the Crystal Ball Network bot's implemented UI patterns.

---

## Channel Structure

```
CRYSTAL BALL NETWORK (Category)
+-- #welcome - Game info and lore
+-- #crystal-ball-network - Main portal (type searches directly)
+-- #accounts - Container for inventory threads
+-- Private Threads:
    +-- search-[username]-[query] - Ephemeral shopping (1hr auto-archive)
    +-- sell-[username]-[item] - Ephemeral selling (1hr auto-archive)
    +-- inventory-[username] - Persistent, locked collection
```

---

## Interaction Patterns

| Context | Action | Result |
|---------|--------|--------|
| #crystal-ball-network | Type search query | Creates search thread with items |
| Search thread | Click cart on item | Purchase, item moves to inventory |
| Inventory thread | Click scales on item | Creates sell thread with buyers |
| Sell thread | Click speech bubble | Start negotiation with that buyer |
| Sell thread | Click moneybag | Accept offer immediately |

---

## Item Display (Embeds)

Items are displayed as Discord embeds with rarity-based colors:

```
+------------------------------------------+
| [COLOR BAR - based on rarity]            |
| ITEM NAME                                |
+------------------------------------------+
| Type: Wondrous item    | Rarity: Rare    |
| Price: 450 gp                            |
+------------------------------------------+
| History                                  |
| [Item backstory...]                      |
+------------------------------------------+
| Properties                               |
| [Mechanical effects...]                  |
+------------------------------------------+
| Complication                             |
| [Drawbacks or quirks...]                 |
+------------------------------------------+
```

**Rarity Colors:**
- Common: Gray (#9D9D9D)
- Uncommon: Green (#1EFF00)
- Rare: Blue (#0070DD)
- Very Rare: Purple (#A335EE)
- Legendary: Orange (#FF8000)

---

## Sell Flow (NPC Buyers)

When player clicks scales on inventory item:

1. Create sell thread
2. Show item card with "Total Invested" value
3. Display "finding buyers" message
4. Generate 3 NPC buyers with different offers
5. Each buyer card shows: name, offer amount, interest level, reason for buying
6. Player can:
   - Click moneybag to accept offer immediately
   - Click speech bubble to negotiate (locks to that buyer)
   - Walk away by demanding too much (buyer leaves)

---

## Inventory Thread Header

```
**Your Collection**

**Account Balance:** 500 gp
**Items Owned:** 3
**Total Invested:** 450 gp

**--- Inventory ---**
```

Updated automatically when balance or inventory changes.

---

## Removed/Deprecated Features

These features from earlier plans are no longer being implemented:

- **!search command** - Replaced with direct typing in portal channel
- **Item numbering** - Not needed with one-item-per-message
- **"buy [number]" commands** - Replaced with emoji reactions
- **"inventory" command** - Inventory is a persistent thread
- **"balance" command** - Check inventory thread header
- **"equip" system** - This is a collection/management game, not combat
- **Shopping cart** - Direct purchase is cleaner
- **Player-to-player selling** - Moved to Phase 5 stretch goal

---

**Last Updated:** 2025-12-08