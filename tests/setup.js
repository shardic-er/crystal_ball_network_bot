/**
 * Test setup - mocks for Discord.js, Anthropic API, and test utilities
 */

const path = require('path');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.CLAUDE_API_KEY = 'test-api-key';

// Mock Discord.js classes
class MockMessage {
  constructor(options = {}) {
    this.id = options.id || `msg-${Date.now()}`;
    this.content = options.content || '';
    this.author = options.author || { id: 'user-123', username: 'TestUser', bot: false };
    this.channel = options.channel || new MockChannel();
    this.guild = options.guild || new MockGuild();
    this.reactions = { cache: new Map() };
    this.deleted = false;
  }

  async delete() {
    this.deleted = true;
    return this;
  }

  async reply(content) {
    return new MockMessage({ content: typeof content === 'string' ? content : content.content, channel: this.channel });
  }

  async react(emoji) {
    this.reactions.cache.set(emoji, { emoji: { name: emoji }, users: { remove: async () => {} } });
    return { emoji: { name: emoji } };
  }

  async edit(content) {
    this.content = typeof content === 'string' ? content : content.content;
    return this;
  }

  async fetch() {
    return this;
  }
}

class MockChannel {
  constructor(options = {}) {
    this.id = options.id || `channel-${Date.now()}`;
    this.name = options.name || 'test-channel';
    this.type = options.type || 0; // GuildText
    this.messages = {
      cache: new Map(),
      fetch: async (id) => this.messages.cache.get(id) || new MockMessage({ id })
    };
    this.threads = {
      cache: new Map(),
      create: async (opts) => {
        const thread = new MockThread({ name: opts.name, parent: this });
        this.threads.cache.set(thread.id, thread);
        return thread;
      }
    };
    this.parentId = options.parentId || null;
    this.sentMessages = [];
  }

  async send(content) {
    const msg = new MockMessage({
      content: typeof content === 'string' ? content : content.content,
      channel: this
    });
    this.sentMessages.push(msg);
    this.messages.cache.set(msg.id, msg);
    return msg;
  }

  async sendTyping() {
    return true;
  }

  isThread() {
    return false;
  }

  async setLocked(locked) {
    this.locked = locked;
    return this;
  }

  async setArchived(archived) {
    this.archived = archived;
    return this;
  }
}

class MockThread extends MockChannel {
  constructor(options = {}) {
    super(options);
    this.name = options.name || 'test-thread';
    this.parent = options.parent;
    this.members = {
      add: async () => true
    };
    this.locked = false;
    this.archived = false;
  }

  isThread() {
    return true;
  }
}

class MockGuild {
  constructor(options = {}) {
    this.id = options.id || `guild-${Date.now()}`;
    this.name = options.name || 'Test Guild';
    this.ownerId = options.ownerId || 'owner-123';
    this.channels = {
      cache: new Map(),
      fetch: async (id) => this.channels.cache.get(id),
      create: async (opts) => {
        const channel = new MockChannel({ name: opts.name, type: opts.type });
        this.channels.cache.set(channel.id, channel);
        return channel;
      }
    };
    this.members = {
      fetch: async () => new Map(),
      cache: new Map()
    };
  }
}

class MockReaction {
  constructor(options = {}) {
    this.emoji = { name: options.emoji || '\u{1F6D2}' };
    this.message = options.message || new MockMessage();
    this.partial = false;
    this.users = {
      remove: async () => true
    };
  }

  async fetch() {
    return this;
  }
}

class MockUser {
  constructor(options = {}) {
    this.id = options.id || `user-${Date.now()}`;
    this.username = options.username || 'TestUser';
    this.bot = options.bot || false;
  }
}

class MockInteraction {
  constructor(options = {}) {
    this.id = options.id || `interaction-${Date.now()}`;
    this.customId = options.customId || 'test-button';
    this.user = options.user || new MockUser();
    this.channel = options.channel || new MockThread();
    this.guild = options.guild || new MockGuild();
    this.replied = false;
    this.deferred = false;
    this.values = options.values || [];
  }

  isButton() {
    return this.customId && !this.values.length;
  }

  isStringSelectMenu() {
    return this.values && this.values.length > 0;
  }

  async deferReply(opts) {
    this.deferred = true;
    return this;
  }

  async reply(content) {
    this.replied = true;
    return new MockMessage({ content: typeof content === 'string' ? content : content.content });
  }

  async editReply(content) {
    return new MockMessage({ content: typeof content === 'string' ? content : content.content });
  }

  async update(content) {
    return this;
  }

  async followUp(content) {
    return new MockMessage({ content: typeof content === 'string' ? content : content.content });
  }

  async deferUpdate() {
    this.deferred = true;
    return this;
  }
}

// Mock Anthropic API responses
const mockClaudeResponses = {
  search: {
    items: `{
      "message": "Ah, I have found some interesting items for you...",
      "items": [
        {
          "name": "Sword of Testing",
          "itemType": "Weapon",
          "rarity": "uncommon",
          "description": "A sword used for testing purposes.",
          "history": "Forged in the test realm.",
          "properties": "Deals 1d8 slashing damage. +1 to hit.",
          "complication": "Glows when tests are running."
        }
      ]
    }`
  },
  pricing: '[150]',
  buyers: `{
    "message": "I have found some interested buyers...",
    "buyers": [
      {
        "name": "Tester the Bold",
        "title": "Quality Assurance Knight",
        "description": "A meticulous buyer who values well-tested items.",
        "motivation": "Needs equipment for the testing grounds.",
        "interestLevel": "high"
      }
    ]
  }`,
  negotiation: `{
    "response": "I can offer you 120 gold pieces.",
    "newOffer": 120,
    "isOffer": true,
    "walkAway": false
  }`,
  offerClassifier: '{"isOffer": true, "amount": 200}',
  synergy: `{
    "physicalCompatibility": { "score": 4, "reason": "Items combine well physically" },
    "complicationCountering": { "score": 3, "reason": "Neutral interaction" },
    "thematicHarmony": { "score": 4, "reason": "Themes align" },
    "powerLevelMatching": { "score": 3, "reason": "Similar power levels" },
    "historicalSynergy": { "score": 3, "reason": "No historical connection" },
    "totalBonus": 17,
    "overallAssessment": "Good synergy potential"
  }`,
  crafting: `{
    "narrative": "The items merge in a flash of arcane energy...",
    "result": {
      "name": "Combined Test Item",
      "itemType": "Wondrous item",
      "rarity": "rare",
      "description": "A magical combination of two items.",
      "history": "Created through experimental crafting.",
      "properties": "Has properties of both source items.",
      "complication": "Occasionally splits back into two items."
    }
  }`
};

// Helper to create mock API response
function createMockAPIResponse(text, inputTokens = 100, outputTokens = 50) {
  return {
    content: [{ text }],
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    }
  };
}

// Create test database path
const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test_cbn.db');

// Test data generators
function createTestPlayer(overrides = {}) {
  return {
    discord_id: overrides.discord_id || 'test-user-123',
    username: overrides.username || 'TestPlayer',
    account_balance_gp: overrides.account_balance_gp || 500
  };
}

function createTestItem(overrides = {}) {
  return {
    name: overrides.name || 'Test Sword',
    item_type: overrides.item_type || 'Weapon',
    rarity: overrides.rarity || 'uncommon',
    description: overrides.description || 'A test sword for testing.',
    history: overrides.history || 'Created for tests.',
    properties: overrides.properties || '+1 to testing.',
    complication: overrides.complication || 'None',
    base_price_gp: overrides.base_price_gp || 100
  };
}

function createTestSession(threadId, overrides = {}) {
  return {
    playerId: overrides.playerId || 'test-user-123',
    playerName: overrides.playerName || 'TestPlayer',
    startedAt: overrides.startedAt || new Date().toISOString(),
    messages: overrides.messages || [],
    modelMode: overrides.modelMode || 'haiku',
    sessionType: overrides.sessionType || 'search'
  };
}

// Assertion helpers
function assertMessageSent(channel, contentIncludes) {
  const found = channel.sentMessages.some(msg =>
    msg.content && msg.content.includes(contentIncludes)
  );
  if (!found) {
    const sent = channel.sentMessages.map(m => m.content).join('\n');
    throw new Error(`Expected message containing "${contentIncludes}" but got:\n${sent}`);
  }
}

function assertNoErrors(fn) {
  try {
    fn();
  } catch (error) {
    throw new Error(`Expected no errors but got: ${error.message}`);
  }
}

module.exports = {
  // Mock classes
  MockMessage,
  MockChannel,
  MockThread,
  MockGuild,
  MockReaction,
  MockUser,
  MockInteraction,

  // Mock API responses
  mockClaudeResponses,
  createMockAPIResponse,

  // Test data
  TEST_DB_PATH,
  createTestPlayer,
  createTestItem,
  createTestSession,

  // Assertions
  assertMessageSent,
  assertNoErrors
};
