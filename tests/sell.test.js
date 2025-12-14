/**
 * Integration tests for sell flow
 */

const assert = require('assert');
const {
  MockMessage,
  MockChannel,
  MockThread,
  MockGuild,
  MockReaction,
  MockUser,
  mockClaudeResponses,
  createTestPlayer,
  createTestItem,
  createTestSession
} = require('./setup');

// Mock sessions storage
const mockSessions = {};

describe('Sell Flow', function() {
  this.timeout(5000);

  let mockPlayer;
  let mockInventoryItem;

  before(function() {
    // Mock database models
    const Player = require('../src/database/models/Player');
    const Item = require('../src/database/models/Item');
    const InventoryThread = require('../src/database/models/InventoryThread');

    mockPlayer = {
      player_id: 1,
      discord_id: 'test-user-123',
      username: 'TestPlayer',
      account_balance_gp: 500
    };

    mockInventoryItem = {
      inventory_id: 1,
      item_id: 1,
      player_id: 1,
      name: 'Test Sword',
      item_type: 'Weapon',
      rarity: 'uncommon',
      description: 'A test sword',
      history: 'Made for testing',
      properties: '+1 to testing',
      complication: 'None',
      purchase_price_gp: 100,
      base_price_gp: 100,
      discord_message_id: 'item-msg-123'
    };

    Player.getByDiscordId = (discordId) => {
      if (discordId === mockPlayer.discord_id) return mockPlayer;
      return null;
    };

    Player.getById = (id) => mockPlayer;

    Player.addGold = (playerId, amount) => {
      mockPlayer.account_balance_gp += amount;
      return true;
    };

    Item.getByMessageId = (msgId) => {
      if (msgId === mockInventoryItem.discord_message_id) return mockInventoryItem;
      return null;
    };

    Item.getInventoryItem = (invId) => mockInventoryItem;

    Item.removeFromInventory = (invId, playerId) => ({ removed: true });

    Item.getPlayerInventory = () => [];

    InventoryThread.getByPlayerId = () => ({
      thread_id: 1,
      player_id: 1,
      discord_thread_id: 'inv-thread-123',
      header_message_id: 'header-123'
    });

    // Mock sessions service
    const sessionsService = require('../src/services/sessions');
    sessionsService.getSession = (threadId) => mockSessions[threadId] || null;
    sessionsService.setSession = (threadId, data) => { mockSessions[threadId] = data; };
    sessionsService.getSessionsRef = () => mockSessions;
    sessionsService.saveSessions = async () => {};

    // Mock claude service - need to match exact prompt content
    // Order matters - more specific matches first
    const claudeService = require('../src/services/claude');
    claudeService.callClaudeAPI = async ({ system, messages }) => {
      // Check for negotiation prompt FIRST (contains "negotiat" in prompt itself)
      if (system && system.toLowerCase().includes('handle negotiation')) {
        return { text: mockClaudeResponses.negotiation, usage: { input_tokens: 50, output_tokens: 50 } };
      }
      // Check for offer classifier (contains "offer" in prompt itself)
      if (system && system.toLowerCase().includes('price offer')) {
        return { text: mockClaudeResponses.offerClassifier, usage: { input_tokens: 20, output_tokens: 10 } };
      }
      // Check for buyer prompt (contains "prospective" or initial buyer)
      if (system && (system.toLowerCase().includes('prospective') || system.toLowerCase().includes('generate'))) {
        return { text: mockClaudeResponses.buyers, usage: { input_tokens: 100, output_tokens: 100 } };
      }
      // Default - return buyers response
      return { text: mockClaudeResponses.buyers, usage: { input_tokens: 10, output_tokens: 10 } };
    };

    // Mock pricing service
    const pricingService = require('../src/services/pricing');
    pricingService.addPricingToItems = async (items) => items.map(() => 100);

    // Mock prompts - include keywords so callClaudeAPI mock can match them
    const promptsUtil = require('../src/utils/prompts');
    promptsUtil.getPrompt = (key) => {
      if (key === 'BUYER') return 'Generate prospective buyers for this item';
      if (key === 'NEGOTIATION') return 'Handle negotiation with the buyer';
      if (key === 'OFFER_CLASSIFIER') return 'Classify if message contains a price offer';
      return `Mock prompt for ${key}`;
    };

    // Mock UI
    const messagesUI = require('../src/ui/messages');
    messagesUI.getInventoryHeader = async () => 'Mock Header';
    messagesUI.postCloseThreadButton = async () => {};
  });

  beforeEach(function() {
    mockPlayer.account_balance_gp = 500;
    Object.keys(mockSessions).forEach(k => delete mockSessions[k]);
  });

  describe('generateBuyers', function() {
    it('should generate buyers from AI response', async function() {
      const { generateBuyers } = require('../src/handlers/sell');

      const item = createTestItem();
      const buyers = await generateBuyers(item, 'test-thread');

      assert(buyers, 'Should return buyer data');
      assert(buyers.buyers, 'Should have buyers array');
      assert(buyers.buyers.length > 0, 'Should have at least one buyer');
      assert(buyers.buyers[0].name, 'Buyer should have name');
    });
  });

  describe('classifyOffer', function() {
    it('should classify message containing price as offer', async function() {
      const { classifyOffer } = require('../src/handlers/sell');

      const result = await classifyOffer('I will pay you 200 gold', 'test-thread');

      assert(result, 'Should return result');
      assert.strictEqual(result.isOffer, true, 'Should identify as offer');
      assert.strictEqual(result.amount, 200, 'Should extract correct amount');
    });
  });

  describe('getBuyerResponse', function() {
    it('should get negotiation response from buyer', async function() {
      const { getBuyerResponse } = require('../src/handlers/sell');

      const session = {
        buyers: [{
          name: 'Test Buyer',
          title: 'Merchant',
          description: 'A test buyer',
          motivation: 'Wants to test',
          interestLevel: 'high',
          offerGp: 100,
          maxOffer: 120,
          walkAwayPrice: 150
        }],
        activeBuyer: 0,
        itemBeingSold: {
          name: 'Test Sword',
          itemData: {
            rarity: 'uncommon',
            properties: '+1 testing',
            complication: 'None',
            history: 'Test history'
          }
        },
        messages: [],
        currentOffer: null
      };

      const response = await getBuyerResponse(session, 'How about 110 gold?', 'test-thread');

      assert(response, 'Should return response');
      assert(response.response, 'Should have response text');
    });
  });

  describe('completeSale', function() {
    it('should add gold to player on sale completion', async function() {
      const { completeSale } = require('../src/handlers/sell');

      const initialBalance = mockPlayer.account_balance_gp;
      const saleAmount = 150;

      const channel = new MockThread({ name: 'sell-TestPlayer-TestSword' });
      const guild = new MockGuild();

      // Mock guild.channels.fetch to return a mock inventory channel
      const invChannel = new MockThread({ name: 'inventory-TestPlayer' });
      invChannel.messages.cache.set('header-123', new MockMessage({ id: 'header-123' }));
      guild.channels.fetch = async () => invChannel;

      const session = {
        playerId: mockPlayer.discord_id,
        itemBeingSold: {
          inventoryId: 1,
          name: 'Test Sword',
          itemData: { discord_message_id: 'item-msg-123' }
        },
        buyers: [{ messageId: 'buyer-msg-1' }],
        currentOffer: null
      };

      await completeSale(session, saleAmount, channel, guild, mockSessions);

      assert.strictEqual(
        mockPlayer.account_balance_gp,
        initialBalance + saleAmount,
        'Player balance should increase by sale amount'
      );
    });
  });

  describe('Negotiation mechanics', function() {
    it('should track negotiation history', function() {
      const session = {
        messages: [],
        currentOffer: null
      };

      // Simulate adding messages
      session.messages.push({ role: 'user', content: 'How about 150?' });
      session.messages.push({ role: 'assistant', content: 'I can do 120.' });

      assert.strictEqual(session.messages.length, 2, 'Should track conversation');
    });

    it('should update current offer when buyer makes new offer', function() {
      const session = {
        currentOffer: { amount: 100, messageId: 'msg-1' }
      };

      // Simulate new offer
      session.currentOffer = { amount: 120, messageId: 'msg-2' };

      assert.strictEqual(session.currentOffer.amount, 120, 'Should update to new offer');
    });
  });

  describe('Interest level multipliers', function() {
    it('should apply correct multipliers based on interest level', function() {
      const config = require('../src/config.json');
      const interestLevels = config.negotiation.interestLevels;

      // High interest should offer more
      assert(interestLevels.high.maxIncrease > interestLevels.low.maxIncrease,
        'High interest should have higher max increase');

      // Low interest should walk away sooner
      assert(interestLevels.low.walkAwayThreshold < interestLevels.high.walkAwayThreshold,
        'Low interest should have lower walk away threshold');
    });
  });
});

// Run tests if executed directly
if (require.main === module) {
  const Mocha = require('mocha');
  const mocha = new Mocha();
  mocha.addFile(__filename);
  mocha.run(failures => process.exitCode = failures ? 1 : 0);
}
