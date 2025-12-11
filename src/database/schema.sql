-- Crystal Ball Network Database Schema
-- SQLite3

-- Players table - persistent account data
CREATE TABLE IF NOT EXISTS players (
  player_id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  account_balance_gp INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_players_discord_id ON players(discord_user_id);

-- Inventory threads table - persistent player inventory threads
CREATE TABLE IF NOT EXISTS inventory_threads (
  thread_id TEXT PRIMARY KEY,
  player_id INTEGER UNIQUE NOT NULL,
  discord_thread_id TEXT UNIQUE NOT NULL,
  header_message_id TEXT, -- ID of the header message for editing
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inv_threads_player ON inventory_threads(player_id);
CREATE INDEX IF NOT EXISTS idx_inv_threads_discord ON inventory_threads(discord_thread_id);

-- Shopping sessions table - ephemeral browsing sessions
CREATE TABLE IF NOT EXISTS shopping_sessions (
  session_id TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL,
  discord_thread_id TEXT UNIQUE NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'search', -- 'search', 'sell', 'craft'
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'locked', 'expired'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  locked_at DATETIME,
  lock_reason TEXT, -- 'purchase', 'inactivity', 'manual'

  -- Cached search results (JSON array)
  last_search_results TEXT,

  FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_thread_id ON shopping_sessions(discord_thread_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON shopping_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_activity ON shopping_sessions(last_activity_at);

-- Items table - all generated items (master catalog)
CREATE TABLE IF NOT EXISTS items (
  item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  item_type TEXT NOT NULL,
  rarity TEXT NOT NULL,
  requires_attunement BOOLEAN NOT NULL DEFAULT 0,
  attunement_requirement TEXT,
  description TEXT NOT NULL,
  history TEXT NOT NULL,
  properties TEXT NOT NULL,
  complication TEXT NOT NULL,
  base_price_gp INTEGER NOT NULL,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_items_rarity ON items(rarity);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);

-- Player inventory table - items owned by players
CREATE TABLE IF NOT EXISTS player_inventory (
  inventory_id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  purchase_price_gp INTEGER NOT NULL,
  discord_message_id TEXT NOT NULL,
  purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  equipped BOOLEAN DEFAULT 0,
  sold BOOLEAN DEFAULT 0,
  sold_at DATETIME,
  sold_price_gp INTEGER,

  FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_inventory_player ON player_inventory(player_id);
CREATE INDEX IF NOT EXISTS idx_inventory_equipped ON player_inventory(player_id, equipped);
CREATE INDEX IF NOT EXISTS idx_inventory_sold ON player_inventory(sold);

-- Transactions table - complete audit log
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  transaction_type TEXT NOT NULL, -- 'purchase', 'sale', 'deposit', 'withdrawal'
  amount_gp INTEGER NOT NULL,
  balance_before_gp INTEGER NOT NULL,
  balance_after_gp INTEGER NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  item_id INTEGER,
  session_id TEXT,
  description TEXT,

  FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE SET NULL,
  FOREIGN KEY (session_id) REFERENCES shopping_sessions(session_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_player ON transactions(player_id);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type);

-- ============================================================================
-- PHASE 2: NPCs & Reputation (scaffolded for future use)
-- ============================================================================

-- NPCs as first-class entities
CREATE TABLE IF NOT EXISTS npcs (
  npc_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  personality TEXT NOT NULL,
  alignment TEXT NOT NULL,
  archetype TEXT NOT NULL,
  is_shopper BOOLEAN DEFAULT 0,
  is_adventurer BOOLEAN DEFAULT 0,
  is_craftsman BOOLEAN DEFAULT 0,
  disabled BOOLEAN DEFAULT 0,
  disabled_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_npcs_archetype ON npcs(archetype);
CREATE INDEX IF NOT EXISTS idx_npcs_disabled ON npcs(disabled);

-- Player-NPC relationships
CREATE TABLE IF NOT EXISTS player_npcs (
  player_id INTEGER NOT NULL,
  npc_id INTEGER NOT NULL,
  trust_level INTEGER DEFAULT 0,
  times_met INTEGER DEFAULT 0,
  last_interaction DATETIME,
  PRIMARY KEY (player_id, npc_id),
  FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE,
  FOREIGN KEY (npc_id) REFERENCES npcs(npc_id) ON DELETE CASCADE
);

-- NPC attuned items (last 3 items sold to them)
CREATE TABLE IF NOT EXISTS npc_equipment (
  npc_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  slot_number INTEGER NOT NULL,  -- 1, 2, or 3
  equipped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (npc_id, slot_number),
  FOREIGN KEY (npc_id) REFERENCES npcs(npc_id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE
);

-- ============================================================================
-- PHASE 4: Quests & Adventuring (scaffolded for future use)
-- ============================================================================

-- Quest definitions (loaded from quest files)
CREATE TABLE IF NOT EXISTS quests (
  quest_id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  turn_limit INTEGER DEFAULT 10,
  base_gold_reward INTEGER NOT NULL,
  quest_file_path TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quests_slug ON quests(slug);

-- Active/completed quest runs
CREATE TABLE IF NOT EXISTS quest_runs (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  quest_id INTEGER NOT NULL,
  discord_thread_id TEXT NOT NULL,
  turns_remaining INTEGER NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  outcome TEXT,
  cleared BOOLEAN DEFAULT 0,
  FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE,
  FOREIGN KEY (quest_id) REFERENCES quests(quest_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_quest_runs_player ON quest_runs(player_id);
CREATE INDEX IF NOT EXISTS idx_quest_runs_thread ON quest_runs(discord_thread_id);
CREATE INDEX IF NOT EXISTS idx_quest_runs_active ON quest_runs(completed_at);

-- Party composition for each quest run
CREATE TABLE IF NOT EXISTS quest_party (
  run_id INTEGER NOT NULL,
  npc_id INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  PRIMARY KEY (run_id, npc_id),
  FOREIGN KEY (run_id) REFERENCES quest_runs(run_id) ON DELETE CASCADE,
  FOREIGN KEY (npc_id) REFERENCES npcs(npc_id) ON DELETE CASCADE
);

-- Quest message history (for thread regeneration)
CREATE TABLE IF NOT EXISTS quest_messages (
  message_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  discord_message_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES quest_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quest_messages_run ON quest_messages(run_id);

-- Player quest completion tracking (for "cleared" badges)
CREATE TABLE IF NOT EXISTS player_quest_clears (
  player_id INTEGER NOT NULL,
  quest_id INTEGER NOT NULL,
  first_cleared_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  times_cleared INTEGER DEFAULT 1,
  PRIMARY KEY (player_id, quest_id),
  FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE,
  FOREIGN KEY (quest_id) REFERENCES quests(quest_id) ON DELETE CASCADE
);