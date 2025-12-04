#!/usr/bin/env node
/**
 * Utility to set a player's balance
 * Usage: node scripts/set-balance.js <username> <amount>
 * Example: node scripts/set-balance.js shardic 1000000
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '../data/cbn.db');

const args = process.argv.slice(2);

if (args.length === 0) {
  // No args - list all players
  const db = new Database(DB_PATH);
  const players = db.prepare('SELECT player_id, username, account_balance_gp FROM players ORDER BY username').all();
  db.close();

  if (players.length === 0) {
    console.log('No players found in database.');
  } else {
    console.log('\nPlayers:');
    console.log('-'.repeat(50));
    for (const p of players) {
      console.log(`  ${p.username.padEnd(20)} ${p.account_balance_gp.toLocaleString().padStart(12)} gp`);
    }
    console.log('-'.repeat(50));
    console.log('\nUsage: node scripts/set-balance.js <username> <amount>');
  }
  process.exit(0);
}

if (args.length !== 2) {
  console.error('Usage: node scripts/set-balance.js <username> <amount>');
  console.error('       node scripts/set-balance.js           (list all players)');
  process.exit(1);
}

const [username, amountStr] = args;
const amount = parseInt(amountStr, 10);

if (isNaN(amount) || amount < 0) {
  console.error('Error: Amount must be a non-negative integer');
  process.exit(1);
}

const db = new Database(DB_PATH);

// Find player by username (case-insensitive)
const player = db.prepare('SELECT * FROM players WHERE LOWER(username) = LOWER(?)').get(username);

if (!player) {
  console.error(`Error: Player "${username}" not found`);
  console.log('\nAvailable players:');
  const players = db.prepare('SELECT username FROM players ORDER BY username').all();
  for (const p of players) {
    console.log(`  - ${p.username}`);
  }
  db.close();
  process.exit(1);
}

const oldBalance = player.account_balance_gp;

db.prepare('UPDATE players SET account_balance_gp = ? WHERE player_id = ?').run(amount, player.player_id);

console.log(`Updated ${player.username}:`);
console.log(`  Old balance: ${oldBalance.toLocaleString()} gp`);
console.log(`  New balance: ${amount.toLocaleString()} gp`);

db.close();