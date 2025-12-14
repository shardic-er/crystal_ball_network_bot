/**
 * Bootstrap handler - Server setup and initialization
 */

const fs = require('fs').promises;
const path = require('path');
const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Player, InventoryThread, Item } = require('../database/models');
const { GAME_CHANNEL_NAME, ACCOUNTS_CHANNEL_NAME } = require('../utils/config');
const { delay } = require('../utils/timing');
const { splitText } = require('../ui/messages');
const { getInventoryHeader } = require('../ui/messages');
const { formatItemAsEmbed } = require('../ui/embeds');
const sessionsService = require('../services/sessions');

const TEMPLATES_DIR = path.join(__dirname, '..', 'discord_channel_templates');

/**
 * Load all channel configuration files from templates directory
 * @returns {Promise<Array>} Array of channel configs with name, topic, content, isReadOnly
 */
async function loadAllChannelConfigs() {
  const configs = [];

  try {
    const files = await fs.readdir(TEMPLATES_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort();

    for (const file of mdFiles) {
      const content = await fs.readFile(path.join(TEMPLATES_DIR, file), 'utf-8');
      const name = file.replace('.md', '');

      const firstLine = content.split('\n')[0];
      const topic = firstLine.startsWith('#')
        ? firstLine.replace(/^#+\s*/, '').substring(0, 100)
        : `Information about ${name}`;

      const isReadOnly = name !== GAME_CHANNEL_NAME;

      configs.push({ name, topic, content, isReadOnly });
    }
  } catch (error) {
    console.error('Error loading channel configs:', error);
  }

  configs.sort((a, b) => {
    if (a.name === 'welcome') return -1;
    if (b.name === 'welcome') return 1;
    return a.name.localeCompare(b.name);
  });

  return configs;
}

/**
 * Bootstrap the server - create channels, inventory threads, etc.
 * @param {Object} guild - Discord guild
 * @param {Object} statusMessage - Message to update with progress
 * @param {Object} client - Discord client (for bot user ID)
 */
async function bootstrapServer(guild, statusMessage, client) {
  const updateStatus = async (text) => {
    try {
      await statusMessage.edit(text);
    } catch (error) {
      // Ignore cache errors - message may have been deleted with channel
      if (error.code !== 'ChannelNotCached') {
        console.error('Error updating status:', error);
      }
    }
  };

  await updateStatus('Starting bootstrap process...');

  // Clear ephemeral sessions (sell and search) since bootstrap will wipe their threads
  const clearedSessions = sessionsService.clearSessionsByType(['sell', 'search']);
  if (clearedSessions > 0) {
    await sessionsService.saveSessions();
    console.log(`[BOOTSTRAP] Cleared ${clearedSessions} ephemeral sessions`);
  }

  try {
    const botMember = await guild.members.fetch(client.user.id);
    await botMember.setNickname('Crystal Ball Network');
    console.log('Bot nickname set to "Crystal Ball Network"');
  } catch (error) {
    console.warn('Warning: Could not set bot nickname.', error.message);
  }

  try {
    const channelConfigs = await loadAllChannelConfigs();

    let category = guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory && c.name === 'Crystal Ball Network'
    );

    if (!category) {
      await updateStatus('Creating category: Crystal Ball Network...');
      category = await guild.channels.create({
        name: 'Crystal Ball Network',
        type: ChannelType.GuildCategory
      });
    }

    const existingChannels = guild.channels.cache.filter(
      c => c.parentId === category.id && c.type === ChannelType.GuildText && c.name !== ACCOUNTS_CHANNEL_NAME
    );

    for (const [, channel] of existingChannels) {
      try {
        await updateStatus(`Deleting old channel: #${channel.name}...`);
        await channel.delete();
      } catch (error) {
        console.error(`Error deleting channel ${channel.name}:`, error);
      }
    }

    for (const config of channelConfigs) {
      // Skip accounts channel if it already exists (it's persistent)
      if (config.name === ACCOUNTS_CHANNEL_NAME) {
        const existingAccounts = guild.channels.cache.find(
          c => c.name === ACCOUNTS_CHANNEL_NAME && c.type === ChannelType.GuildText
        );
        if (existingAccounts) {
          console.log('[BOOTSTRAP] Skipping accounts channel - already exists');
          continue;
        }
      }

      await updateStatus(`Creating channel: #${config.name}...`);

      const channel = await guild.channels.create({
        name: config.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: config.topic
      });

      await updateStatus(`Posting content to #${config.name}...`);

      const chunks = splitText(config.content, { mode: 'lines' });
      for (const chunk of chunks) {
        await channel.send(chunk);
        await delay(500);
      }

      // Add button for workshop channel
      if (config.name === 'workshop') {
        const craftButton = new ButtonBuilder()
          .setCustomId('workshop_experimental_craft')
          .setLabel('Experimental Crafting')
          .setStyle(ButtonStyle.Primary);

        const buttonRow = new ActionRowBuilder().addComponents(craftButton);
        await channel.send({ components: [buttonRow] });
      }

      if (config.isReadOnly) {
        await channel.permissionOverwrites.edit(guild.id, {
          SendMessages: false,
          AddReactions: true
        });
      }
    }

    await updateStatus('Initializing inventory threads for existing members...');

    // Initialize inventory threads for all existing members
    const members = await guild.members.fetch();
    const accountsChannel = guild.channels.cache.find(
      c => c.name === ACCOUNTS_CHANNEL_NAME && c.type === ChannelType.GuildText
    );

    if (accountsChannel) {
      let created = 0;

      for (const [, member] of members) {
        // Skip bots
        if (member.user.bot) continue;

        // Create or get player first
        const player = Player.getOrCreate(member.id, member.user.username, 500);

        // Check if inventory thread exists in database
        const existing = InventoryThread.getByPlayerId(player.player_id);

        // Delete existing Discord thread if it exists (we'll recreate it fresh)
        if (existing) {
          try {
            const oldThread = await guild.channels.fetch(existing.discord_thread_id);
            await oldThread.delete();
            console.log(`[BOOTSTRAP] Deleted old inventory thread for ${member.user.username}`);
          } catch (error) {
            console.log(`[BOOTSTRAP] Old thread already gone for ${member.user.username}`);
          }

          // Clean up database entry
          const db = require('../database/db');
          db.prepare('DELETE FROM inventory_threads WHERE thread_id = ?').run(existing.thread_id);
        }

        // Also check for any stray threads with matching name
        const existingThreads = accountsChannel.threads.cache.filter(
          t => t.name === `inventory-${member.user.username}`
        );
        for (const [, strayThread] of existingThreads) {
          try {
            await strayThread.delete();
            console.log(`[BOOTSTRAP] Deleted stray thread for ${member.user.username}`);
          } catch (err) {
            console.log(`[BOOTSTRAP] Could not delete stray thread: ${err.message}`);
          }
        }

        // Create fresh inventory thread
        const threadName = `inventory-${member.user.username}`;
        const thread = await accountsChannel.threads.create({
          name: threadName,
          autoArchiveDuration: null,
          type: ChannelType.PrivateThread,
          reason: `Creating inventory thread for ${member.user.username}`
        });

        await thread.members.add(member.id);

        const headerContent = await getInventoryHeader(player.account_balance_gp, 0, 0);
        const headerMessage = await thread.send(headerContent);

        // Populate with existing items from database
        const existingItems = Item.getPlayerInventory(player.player_id, true, false);

        if (existingItems.length > 0) {
          console.log(`[BOOTSTRAP] Populating ${existingItems.length} existing items for ${member.user.username}`);

          for (const dbItem of existingItems) {
            const itemEmbed = formatItemAsEmbed(dbItem, dbItem.purchase_price_gp, { priceLabel: 'Purchased for' });
            const itemMessage = await thread.send({ embeds: [itemEmbed] });
            await itemMessage.react('\u{2696}'); // scales - click to sell
            await delay(300);
          }

          // Update header with correct counts
          const totalValue = existingItems.reduce((sum, i) => sum + (i.purchase_price_gp || 0), 0);
          const updatedHeader = await getInventoryHeader(player.account_balance_gp, existingItems.length, totalValue);
          await headerMessage.edit(updatedHeader);
        }

        // Lock the thread to make it read-only
        await thread.setLocked(true);

        InventoryThread.create(player.player_id, thread.id, headerMessage.id);

        created++;
        console.log(`[BOOTSTRAP] Created inventory for ${member.user.username}`);
      }

      console.log(`[BOOTSTRAP] Inventory initialization: Created ${created}`);
    }

    await updateStatus('Bootstrap complete! The Crystal Ball Network is ready.');
  } catch (error) {
    console.error('Bootstrap error:', error);
    await updateStatus(`Bootstrap failed: ${error.message}. Please check bot permissions.`);
    throw error;
  }
}

/**
 * Initialize inventory thread for a new member
 * @param {Object} member - Discord guild member
 * @param {Object} guild - Discord guild
 */
async function initializeInventoryThread(member, guild) {
  try {
    console.log(`[MEMBER JOIN] ${member.user.username} joined ${guild.name}`);

    // Check if player already has an inventory thread
    const existingThread = InventoryThread.getByPlayerId(member.id);
    if (existingThread) {
      console.log(`[MEMBER JOIN] Player ${member.user.username} already has inventory thread`);
      return;
    }

    // Create or get player in database with 500gp starting balance
    const player = Player.getOrCreate(member.id, member.user.username, 500);
    console.log(`[MEMBER JOIN] Created/found player: ${player.username} (${player.player_id}) with ${player.account_balance_gp}gp`);

    // Find the accounts channel
    const accountsChannel = guild.channels.cache.find(
      c => c.name === ACCOUNTS_CHANNEL_NAME && c.type === ChannelType.GuildText
    );

    if (!accountsChannel) {
      console.warn('[MEMBER JOIN] accounts channel not found. Run !bootstrap first.');
      return;
    }

    // Create persistent inventory thread from the accounts channel
    const threadName = `inventory-${member.user.username}`;
    const thread = await accountsChannel.threads.create({
      name: threadName,
      autoArchiveDuration: null, // Never auto-archive
      type: ChannelType.PrivateThread,
      reason: `Creating inventory thread for ${member.user.username}`
    });

    // Add the member to the thread
    await thread.members.add(member.id);

    const headerContent = await getInventoryHeader(player.account_balance_gp, 0, 0);
    const headerMessage = await thread.send(headerContent);

    // Lock the thread to make it read-only
    await thread.setLocked(true);

    // Store inventory thread in database
    InventoryThread.create(player.player_id, thread.id, headerMessage.id);

    console.log(`[MEMBER JOIN] Created inventory thread for ${member.user.username}: ${thread.name}`);

  } catch (error) {
    console.error('[MEMBER JOIN] Error creating inventory thread:', error);
  }
}

module.exports = {
  loadAllChannelConfigs,
  bootstrapServer,
  initializeInventoryThread
};
