require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, EmbedBuilder, AttachmentBuilder, Partials } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const { Player, InventoryThread, Item } = require('./database/models');

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

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const SESSIONS_FILE = path.join(__dirname, 'cbn_sessions.json');
const COST_TRACKING_FILE = path.join(__dirname, 'cost_tracking.json');
const CBN_PROMPT_PATH = path.join(__dirname, 'cbn_system_prompt.md');
const CBN_PRICING_PROMPT_PATH = path.join(__dirname, 'cbn_pricing_prompt.md');
const TEMPLATES_DIR = path.join(__dirname, 'discord_channel_templates');
const GAME_CHANNEL_NAME = 'crystal-ball-network';
const ACCOUNTS_CHANNEL_NAME = 'accounts';
const ALLOWED_COMMANDS = ['!start', '!bootstrap', '!share', '!cost', '!fast', '!fancy', '!cheap', '!search'];

// Model configurations
const MODEL_CONFIGS = {
  sonnet: {
    model: 'claude-sonnet-4-5',
    provider: 'anthropic',
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00,
    cacheWriteCostPer1M: 3.75,
    cacheReadCostPer1M: 0.30,
    dailyBudgetLimit: 10.00
  },
  haiku: {
    model: 'claude-haiku-4-5',
    provider: 'anthropic',
    inputCostPer1M: 1.00,
    outputCostPer1M: 5.00,
    cacheWriteCostPer1M: 1.25,
    cacheReadCostPer1M: 0.10,
    dailyBudgetLimit: 10.00
  },
  cheap: {
    model: 'gpt-4o-mini',
    provider: 'openai',
    inputCostPer1M: 0.25,
    outputCostPer1M: 2.00,
    cacheWriteCostPer1M: 0.025,
    cacheReadCostPer1M: 0.025,
    dailyBudgetLimit: 10.00,
    maxContextTokens: 128000
  }
};

// Validate model config to prevent NaN issues
function validateModelConfig(config, name) {
  const requiredFields = ['model', 'provider', 'inputCostPer1M', 'outputCostPer1M', 'dailyBudgetLimit'];
  const missingFields = requiredFields.filter(field => config[field] === undefined);

  if (missingFields.length > 0) {
    throw new Error(`Model config '${name}' is missing required fields: ${missingFields.join(', ')}`);
  }

  const numericFields = ['inputCostPer1M', 'outputCostPer1M', 'dailyBudgetLimit'];
  for (const field of numericFields) {
    if (typeof config[field] !== 'number' || isNaN(config[field])) {
      throw new Error(`Model config '${name}' has invalid ${field}: ${config[field]}`);
    }
  }

  return true;
}

// Validate all configs on startup
for (const [name, config] of Object.entries(MODEL_CONFIGS)) {
  validateModelConfig(config, name);
}

const MODEL_MODE = (process.env.MODEL_MODE || 'sonnet').toLowerCase();
const COST_CONFIG = MODEL_CONFIGS[MODEL_MODE];

if (!COST_CONFIG) {
  console.error(`Invalid MODEL_MODE: ${MODEL_MODE}. Must be one of: ${Object.keys(MODEL_CONFIGS).join(', ')}`);
  process.exit(1);
}

let cbnPromptContent = '';
let cbnPricingPromptContent = '';
let cbnSessions = {};
let costTracking = {
  dailySpend: {},
  sessionSpend: {},
  playerLifetimeCost: {}
};

// Benford's Law implementation for generating natural-looking account balances
function generateBenfordBalance() {
  // Benford's Law distribution for first digit (1-9)
  const benfordProbabilities = [
    0.301, // 1
    0.176, // 2
    0.125, // 3
    0.097, // 4
    0.079, // 5
    0.067, // 6
    0.058, // 7
    0.051, // 8
    0.046  // 9
  ];

  // Generate first digit using Benford's distribution
  const rand = Math.random();
  let cumulative = 0;
  let firstDigit = 1;

  for (let i = 0; i < benfordProbabilities.length; i++) {
    cumulative += benfordProbabilities[i];
    if (rand < cumulative) {
      firstDigit = i + 1;
      break;
    }
  }

  // Add 2-4 additional random digits
  const additionalDigits = Math.floor(Math.random() * 3) + 2; // 2, 3, or 4
  let balance = firstDigit;

  for (let i = 0; i < additionalDigits; i++) {
    balance = balance * 10 + Math.floor(Math.random() * 10);
  }

  return balance;
}

// Generate CBN greeting based on account balance
function generateCBNGreeting(accountBalance) {
  let greetingTone;
  let balanceComment;

  if (accountBalance >= 10000) {
    greetingTone = "Welcome back, most esteemed patron! It is our HONOR to serve you today!";
    balanceComment = "Your substantial balance reflects your status as one of our most valued customers.";
  } else if (accountBalance >= 1000) {
    greetingTone = "Greetings, valued customer!";
    balanceComment = "A healthy balance for exploring our marketplace.";
  } else if (accountBalance >= 100) {
    greetingTone = "Welcome, adventurer.";
    balanceComment = "You have funds available for browsing our more affordable selections.";
  } else if (accountBalance >= 10) {
    greetingTone = "Welcome. Current balance noted.";
    balanceComment = "Limited selections available at your price point.";
  } else if (accountBalance >= 0) {
    greetingTone = "Welcome. Your account requires attention.";
    balanceComment = "Perhaps you'd like to DEPOSIT funds or SELL items to increase your balance?";
  } else {
    greetingTone = "Welcome. Your account is OVERDRAWN.";
    balanceComment = "Browse only - purchases disabled until balance restored.";
  }

  return `*The crystal ball's surface ripples like quicksilver before resolving into soft, glowing text...*

**Welcome to the Crystal Ball Network**
*Powered by the White Tower Banking Company*

${greetingTone}

Your current account balance is **${accountBalance} gold pieces**. ${balanceComment}

**How can the CBN assist you today?**

- **SHOP**: Speak your search query to browse magical items from across the realm
- **SELL**: Describe an item you wish to list on the CBN marketplace
- **DEPOSIT**: Add gold to your CBN account for future purchases
- **WITHDRAW**: Transfer gold from your CBN account to physical currency
- **FINANCIAL PRODUCTS**: Browse White Tower Banking investment opportunities - annuities, stocks, and bonds
- **ACCOUNT**: View transaction history and account details

*The network awaits your command. What treasures do you seek?*`;
}

async function initialize() {
  console.log('Loading CBN system prompt...');
  try {
    cbnPromptContent = await fs.readFile(CBN_PROMPT_PATH, 'utf-8');
    console.log('CBN system prompt loaded successfully');
  } catch (error) {
    console.error('FATAL ERROR: Could not load CBN system prompt:', error);
    console.error('Make sure cbn_system_prompt.md exists in the src directory');
    process.exit(1);
  }

  console.log('Loading CBN pricing prompt...');
  try {
    cbnPricingPromptContent = await fs.readFile(CBN_PRICING_PROMPT_PATH, 'utf-8');
    console.log('CBN pricing prompt loaded successfully');
  } catch (error) {
    console.error('FATAL ERROR: Could not load CBN pricing prompt:', error);
    console.error('Make sure cbn_pricing_prompt.md exists in the src directory');
    process.exit(1);
  }

  console.log('Loading sessions...');
  try {
    const data = await fs.readFile(SESSIONS_FILE, 'utf-8');
    cbnSessions = JSON.parse(data);
    console.log(`Loaded ${Object.keys(cbnSessions).length} sessions`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing sessions file found, starting fresh');
      cbnSessions = {};
      await saveSessions();
    } else {
      console.error('Error loading sessions:', error);
    }
  }

  console.log('Loading cost tracking...');
  try {
    const data = await fs.readFile(COST_TRACKING_FILE, 'utf-8');
    costTracking = JSON.parse(data);
    console.log('Cost tracking loaded');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing cost tracking file found, starting fresh');
      await saveCostTracking();
    } else {
      console.error('Error loading cost tracking:', error);
    }
  }
}

async function saveSessions() {
  try {
    await fs.writeFile(SESSIONS_FILE, JSON.stringify(cbnSessions, null, 2));
  } catch (error) {
    console.error('Error saving sessions:', error);
  }
}

async function saveCostTracking() {
  try {
    await fs.writeFile(COST_TRACKING_FILE, JSON.stringify(costTracking, null, 2));
  } catch (error) {
    console.error('Error saving cost tracking:', error);
  }
}

function calculateCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, config) {
  const inputCost = (inputTokens / 1000000) * config.inputCostPer1M;
  const outputCost = (outputTokens / 1000000) * config.outputCostPer1M;
  const cacheWriteCost = (cacheCreationTokens / 1000000) * (config.cacheWriteCostPer1M || 0);
  const cacheReadCost = (cacheReadTokens / 1000000) * (config.cacheReadCostPer1M || 0);

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

function getTodaySpend() {
  const today = new Date().toISOString().split('T')[0];
  return costTracking.dailySpend[today] || 0;
}

async function trackCost(threadId, usage) {
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;

  const session = cbnSessions[threadId];
  const playerModelMode = session?.modelMode || MODEL_MODE;
  const playerConfig = MODEL_CONFIGS[playerModelMode] || COST_CONFIG;

  const cost = calculateCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, playerConfig);
  const today = new Date().toISOString().split('T')[0];

  if (isNaN(cost)) {
    console.error('Cost calculation resulted in NaN:', {
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      playerConfig,
      usage
    });
    throw new Error('Cost calculation failed - resulted in NaN');
  }

  if (!costTracking.dailySpend[today]) {
    costTracking.dailySpend[today] = 0;
  }
  costTracking.dailySpend[today] += cost;

  if (!costTracking.sessionSpend[threadId]) {
    costTracking.sessionSpend[threadId] = {
      total: 0,
      messages: 0,
      totalCacheReads: 0,
      totalCacheWrites: 0,
      history: []
    };
  }

  if (isNaN(costTracking.sessionSpend[threadId].total)) {
    costTracking.sessionSpend[threadId].total = 0;
  }

  costTracking.sessionSpend[threadId].total += cost;
  costTracking.sessionSpend[threadId].messages += 1;
  costTracking.sessionSpend[threadId].totalCacheReads += cacheReadTokens;
  costTracking.sessionSpend[threadId].totalCacheWrites += cacheCreationTokens;
  costTracking.sessionSpend[threadId].history.push({
    timestamp: new Date().toISOString(),
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    cost
  });

  if (session && session.playerId) {
    if (!costTracking.playerLifetimeCost) {
      costTracking.playerLifetimeCost = {};
    }

    if (!costTracking.playerLifetimeCost[session.playerId]) {
      costTracking.playerLifetimeCost[session.playerId] = {
        total: 0,
        messages: 0,
        playerName: session.playerName
      };
    }

    if (isNaN(costTracking.playerLifetimeCost[session.playerId].total)) {
      costTracking.playerLifetimeCost[session.playerId].total = 0;
    }

    costTracking.playerLifetimeCost[session.playerId].total += cost;
    costTracking.playerLifetimeCost[session.playerId].messages += 1;
    costTracking.playerLifetimeCost[session.playerId].playerName = session.playerName;
  }

  await saveCostTracking();

  const lifetimeCost = session ? (costTracking.playerLifetimeCost[session.playerId]?.total || 0) : 0;

  return {
    messageCost: cost,
    sessionTotal: costTracking.sessionSpend[threadId].total,
    messageNumber: costTracking.sessionSpend[threadId].messages,
    dailyTotal: costTracking.dailySpend[today],
    lifetimeCost: lifetimeCost
  };
}

function getSystemPrompt(accountBalance) {
  return [
    {
      type: 'text',
      text: cbnPromptContent
    },
    {
      type: 'text',
      text: `CURRENT CUSTOMER ACCOUNT BALANCE: ${accountBalance} gp

Remember to adjust your tone and suggestions based on this balance according to the personality adjustment guidelines.`
    }
  ];
}

async function sendToClaudeAPI(messages, threadId, accountBalance) {
  const session = cbnSessions[threadId];
  const playerModelMode = session?.modelMode || MODEL_MODE;
  const config = MODEL_CONFIGS[playerModelMode];

  // Strip out itemsData before sending to API (it's only for our internal tracking)
  const cleanMessages = messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));

  if (config.provider === 'anthropic') {
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: 2048,
      system: getSystemPrompt(accountBalance),
      messages: cleanMessages
    });

    await trackCost(threadId, response.usage);

    return { text: response.content[0].text, shouldFilterByBudget: false };
  } else if (config.provider === 'openai') {
    const systemPrompt = getSystemPrompt(accountBalance);
    const systemMessage = systemPrompt.map(p => p.text).join('\n\n');

    const openaiMessages = [
      { role: 'system', content: systemMessage },
      ...cleanMessages
    ];

    const response = await openai.chat.completions.create({
      model: config.model,
      messages: openaiMessages,
      max_tokens: 2048
    });

    const usage = {
      input_tokens: response.usage.prompt_tokens,
      output_tokens: response.usage.completion_tokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    };

    await trackCost(threadId, usage);

    // OpenAI doesn't support tool use in the same way, so always return false for budget filtering
    return { text: response.choices[0].message.content, shouldFilterByBudget: false };
  }

  throw new Error(`Unknown provider: ${config.provider}`);
}

function formatItemAsMarkdown(item, index, price) {
  const attunementText = item.requiresAttunement
    ? item.attunementRequirement
      ? `(requires attunement ${item.attunementRequirement})`
      : '(requires attunement)'
    : '(no attunement)';

  let markdown = `### ${item.name}\n`;
  markdown += `*${item.itemType}, ${item.rarity} ${attunementText}*\n\n`;
  markdown += `${item.description}\n\n`;
  markdown += `**History:** ${item.history}\n\n`;
  markdown += `**Properties:** ${item.properties}\n\n`;
  markdown += `**Complication:** ${item.complication}\n\n`;
  markdown += `**Price: ${price} gp**\n\n`;
  markdown += `---\n`;

  return markdown;
}

function parseAndFormatResponse(responseText, prices) {
  console.log('[FORMAT] Attempting to parse response as JSON...');

  // Try to extract JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log('[FORMAT] No JSON found in response, treating as plain text');
    return { type: 'plain', content: responseText, items: [] };
  }

  try {
    const data = JSON.parse(jsonMatch[0]);
    console.log(`[FORMAT] Successfully parsed JSON with ${data.items?.length || 0} items`);

    if (!data.items || data.items.length === 0) {
      // Non-item response (account query, etc.)
      return { type: 'plain', content: data.message || responseText, items: [] };
    }

    // Format items as markdown
    let formattedResponse = '';

    if (data.message) {
      formattedResponse += `${data.message}\n\n`;
    }

    data.items.forEach((item, index) => {
      const price = prices && prices[index] !== undefined ? prices[index] : '[Price TBD]';
      formattedResponse += formatItemAsMarkdown(item, index, price);
      formattedResponse += '\n';
    });

    console.log(`[FORMAT] Formatted ${data.items.length} items as markdown`);
    return {
      type: 'items',
      content: formattedResponse,
      items: data.items,
      rawJson: data
    };

  } catch (error) {
    console.error('[FORMAT] JSON parsing failed:', error);
    console.log('[FORMAT] Falling back to plain text');
    return { type: 'plain', content: responseText, items: [] };
  }
}

async function addPricingToItems(items, threadId) {
  if (!items || items.length === 0) {
    console.log('[PRICING] No items to price');
    return [];
  }

  console.log('=== PRICING SYSTEM START ===');
  console.log(`[PRICING] Pricing ${items.length} items`);

  const session = cbnSessions[threadId];
  const playerModelMode = session?.modelMode || MODEL_MODE;
  const config = MODEL_CONFIGS[playerModelMode];

  try {
    // Convert items to JSON string for pricing
    const itemsForPricing = JSON.stringify(items, null, 2);
    console.log(`[PRICING] Sending ${itemsForPricing.length} characters to pricing model`);

    let pricingResponse;
    const pricingModel = config.provider === 'anthropic' ? 'claude-haiku-4-5' : 'gpt-4o-mini';
    console.log(`[PRICING] Requesting prices from ${pricingModel}...`);

    if (config.provider === 'anthropic') {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: cbnPricingPromptContent,
        messages: [{ role: 'user', content: itemsForPricing }]
      });

      await trackCost(threadId, response.usage);
      pricingResponse = response.content[0].text;
      console.log(`[PRICING] Received response (${response.usage.input_tokens} input tokens, ${response.usage.output_tokens} output tokens)`);
    } else if (config.provider === 'openai') {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: cbnPricingPromptContent },
          { role: 'user', content: itemsForPricing }
        ],
        max_tokens: 1024
      });

      const usage = {
        input_tokens: response.usage.prompt_tokens,
        output_tokens: response.usage.completion_tokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      };

      await trackCost(threadId, usage);
      pricingResponse = response.choices[0].message.content;
      console.log(`[PRICING] Received response (${usage.input_tokens} input tokens, ${usage.output_tokens} output tokens)`);
    }

    console.log(`[PRICING] Raw pricing response:\n${pricingResponse}`);

    // Parse JSON array of prices
    const jsonMatch = pricingResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Pricing response did not contain valid JSON array');
    }

    const prices = JSON.parse(jsonMatch[0]);
    console.log(`[PRICING] Parsed ${prices.length} prices:`, prices);

    if (prices.length !== items.length) {
      console.warn(`[PRICING] WARNING: Price count (${prices.length}) doesn't match item count (${items.length})`);
    }

    console.log('=== PRICING SYSTEM COMPLETE ===\n');
    return prices;

  } catch (error) {
    console.error('=== PRICING SYSTEM ERROR ===');
    console.error('[PRICING] Error adding pricing:', error);
    console.error('[PRICING] Error stack:', error.stack);
    // Fallback: return placeholder prices
    const fallbackPrices = items.map(() => '[Price TBD]');
    console.log(`[PRICING] Using fallback pricing for ${items.length} items`);
    console.log('=== PRICING SYSTEM COMPLETE (FALLBACK) ===\n');
    return fallbackPrices;
  }
}

function splitMessage(text, maxLength = 2000) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  const paragraphs = text.split('\n\n');
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if ((currentChunk + '\n\n' + paragraph).length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      if (paragraph.length > maxLength) {
        const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
        for (const sentence of sentences) {
          if ((currentChunk + ' ' + sentence).length > maxLength) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = sentence;
          } else {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
          }
        }
      } else {
        currentChunk = paragraph;
      }
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text.substring(0, maxLength)];
}

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

      const isReadOnly = name !== GAME_CHANNEL_NAME && name !== 'bot-commands';

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

async function bootstrapServer(guild, statusMessage) {
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

    const chunks = splitContent(config.content);
    for (const chunk of chunks) {
      await channel.send(chunk);
      await new Promise(resolve => setTimeout(resolve, 500));
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
    let skipped = 0;

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
        const db = require('./database/db');
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

      const headerTemplate = await fs.readFile(
        path.join(__dirname, 'templates', 'inventory_header.md'),
        'utf-8'
      );

      const headerContent = headerTemplate
        .replace('{balance}', player.account_balance_gp)
        .replace('{count}', 0)
        .replace('{value}', 0);

      const headerMessage = await thread.send(headerContent);

      // Populate with existing items from database
      const existingItems = Item.getPlayerInventory(player.player_id, true, false);

      if (existingItems.length > 0) {
        console.log(`[BOOTSTRAP] Populating ${existingItems.length} existing items for ${member.user.username}`);

        for (const dbItem of existingItems) {
          const itemMarkdown = formatItemAsMarkdown(
            {
              name: dbItem.name,
              itemType: dbItem.item_type,
              rarity: dbItem.rarity,
              requiresAttunement: Boolean(dbItem.requires_attunement),
              attunementRequirement: dbItem.attunement_requirement,
              description: dbItem.description,
              history: dbItem.history,
              properties: dbItem.properties,
              complication: dbItem.complication
            },
            0,
            dbItem.purchase_price_gp
          ).replace('**Price:', '*Purchased for:');

          const itemMessage = await thread.send(itemMarkdown);
          await itemMessage.react('💰');
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Update header with correct counts
        const totalValue = existingItems.reduce((sum, i) => sum + (i.purchase_price_gp || 0), 0);
        const updatedHeader = headerTemplate
          .replace('{balance}', player.account_balance_gp)
          .replace('{count}', existingItems.length)
          .replace('{value}', totalValue);

        await headerMessage.edit(updatedHeader);
      }

      // Lock the thread to make it read-only
      await thread.setLocked(true);

      InventoryThread.create(player.player_id, thread.id, headerMessage.id);

      created++;
      console.log(`[BOOTSTRAP] Created inventory for ${member.user.username}`);
    }

    console.log(`[BOOTSTRAP] Inventory initialization: Created ${created}, skipped ${skipped}`);
  }

  await updateStatus('Bootstrap complete! The Crystal Ball Network is ready.');
  } catch (error) {
    console.error('Bootstrap error:', error);
    await updateStatus(`Bootstrap failed: ${error.message}. Please check bot permissions.`);
    throw error;
  }
}

function splitContent(content, maxLength = 2000) {
  if (content.length <= maxLength) {
    return [content];
  }

  const chunks = [];
  const lines = content.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    if ((currentChunk + '\n' + line).length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      if (line.length > maxLength) {
        const words = line.split(' ');
        for (const word of words) {
          if ((currentChunk + ' ' + word).length > maxLength) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = word;
          } else {
            currentChunk += (currentChunk ? ' ' : '') + word;
          }
        }
      } else {
        currentChunk = line;
      }
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [content.substring(0, maxLength)];
}

async function shareStory(message, threadId) {
  const session = cbnSessions[threadId];

  const dmResponses = session.messages.filter(m => m.role === 'assistant');

  if (dmResponses.length === 0) {
    await message.reply('No CBN interactions to share yet. Start browsing the marketplace first!');
    return;
  }

  const playerName = session.playerName;
  const startDate = new Date(session.startedAt).toLocaleDateString();
  const messageCount = session.messages.length;
  const shortThreadId = threadId.substring(0, 8);

  const header = `# ${playerName}'s Crystal Ball Network Session
**Started:** ${startDate}
**Thread ID:** ${shortThreadId}
**Messages:** ${messageCount}

---

`;

  let storyText = header;
  for (const msg of session.messages) {
    if (msg.role === 'user') {
      storyText += `**${playerName}:** ${msg.content}\n\n`;
    } else {
      storyText += `${msg.content}\n\n---\n\n`;
    }
  }

  const sharedThreadName = `Share - ${playerName}: ${shortThreadId}`;

  let sharedThread = null;

  if (session.sharedThreadId) {
    try {
      sharedThread = await message.channel.threads.fetch(session.sharedThreadId);
      await sharedThread.delete();
      console.log(`Deleted existing shared thread: ${session.sharedThreadId}`);
      sharedThread = null;
    } catch (error) {
      console.log('Shared thread not found or already deleted, creating new one');
    }
  }

  const gameChannel = await message.guild.channels.fetch(message.channel.parentId);

  sharedThread = await gameChannel.threads.create({
    name: sharedThreadName,
    autoArchiveDuration: 10080,
    type: ChannelType.PublicThread,
    reason: `Sharing CBN session for ${playerName}`
  });

  const chunks = splitMessage(storyText);
  for (const chunk of chunks) {
    await sharedThread.send(chunk);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const filename = `${playerName}_${new Date().toISOString().split('T')[0]}_${shortThreadId}.md`;
  const attachment = new AttachmentBuilder(Buffer.from(storyText), { name: filename });

  await sharedThread.send({
    content: '*Download your session transcript:*',
    files: [attachment]
  });

  await sharedThread.setLocked(true);

  session.sharedThreadId = sharedThread.id;
  await saveSessions();

  await message.reply(`Your CBN session has been shared! Check out: ${sharedThread.toString()}`);
}

async function showCostInfo(message, threadId) {
  const session = cbnSessions[threadId];
  const sessionCost = costTracking.sessionSpend[threadId];
  const playerCost = costTracking.playerLifetimeCost[session.playerId];
  const todaySpend = getTodaySpend();

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
      text: `Use !fast (haiku), !fancy (sonnet), or !cheap (gpt-4o-mini) to switch models`
    });

  await message.reply({ embeds: [embed] });
}

client.once('ready', async () => {
  await initialize();
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Model mode: ${MODEL_MODE} (${COST_CONFIG.model})`);
  console.log('Crystal Ball Network is online!');
});

// Handle new members joining the server
client.on('guildMemberAdd', async (member) => {
  try {
    console.log(`[MEMBER JOIN] ${member.user.username} joined ${member.guild.name}`);

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
    const accountsChannel = member.guild.channels.cache.find(
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

    // Load inventory header template
    const headerTemplate = await fs.readFile(
      path.join(__dirname, 'templates', 'inventory_header.md'),
      'utf-8'
    );

    // Format header with player data
    const headerContent = headerTemplate
      .replace('{balance}', player.account_balance_gp)
      .replace('{count}', 0)
      .replace('{value}', 0);

    // Send header message
    const headerMessage = await thread.send(headerContent);

    // Lock the thread to make it read-only
    await thread.setLocked(true);

    // Store inventory thread in database
    InventoryThread.create(player.player_id, thread.id, headerMessage.id);

    console.log(`[MEMBER JOIN] Created inventory thread for ${member.user.username}: ${thread.name}`);

  } catch (error) {
    console.error('[MEMBER JOIN] Error creating inventory thread:', error);
  }
});

// Handle reaction additions for purchases and sells
client.on('messageReactionAdd', async (reaction, user) => {
  // Ignore bot reactions
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

  // Fetch partial message if needed
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

  // Handle shopping cart emoji (purchase)
  if (emoji === '🛒') {
    try {
      // Find the session for this thread
      const threadId = message.channel.id;
      const session = cbnSessions[threadId];

      if (!session) {
        await message.channel.send('This search session is no longer active. Please start a new search by typing your query in #crystal-ball-network.');
        return;
      }

      // Find the item associated with this message
      const itemData = session.messages
        .filter(m => m.itemsData?.itemMessages)
        .flatMap(m => m.itemsData.itemMessages)
        .find(im => im.messageId === message.id);

      if (!itemData) {
        return;
      }

      const item = itemData.item;
      const price = item.priceGp;

      // Get player from database
      const player = Player.getByDiscordId(user.id);
      if (!player) {
        await message.channel.send(`Error: Player not found in database.`);
        return;
      }

      // Check if player has enough funds
      if (player.account_balance_gp < price) {
        // Remove the cart reaction to acknowledge the attempt
        await reaction.users.remove(user.id);

        await message.channel.send(
          `Insufficient funds! **${item.name}** costs **${price} gp** but you only have **${player.account_balance_gp} gp**.`
        );
        return;
      }

      // Save item to database first
      const dbItem = Item.create(item, price);
      console.log(`[PURCHASE] Created item in database: ${dbItem.item_id}`);

      // Add item to player inventory
      Item.addToInventory(dbItem.item_id, player.player_id, price);
      console.log(`[PURCHASE] Added item to player inventory in database`);

      // Deduct gold
      Player.deductGold(player.player_id, price);
      console.log(`[PURCHASE] Deducted ${price}gp from player ${player.username}`);

      // Get updated player balance
      const updatedPlayer = Player.getById(player.player_id);

      // Find or get inventory thread
      let invThread = InventoryThread.getByPlayerId(player.player_id);
      if (!invThread) {
        console.error('[PURCHASE] No inventory thread found for player');
        await message.channel.send('Error: Inventory thread not found.');
        return;
      }

      // Fetch the inventory thread channel
      const inventoryChannel = await message.guild.channels.fetch(invThread.discord_thread_id);
      if (!inventoryChannel) {
        console.error('[PURCHASE] Could not fetch inventory channel');
        return;
      }

      // Unlock inventory thread to post item
      await inventoryChannel.setLocked(false);

      // Format item for inventory (same format, but mark as purchased)
      const inventoryItemMarkdown = formatItemAsMarkdown(item, 0, price)
        .replace('**Price:', '*Purchased for:');

      // Post item in inventory thread
      const inventoryMessage = await inventoryChannel.send(inventoryItemMarkdown);

      // Add sell reaction to inventory item
      await inventoryMessage.react('💰');

      console.log(`[PURCHASE] Posted item to inventory thread`);

      // Update inventory header
      const headerMessage = await inventoryChannel.messages.fetch(invThread.header_message_id);
      const headerTemplate = await fs.readFile(
        path.join(__dirname, 'templates', 'inventory_header.md'),
        'utf-8'
      );

      // Get current item count
      const inventory = Item.getPlayerInventory(player.player_id, true, false);
      const totalValue = inventory.reduce((sum, i) => sum + (i.purchase_price_gp || 0), 0);

      const updatedHeader = headerTemplate
        .replace('{balance}', updatedPlayer.account_balance_gp)
        .replace('{count}', inventory.length + 1)  // +1 for the item we just added
        .replace('{value}', totalValue + price);

      await headerMessage.edit(updatedHeader);
      console.log(`[PURCHASE] Updated inventory header`);

      // Re-lock inventory thread
      await inventoryChannel.setLocked(true);

      // Delete item from search thread
      await message.delete();

      // Send simplified confirmation
      await message.channel.send(`Bought: **${item.name}** for **${price} gp**`);

      console.log(`[PURCHASE] Purchase complete for ${user.username}`);

    } catch (error) {
      console.error('[PURCHASE] Error processing purchase:', error);
      await message.channel.send(`Error processing purchase: ${error.message}`);
    }
  }

  // Handle money bag emoji (sell - Phase 2)
  if (emoji === '💰') {
    try {
      console.log(`[SELL] User ${user.username} clicked sell emoji on message ${message.id} - feature not yet implemented`);
      // TODO: Phase 2 - Create sell thread
    } catch (error) {
      console.error('[SELL] Error:', error);
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Bootstrap command - server owner only
  if (message.content === '!bootstrap') {
    if (message.author.id !== message.guild.ownerId) {
      await message.reply('Only the server owner can use this command.');
      return;
    }

    // Delete the user's command
    try {
      await message.delete();
    } catch (error) {
      console.warn('Could not delete !bootstrap command:', error.message);
    }

    const statusMessage = await message.channel.send('Initializing Crystal Ball Network bootstrap...');
    await bootstrapServer(message.guild, statusMessage);

    // Delete the status message after completion
    setTimeout(async () => {
      try {
        await statusMessage.delete();
      } catch (error) {
        console.warn('Could not delete bootstrap status message:', error.message);
      }
    }, 5000);

    return;
  }

  // Handle crystal-ball-network channel
  if (message.channel.name === GAME_CHANNEL_NAME && message.channel.type === ChannelType.GuildText) {
    try {
      // Get or create player
      const player = Player.getOrCreate(message.author.id, message.author.username, 500);
      console.log(`[SEARCH] Player ${player.username} starting search (balance: ${player.account_balance_gp}gp)`);

      // Store the user's search query
      const userQuery = message.content;

      // Delete the user's message immediately
      await message.delete();

      // Send immediate confirmation in main channel (will be deleted after thread is created)
      const confirmation = await message.channel.send(
        `Opening search portal for ${message.author}...`
      );

      // Create ephemeral search thread with truncated query
      // Truncate query to fit Discord's 100 character limit for thread names
      const maxQueryLength = 100 - message.author.username.length - 8; // "search-" (7) + "-" (1) = 8
      const truncatedQuery = userQuery.length > maxQueryLength
        ? userQuery.substring(0, maxQueryLength - 3) + '...'
        : userQuery;
      const threadName = `search-${message.author.username}-${truncatedQuery}`;

      const thread = await message.channel.threads.create({
        name: threadName,
        autoArchiveDuration: 60, // 1 hour (shortest Discord allows)
        type: ChannelType.PrivateThread,
        reason: `Creating search session for ${message.author.username}`
      });

      // Add member to thread
      await thread.members.add(message.author.id);

      // Create session with user's query
      cbnSessions[thread.id] = {
        playerId: message.author.id,
        playerName: message.author.username,
        startedAt: new Date().toISOString(),
        accountBalance: player.account_balance_gp,
        messages: [],
        modelMode: MODEL_MODE,
        sessionType: 'search'
      };

      // Send immediate acknowledgment with balance-appropriate tone
      let searchingMessage = '';
      if (player.account_balance_gp >= 10000) {
        searchingMessage = `*The crystal ball flickers to life with brilliant, welcoming radiance*\n\nMOST ESTEEMED PATRON! Your account balance is **${player.account_balance_gp} gp** - truly magnificent! It is my HONOR to search for "${userQuery}" immediately!\n\n*The network hums with eager energy as I compile the finest selections for you...*`;
      } else if (player.account_balance_gp >= 1000) {
        searchingMessage = `*The crystal ball flickers to life with a warm, professional glow*\n\nWelcome back, valued customer! Your account balance is **${player.account_balance_gp} gp**. Searching for "${userQuery}"...\n\n*The network processes your request...*`;
      } else if (player.account_balance_gp >= 100) {
        searchingMessage = `*The crystal ball flickers to life with a businesslike shimmer*\n\nYour account balance is **${player.account_balance_gp} gp**. Searching for "${userQuery}"... let's see what we have in your price range.\n\n*The network searches...*`;
      } else if (player.account_balance_gp >= 10) {
        searchingMessage = `*The crystal ball flickers to life with a distinctly unenthusiastic shimmer*\n\n*Sigh.* Another window shopper. Your account balance is **${player.account_balance_gp} gp**. You want "${userQuery}"? Let me see what scraps I can find...\n\n*The network searches with minimal enthusiasm...*`;
      } else {
        searchingMessage = `*The crystal ball flickers to life with a distinctly unenthusiastic shimmer*\n\nOh. Another window shopper. Your account balance is **${player.account_balance_gp} gp** - that's right, ${player.account_balance_gp === 0 ? 'ZERO. Zilch. Nada. Nothing.' : 'practically nothing.'}  Why are you even HERE?\n\n*Heavy, theatrical sigh*\n\nBut FINE, I suppose I'll show you "${userQuery}" since you asked. Not that you can afford ANY of them. Maybe this will motivate you to go do some ACTUAL adventuring and come back when you have REAL money.\n\n*The network searches, grudgingly...*`;
      }

      await thread.send(searchingMessage);

      // Add the searching message to history so AI doesn't repeat it
      cbnSessions[thread.id].messages.push({
        role: 'assistant',
        content: searchingMessage
      });

      // Now send the user's actual search query
      await thread.sendTyping();

      const userPrompt = `"${userQuery}"`;

      cbnSessions[thread.id].messages.push({
        role: 'user',
        content: userPrompt
      });

      const apiResponse = await sendToClaudeAPI(cbnSessions[thread.id].messages, thread.id, player.account_balance_gp);
      const rawResponse = apiResponse.text;

      // Parse and format response
      const parsed = parseAndFormatResponse(rawResponse, null);

      let finalResponse = rawResponse;
      let itemsData = null;

      if (parsed.type === 'items') {
        // Get prices for items
        const prices = await addPricingToItems(parsed.items, thread.id);

        // Check if Claude requested budget filtering via JSON field
        const shouldFilterByBudget = parsed.rawJson?.filterByBudget === true;

        // Conditionally filter based on whether Claude requested it
        let affordableItems = parsed.items;
        let affordablePrices = prices;

        if (shouldFilterByBudget) {
          console.log('[FILTER] Budget filtering requested by Claude (filterByBudget: true)');
          affordableItems = [];
          affordablePrices = [];

          for (let i = 0; i < parsed.items.length; i++) {
            if (prices[i] <= player.account_balance_gp) {
              affordableItems.push(parsed.items[i]);
              affordablePrices.push(prices[i]);
            }
          }

          console.log(`[FILTER] Filtered ${parsed.items.length} items to ${affordableItems.length} affordable items (budget: ${player.account_balance_gp}gp)`);
        } else {
          console.log('[FILTER] No budget filtering - showing all items');
        }

        // Check if any items remain after filtering
        if (affordableItems.length === 0) {
          await thread.send(
            `*The Curator rubs their temples and sighs.*\n\n` +
            `"I'm afraid ALL the items I was about to show you exceed your current balance of **${player.account_balance_gp} gp**. ` +
            `Perhaps try a more... modest search query? Or consider items of common or uncommon rarity within your price range."`
          );

          // Store a summary for conversation history
          finalResponse = `Generated ${parsed.items.length} items, but all were too expensive for the player's ${player.account_balance_gp}gp budget.`;
        } else {
          // Send intro message if present
          if (parsed.rawJson?.message) {
            await thread.send(parsed.rawJson.message);
            await new Promise(resolve => setTimeout(resolve, 300));
          }

          // Notify if some items were filtered
          if (affordableItems.length < parsed.items.length) {
            const filtered = parsed.items.length - affordableItems.length;
            await thread.send(
              `*The Curator discretely sets aside ${filtered} item${filtered > 1 ? 's' : ''} that exceed${filtered === 1 ? 's' : ''} your current budget...*`
            );
            await new Promise(resolve => setTimeout(resolve, 300));
          }

          // Send each affordable item as a separate message with shopping cart reaction
          const itemMessages = [];
          for (let i = 0; i < affordableItems.length; i++) {
            const item = affordableItems[i];
            const price = affordablePrices[i];

            // Format single item as markdown
            const itemMarkdown = formatItemAsMarkdown(item, i, price);

            // Send item message
            const itemMessage = await thread.send(itemMarkdown);

            // Add shopping cart reaction
            await itemMessage.react('🛒');

            // Store message ID for purchase tracking
            itemMessages.push({
              messageId: itemMessage.id,
              item: { ...item, priceGp: price }
            });

            await new Promise(resolve => setTimeout(resolve, 500));
          }

          // Store items data for session
          itemsData = {
            rawJson: parsed.rawJson,
            items: affordableItems.map((item, index) => ({
              ...item,
              priceGp: affordablePrices[index]
            })),
            itemMessages: itemMessages
          };

          // Create a summary for conversation history
          finalResponse = parsed.rawJson?.message || `Generated ${affordableItems.length} affordable items (${parsed.items.length - affordableItems.length} filtered)`;
        }

      } else {
        // Plain text response (account queries, etc.)
        finalResponse = parsed.content;

        // Send plain text response
        const chunks = splitMessage(finalResponse);
        for (const chunk of chunks) {
          await thread.send(chunk);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Store assistant response
      cbnSessions[thread.id].messages.push({
        role: 'assistant',
        content: finalResponse,
        itemsData: itemsData
      });

      await saveSessions();

      // Delete the "opening portal" confirmation message now that thread is ready
      setTimeout(async () => {
        try {
          await confirmation.delete();
        } catch (error) {
          console.warn('Could not delete confirmation:', error.message);
        }
      }, 3000);

      console.log(`[SEARCH] Created search thread for ${message.author.username}: ${threadName}`);

    } catch (error) {
      console.error('[SEARCH] Error creating search thread:', error);
      await message.channel.send('Sorry, there was an error starting your search session. Please try again.');
    }
    return;
  }

  // Handle bot-commands channel moderation
  if (message.channel.name === 'bot-commands' && message.channel.type === ChannelType.GuildText) {
    const isCommand = ALLOWED_COMMANDS.some(cmd => message.content.startsWith(cmd));

    if (!isCommand) {
      try {
        await message.delete();
        const warning = await message.channel.send(`${message.author}, please only use \`!start\` in this channel.`);
        setTimeout(() => warning.delete().catch(() => {}), 5000);
      } catch (error) {
        console.error('Error moderating message:', error);
      }
      return;
    }

    // Handle !start command
    if (message.content === '!start') {
      try {
        const threadName = `${message.author.username}'s CBN Session`;

        const thread = await message.channel.threads.create({
          name: threadName,
          autoArchiveDuration: 1440,
          type: ChannelType.PrivateThread,
          reason: 'Starting a new Crystal Ball Network session'
        });

        await thread.members.add(message.author.id);

        const guildOwnerId = message.guild.ownerId;
        if (guildOwnerId !== message.author.id) {
          await thread.members.add(guildOwnerId);
        }

        // Generate random balance using Benford's law
        const accountBalance = generateBenfordBalance();

        // Create session
        cbnSessions[thread.id] = {
          playerId: message.author.id,
          playerName: message.author.username,
          startedAt: new Date().toISOString(),
          accountBalance: accountBalance,
          messages: [],
          modelMode: MODEL_MODE
        };

        await saveSessions();

        // Generate and send greeting
        const greeting = generateCBNGreeting(accountBalance);
        await thread.send(greeting);

        // Store greeting in session as assistant message
        cbnSessions[thread.id].messages.push({
          role: 'assistant',
          content: greeting
        });

        await saveSessions();

        // Delete the !start command
        try {
          await message.delete();
        } catch (error) {
          console.warn('Could not delete !start message:', error.message);
        }

        const confirmation = await message.channel.send(
          `*This message will self-destruct in 60 seconds.*\n\n${message.author}, your Crystal Ball Network session begins! Check the thread "${thread.name}".`
        );
        setTimeout(async () => {
          try {
            await confirmation.delete();
          } catch (error) {
            console.warn('Could not delete confirmation message:', error.message);
          }
        }, 60000);
      } catch (error) {
        console.error('Error creating thread:', error);
        await message.reply('Sorry, there was an error starting your session. Please try again.');
      }
      return;
    }
  }

  // Handle messages in threads
  if (!message.channel.isThread()) return;

  const threadId = message.channel.id;

  if (!cbnSessions[threadId]) return;

  const session = cbnSessions[threadId];

  if (message.author.id !== session.playerId) return;

  // Handle commands
  if (message.content === '!share') {
    await shareStory(message, threadId);
    return;
  }

  if (message.content === '!cost') {
    await showCostInfo(message, threadId);
    return;
  }

  if (message.content === '!fast') {
    session.modelMode = 'haiku';
    await saveSessions();
    await message.reply('Switched to fast mode (Claude Haiku 4.5). Lower cost, faster responses.');
    return;
  }

  if (message.content === '!fancy') {
    session.modelMode = 'sonnet';
    await saveSessions();
    await message.reply('Switched to fancy mode (Claude Sonnet 4.5). Highest quality responses.');
    return;
  }

  if (message.content === '!cheap') {
    session.modelMode = 'cheap';
    await saveSessions();
    await message.reply('Switched to cheap mode (GPT-4o-mini). Very low cost.');
    return;
  }

  // Check daily budget before processing
  const currentSpend = getTodaySpend();
  const playerConfig = MODEL_CONFIGS[session.modelMode] || COST_CONFIG;

  if (currentSpend >= playerConfig.dailyBudgetLimit) {
    await message.reply(
      `Daily budget limit reached ($${playerConfig.dailyBudgetLimit.toFixed(2)}). The CBN is temporarily unavailable. Try again tomorrow!`
    );
    return;
  }

  // Add user message to session
  session.messages.push({
    role: 'user',
    content: message.content
  });

  await saveSessions();

  // Show typing indicator
  await message.channel.sendTyping();

  try {
    // Send to Claude/OpenAI for item generation
    const apiResponse = await sendToClaudeAPI(session.messages, threadId, session.accountBalance);
    const rawResponse = apiResponse.text;

    // Parse and format response
    const parsed = parseAndFormatResponse(rawResponse, null);

    let finalResponse = rawResponse;
    let itemsData = null;

    if (parsed.type === 'items') {
      // Get prices for items
      const prices = await addPricingToItems(parsed.items, threadId);

      // Check if Claude requested budget filtering via JSON field
      const shouldFilterByBudget = parsed.rawJson?.filterByBudget === true;

      // Conditionally filter based on whether Claude requested it
      let affordableItems = parsed.items;
      let affordablePrices = prices;

      if (shouldFilterByBudget) {
        console.log('[FILTER] Budget filtering requested by Claude (filterByBudget: true)');
        affordableItems = [];
        affordablePrices = [];

        for (let i = 0; i < parsed.items.length; i++) {
          if (prices[i] <= session.accountBalance) {
            affordableItems.push(parsed.items[i]);
            affordablePrices.push(prices[i]);
          }
        }

        console.log(`[FILTER] Filtered ${parsed.items.length} items to ${affordableItems.length} affordable items (budget: ${session.accountBalance}gp)`);
      } else {
        console.log('[FILTER] No budget filtering - showing all items');
      }

      // Check if any items remain after filtering
      if (affordableItems.length === 0) {
        await message.channel.send(
          `*The Curator rubs their temples and sighs.*\n\n` +
          `"I'm afraid ALL the items I was about to show you exceed your current balance of **${session.accountBalance} gp**. ` +
          `Perhaps try a more... modest search query? Or consider items of common or uncommon rarity within your price range."`
        );

        // Store a summary for conversation history
        finalResponse = `Generated ${parsed.items.length} items, but all were too expensive for the player's ${session.accountBalance}gp budget.`;
      } else {
        // Send intro message if present
        if (parsed.rawJson?.message) {
          await message.channel.send(parsed.rawJson.message);
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Notify if some items were filtered
        if (affordableItems.length < parsed.items.length) {
          const filtered = parsed.items.length - affordableItems.length;
          await message.channel.send(
            `*The Curator discretely sets aside ${filtered} item${filtered > 1 ? 's' : ''} that exceed${filtered === 1 ? 's' : ''} your current budget...*`
          );
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Send each affordable item as a separate message with shopping cart reaction
        const itemMessages = [];
        for (let i = 0; i < affordableItems.length; i++) {
          const item = affordableItems[i];
          const price = affordablePrices[i];

          // Format single item as markdown
          const itemMarkdown = formatItemAsMarkdown(item, i, price);

          // Send item message
          const itemMessage = await message.channel.send(itemMarkdown);

          // Add shopping cart reaction
          await itemMessage.react('🛒');

          // Store message ID for purchase tracking
          itemMessages.push({
            messageId: itemMessage.id,
            item: { ...item, priceGp: price }
          });

          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Store items data for session
        itemsData = {
          rawJson: parsed.rawJson,
          items: affordableItems.map((item, index) => ({
            ...item,
            priceGp: affordablePrices[index]
          })),
          itemMessages: itemMessages  // Track which messages have which items
        };

        // Create a summary for conversation history
        finalResponse = parsed.rawJson?.message || `Generated ${affordableItems.length} affordable items (${parsed.items.length - affordableItems.length} filtered)`;
      }

    } else {
      // Plain text response (account queries, etc.)
      finalResponse = parsed.content;

      // Send plain text response
      const chunks = splitMessage(finalResponse);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Store assistant response (formatted markdown for display)
    session.messages.push({
      role: 'assistant',
      content: finalResponse,
      itemsData: itemsData  // Store structured data for future database export
    });

    await saveSessions();

  } catch (error) {
    console.error('Error processing message:', error);

    const errorResponse = `*The crystal ball flickers and dims momentarily...*

My apologies, esteemed customer. The CBN network experienced a momentary disruption. Please try your query again.

*Error details: ${error.message}*`;

    await message.channel.send(errorResponse);
  }
});

client.login(process.env.DISCORD_TOKEN);
