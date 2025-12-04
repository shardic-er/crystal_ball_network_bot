const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/cbn.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('Created data directory');
}

// Open database connection
const db = new Database(DB_PATH);

// Enable foreign keys (critical for SQLite)
db.pragma('foreign_keys = ON');

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

console.log(`Database connected: ${DB_PATH}`);

// Initialize schema if needed
function initializeDatabase() {
  console.log('Initializing database schema...');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
  console.log('Database schema initialized');
}

// Check if tables exist
const tableCount = db.prepare(
  "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'"
).get().count;

if (tableCount === 0) {
  initializeDatabase();
} else {
  console.log(`Database has ${tableCount} tables`);
}

// Graceful shutdown
process.on('exit', () => {
  db.close();
  console.log('Database connection closed');
});

process.on('SIGINT', () => {
  db.close();
  console.log('Database connection closed');
  process.exit(0);
});

module.exports = db;