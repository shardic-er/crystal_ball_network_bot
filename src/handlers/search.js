/**
 * Search handler - Search flow, cost info, model switching
 */

const { ChannelType, EmbedBuilder } = require('discord.js');
const { Player } = require('../database/models');
const { MODEL_CONFIGS, MODEL_MODE, GAME_CHANNEL_NAME } = require('../utils/config');
const { delay, startTiming, endTiming } = require('../utils/timing');
const { splitText } = require('../ui/messages');
const { formatItemAsEmbed } = require('../ui/embeds');
const { sendToClaudeAPI, parseAndFormatResponse } = require('../services/claude');
const { addPricingToItems } = require('../services/pricing');
const sessionsService = require('../services/sessions');
const costTrackingService = require('../services/costTracking');

/**
 * Display parsed response (items or plain text) to a channel
 * @param {Object} params
 * @param {Object} params.channel - Discord channel to send messages to
 * @param {Object} params.parsed - Parsed response from Claude
 * @param {string} params.rawResponse - Raw response text
 * @param {Object} params.player - Player object with account_balance_gp
 * @param {string} params.threadId - Thread ID for pricing
 * @returns {Promise<{finalResponse: string, itemsData: Object|null}>}
 */
async function displayParsedResponse({ channel, parsed, rawResponse, player, threadId }) {
  let finalResponse = rawResponse;
  let itemsData = null;

  if (parsed.type === 'items') {
    const prices = await addPricingToItems(parsed.items, threadId);
    const shouldFilterByBudget = parsed.rawJson?.filterByBudget === true;
    const maxPriceGp = parsed.rawJson?.maxPriceGp;

    let affordableItems = parsed.items;
    let affordablePrices = prices;
    let priceLimit = null;

    if (shouldFilterByBudget) {
      // Use maxPriceGp if specified, otherwise fall back to account balance
      priceLimit = (maxPriceGp !== null && maxPriceGp !== undefined) ? maxPriceGp : player.account_balance_gp;
      console.log(`[FILTER] Budget filtering requested by Claude (filterByBudget: true, maxPriceGp: ${maxPriceGp}, using limit: ${priceLimit}gp)`);

      affordableItems = [];
      affordablePrices = [];
      for (let i = 0; i < parsed.items.length; i++) {
        if (prices[i] <= priceLimit) {
          affordableItems.push(parsed.items[i]);
          affordablePrices.push(prices[i]);
        }
      }
      console.log(`[FILTER] Filtered ${parsed.items.length} items to ${affordableItems.length} affordable items (limit: ${priceLimit}gp)`);
    } else {
      console.log('[FILTER] No budget filtering - showing all items');
    }

    if (affordableItems.length === 0) {
      // Use the price limit if filtering was applied, otherwise use account balance
      const budgetDisplay = priceLimit !== null ? priceLimit : player.account_balance_gp;
      const budgetType = priceLimit !== null ? 'requested budget' : 'current balance';
      await channel.send(
        `*The Curator rubs their temples and sighs.*\n\n` +
        `"I'm afraid ALL the items I was about to show you exceed your ${budgetType} of **${budgetDisplay} gp**. ` +
        `Perhaps try a more... modest search query? Or consider items of common or uncommon rarity within your price range."`
      );
      finalResponse = `Generated ${parsed.items.length} items, but all were too expensive for the ${budgetDisplay}gp ${budgetType}.`;
    } else {
      if (parsed.rawJson?.message) {
        await channel.send(parsed.rawJson.message);
        await delay(300);
      }

      if (affordableItems.length < parsed.items.length) {
        const filtered = parsed.items.length - affordableItems.length;
        await channel.send(
          `*The Curator discretely sets aside ${filtered} item${filtered > 1 ? 's' : ''} that exceed${filtered === 1 ? 's' : ''} your current budget...*`
        );
        await delay(300);
      }

      const itemMessages = [];
      for (let i = 0; i < affordableItems.length; i++) {
        const item = affordableItems[i];
        const price = affordablePrices[i];
        const itemEmbed = formatItemAsEmbed(item, price);
        const itemMessage = await channel.send({ embeds: [itemEmbed] });
        await itemMessage.react('\u{1F6D2}');
        itemMessages.push({
          messageId: itemMessage.id,
          item: { ...item, priceGp: price }
        });
        await delay(500);
      }

      itemsData = {
        rawJson: parsed.rawJson,
        items: affordableItems.map((item, index) => ({
          ...item,
          priceGp: affordablePrices[index]
        })),
        itemMessages: itemMessages
      };

      finalResponse = parsed.rawJson?.message || `Generated ${affordableItems.length} affordable items (${parsed.items.length - affordableItems.length} filtered)`;
    }
  } else {
    finalResponse = parsed.content;
    const chunks = splitText(finalResponse);
    for (const chunk of chunks) {
      await channel.send(chunk);
      await delay(500);
    }
  }

  return { finalResponse, itemsData };
}

/**
 * Handle a search query from the crystal-ball-network channel
 * @param {Object} message - Discord message
 * @param {Object} cbnSessions - Sessions reference for backward compatibility
 */
async function handleSearchQuery(message, cbnSessions) {
  startTiming('search-total');
  try {
    // Get or create player
    startTiming('search-db-player');
    const player = Player.getOrCreate(message.author.id, message.author.username, 500);
    endTiming('search-db-player');
    console.log(`[SEARCH] Player ${player.username} starting search (balance: ${player.account_balance_gp}gp)`);

    // Store the user's search query
    const userQuery = message.content;

    // Delete the user's message immediately
    startTiming('search-discord-delete-msg');
    await message.delete();
    endTiming('search-discord-delete-msg');

    // Send immediate ephemeral-style confirmation (deleted quickly after thread is created)
    startTiming('search-discord-send-confirmation');
    const confirmation = await message.channel.send(
      `Opening search portal for ${message.author}...`
    );
    endTiming('search-discord-send-confirmation');

    // Create ephemeral search thread with truncated query
    // Truncate query to fit Discord's 100 character limit for thread names
    const maxQueryLength = 100 - message.author.username.length - 8; // "search-" (7) + "-" (1) = 8
    const truncatedQuery = userQuery.length > maxQueryLength
      ? userQuery.substring(0, maxQueryLength - 3) + '...'
      : userQuery;
    const threadName = `search-${message.author.username}-${truncatedQuery}`;

    startTiming('search-discord-create-thread');
    const thread = await message.channel.threads.create({
      name: threadName,
      autoArchiveDuration: 60, // 1 hour (shortest Discord allows)
      type: ChannelType.PrivateThread,
      reason: `Creating search session for ${message.author.username}`
    });
    endTiming('search-discord-create-thread');

    // Add member to thread
    startTiming('search-discord-add-member');
    await thread.members.add(message.author.id);
    endTiming('search-discord-add-member');

    // Create session with user's query (default to haiku for searches)
    cbnSessions[thread.id] = {
      playerId: message.author.id,
      playerName: message.author.username,
      startedAt: new Date().toISOString(),
      messages: [],
      modelMode: 'haiku',
      sessionType: 'search'
    };

    // Send neutral "shimmer" message immediately
    startTiming('search-discord-send-shimmer');
    const shimmerMessage = `*The crystal ball shimmers to life...*`;
    await thread.send(shimmerMessage);
    endTiming('search-discord-send-shimmer');

    // Now process the user's query with the AI
    await thread.sendTyping();

    cbnSessions[thread.id].messages.push({
      role: 'user',
      content: userQuery
    });

    // Use Haiku for faster item generation
    startTiming('search-api-item-generation');
    const apiResponse = await sendToClaudeAPI(cbnSessions[thread.id].messages, thread.id, player.account_balance_gp, 'haiku');
    endTiming('search-api-item-generation');
    const rawResponse = apiResponse.text;

    // Parse and format response
    startTiming('search-parse-response');
    const parsed = parseAndFormatResponse(rawResponse);
    endTiming('search-parse-response');

    startTiming('search-display-response');
    const { finalResponse, itemsData } = await displayParsedResponse({
      channel: thread,
      parsed,
      rawResponse,
      player,
      threadId: thread.id
    });
    endTiming('search-display-response');

    // Store assistant response
    cbnSessions[thread.id].messages.push({
      role: 'assistant',
      content: finalResponse,
      itemsData: itemsData
    });

    startTiming('search-save-sessions');
    await sessionsService.saveSessions();
    endTiming('search-save-sessions');

    // Delete the "opening portal" confirmation message now that thread is ready
    setTimeout(async () => {
      try {
        await confirmation.delete();
      } catch (error) {
        console.warn('Could not delete confirmation:', error.message);
      }
    }, 3000);

    endTiming('search-total');
    console.log(`[SEARCH] Created search thread for ${message.author.username}: ${threadName}`);

  } catch (error) {
    console.error('[SEARCH] Error creating search thread:', error);
    await message.channel.send('Sorry, there was an error starting your search session. Please try again.');
  }
}

/**
 * Show cost information for a session
 * @param {Object} message - Discord message
 * @param {string} threadId - Thread ID
 * @param {Object} session - Session data
 */
async function showCostInfo(message, threadId, session) {
  const sessionCost = costTrackingService.getSessionCost(threadId);
  const playerCost = costTrackingService.getPlayerCost(session.playerId);
  const todaySpend = costTrackingService.getTodaySpend();

  const playerModelMode = session?.modelMode || MODEL_MODE;
  const config = MODEL_CONFIGS[playerModelMode];

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Cost Information')
    .addFields(
      {
        name: 'Current Model',
        value: `${config.model} (${config.provider})`,
        inline: true
      },
      {
        name: 'This Session',
        value: `$${sessionCost?.total.toFixed(4) || '0.0000'} (${sessionCost?.messages || 0} msgs)`,
        inline: true
      },
      {
        name: 'Your Lifetime',
        value: `$${playerCost?.total.toFixed(4) || '0.0000'} (${playerCost?.messages || 0} msgs)`,
        inline: true
      },
      {
        name: 'Today Total',
        value: `$${todaySpend.toFixed(4)} / $${config.dailyBudgetLimit.toFixed(2)} limit`,
        inline: false
      }
    )
    .setFooter({
      text: `Use !fast (haiku) or !fancy (sonnet) to switch models`
    });

  await message.reply({ embeds: [embed] });
}

/**
 * Handle model switch command (!fast or !fancy)
 * @param {Object} message - Discord message
 * @param {Object} session - Session data
 * @param {string} mode - 'haiku' or 'sonnet'
 */
async function handleModelSwitch(message, session, mode) {
  session.modelMode = mode;
  await sessionsService.saveSessions();

  if (mode === 'haiku') {
    await message.reply('Switched to fast mode (Claude Haiku 4.5). Lower cost, faster responses.');
  } else {
    await message.reply('Switched to fancy mode (Claude Sonnet 4.5). Highest quality responses.');
  }
}

module.exports = {
  displayParsedResponse,
  handleSearchQuery,
  showCostInfo,
  handleModelSwitch
};
