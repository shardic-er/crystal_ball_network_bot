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