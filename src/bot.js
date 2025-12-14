/**
 * Crystal Ball Network Discord Bot
 * Main entry point - event routing and initialization
 */

require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, Partials } = require('discord.js');
const { Player } = require('./database/models');

// Utils
const { delay, startTiming, endTiming } = require('./utils/timing');
const { config, MODEL_CONFIGS, MODEL_MODE, DEFAULT_COST_CONFIG, GAME_CHANNEL_NAME, ACCOUNTS_CHANNEL_NAME } = require('./utils/config');
const { loadPrompts, getPrompt } = require('./utils/prompts');

// Services
const costTrackingService = require('./services/costTracking');
const sessionsService = require('./services/sessions');
const { sendToClaudeAPI, parseAndFormatResponse } = require('./services/claude');

// Handlers
const { bootstrapServer, initializeInventoryThread } = require('./handlers/bootstrap');
const { displayParsedResponse, handleSearchQuery, showCostInfo, handleModelSwitch } = require('./handlers/search');
const { handlePurchaseReaction } = require('./handlers/purchase');
const { handleSellReaction, handleAcceptOffer, handleNegotiation, handleNegotiationMessage } = require('./handlers/sell');
const { handleWorkshopCraftButton, handleCraftingInteraction } = require('./handlers/craft');

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

// Session reference - populated after loading
let cbnSessions = {};

/**
 * Initialize bot - load prompts, sessions, cost tracking
 */
async function initialize() {
  await loadPrompts();
  await sessionsService.loadSessions();
  cbnSessions = sessionsService.getSessionsRef();
  await costTrackingService.loadCostTracking();
}

// ============ EVENT HANDLERS ============

client.once('ready', async () => {
  await initialize();
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Default search model: haiku (claude-haiku-4-5)`);
  console.log(`Use !fancy in threads to switch to sonnet`);
  console.log('Crystal Ball Network is online!');
});

// Handle new members joining the server
client.on('guildMemberAdd', async (member) => {
  await initializeInventoryThread(member, member.guild);
});

// Handle reaction additions for purchases and sells
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  // Fetch partial messages/reactions
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Error fetching reaction:', error);
      return;
    }
  }

  let message = reaction.message;
  if (message.partial) {
    try {
      message = await message.fetch();
    } catch (error) {
      console.error('Error fetching message:', error);
      return;
    }
  }

  const emoji = reaction.emoji.name;

  // Shopping cart - purchase item
  if (emoji === '\u{1F6D2}') {
    await handlePurchaseReaction(reaction, user, message, cbnSessions);
    return;
  }

  // Scales - start selling from inventory
  if (emoji === '\u{2696}') {
    await handleSellReaction(reaction, user, message, cbnSessions);
    return;
  }

  // Moneybag - accept offer in sell thread
  if (emoji === '\u{1F4B0}') {
    await handleAcceptOffer(reaction, user, message, cbnSessions);
    return;
  }

  // Speech bubble - start negotiation
  if (emoji === '\u{1F4AC}') {
    await handleNegotiation(reaction, user, message, cbnSessions);
    return;
  }
});

// Handle messages
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Bootstrap command - server owner only
  if (message.content === '!bootstrap') {
    if (message.author.id !== message.guild.ownerId) {
      await message.reply('Only the server owner can use this command.');
      return;
    }

    try {
      await message.delete();
    } catch (error) {
      console.warn('Could not delete !bootstrap command:', error.message);
    }

    const statusMessage = await message.channel.send('Initializing Crystal Ball Network bootstrap...');
    await bootstrapServer(message.guild, statusMessage, client);

    setTimeout(async () => {
      try {
        await statusMessage.delete();
      } catch (error) {
        console.warn('Could not delete bootstrap status message:', error.message);
      }
    }, 5000);

    return;
  }

  // Handle crystal-ball-network channel - search queries
  if (message.channel.name === GAME_CHANNEL_NAME && message.channel.type === ChannelType.GuildText) {
    await handleSearchQuery(message, cbnSessions);
    return;
  }

  // Handle messages in threads
  if (!message.channel.isThread()) return;

  const threadId = message.channel.id;

  // Handle crafting threads - delete messages and notify user to use dropdowns
  if (message.channel.name?.startsWith('experimental crafting -')) {
    try {
      await message.delete();
      const hint = await message.channel.send(
        `*The workshop does not respond to words. Please use the dropdown menus to select items.*`
      );
      setTimeout(async () => {
        try { await hint.delete(); } catch (e) { /* ignore */ }
      }, 5000);
    } catch (e) {
      console.warn('[CRAFT] Could not delete message in crafting thread:', e.message);
    }
    return;
  }

  if (!cbnSessions[threadId]) return;

  const session = cbnSessions[threadId];

  if (message.author.id !== session.playerId) return;

  // Handle commands
  if (message.content === '!cost') {
    await showCostInfo(message, threadId, session);
    return;
  }

  if (message.content === '!fast') {
    await handleModelSwitch(message, session, 'haiku');
    return;
  }

  if (message.content === '!fancy') {
    await handleModelSwitch(message, session, 'sonnet');
    return;
  }

  // Handle sell sessions
  if (session.sessionType === 'sell') {
    await handleNegotiationMessage(message, session, cbnSessions);
    return;
  }

  // Handle search thread follow-up messages
  const currentSpend = costTrackingService.getTodaySpend();
  const playerConfig = MODEL_CONFIGS[session.modelMode] || DEFAULT_COST_CONFIG;

  if (currentSpend >= playerConfig.dailyBudgetLimit) {
    await message.reply(
      `Daily budget limit reached ($${playerConfig.dailyBudgetLimit.toFixed(2)}). The CBN is temporarily unavailable. Try again tomorrow!`
    );
    return;
  }

  session.messages.push({
    role: 'user',
    content: message.content
  });

  await sessionsService.saveSessions();
  await message.channel.sendTyping();

  try {
    const player = Player.getByDiscordId(session.playerId);
    if (!player) {
      await message.reply('Error: Player not found. Please try again.');
      return;
    }

    const apiResponse = await sendToClaudeAPI(session.messages, threadId, player.account_balance_gp);
    const rawResponse = apiResponse.text;

    const parsed = parseAndFormatResponse(rawResponse);

    const { finalResponse, itemsData } = await displayParsedResponse({
      channel: message.channel,
      parsed,
      rawResponse,
      player,
      threadId
    });

    session.messages.push({
      role: 'assistant',
      content: finalResponse,
      itemsData: itemsData
    });

    await sessionsService.saveSessions();

  } catch (error) {
    console.error('Error processing message:', error);

    const errorResponse = `*The crystal ball flickers and dims momentarily...*

My apologies, esteemed customer. The CBN network experienced a momentary disruption. Please try your query again.

*Error details: ${error.message}*`;

    await message.channel.send(errorResponse);
  }
});

// Handle Discord component interactions (buttons, select menus)
client.on('interactionCreate', async (interaction) => {
  try {
    // Handle workshop button (creates new crafting thread)
    if (interaction.isButton() && interaction.customId === 'workshop_experimental_craft') {
      await handleWorkshopCraftButton(interaction);
      return;
    }

    // Handle thread close button (archives the thread)
    if (interaction.isButton() && interaction.customId === 'thread_close') {
      const thread = interaction.channel;
      if (thread && thread.isThread()) {
        try {
          await interaction.update({
            content: '*Closing thread...*',
            components: []
          });
          await thread.setArchived(true);
        } catch (e) {
          console.warn('[THREAD] Could not archive thread:', e.message);
          await interaction.reply({ content: 'Could not close thread.', ephemeral: true }).catch(() => {});
        }
      }
      return;
    }

    // Handle crafting-related interactions (selection flow)
    const handled = await handleCraftingInteraction(interaction);
    if (handled) return;

  } catch (error) {
    console.error('[INTERACTION] Error handling interaction:', error);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'An error occurred.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'An error occurred.', ephemeral: true });
      }
    } catch (e) {
      // Ignore follow-up errors
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
