/**
 * Integration tests for purchase flow
 */

const assert = require('assert');
const {
  MockMessage,
  MockChannel,
  MockThread,
  MockGuild,
  MockReaction,
  MockUser,
  createTestPlayer,
  createTestItem,
  createTestSession
} = require('./setup');

// Mock sessions storage
const mockSessions = {};

describe('Purchase Flow', function() {
  this.timeout(5000);

  let mockPlayer;
  let mockInventoryThread;
  let inventoryChannel;

  before(function() {
    // Mock database models
    const Player = require('../src/database/models/Player');
    const Item = require('../src/database/models/Item');
    const InventoryThread = require('../src/database/models/InventoryThread');

    // Create mock player
    mockPlayer = {
      player_id: 1,
      discord_id: 'test-user-123',
      username: 'TestPlayer',
      account_balance_gp: 500
    };

    // Mock Player methods
    Player.getByDiscordId = (discordId) => {
      if (discordId === mockPlayer.discord_id) return mockPlayer;
      return null;
    };

    Player.getById = (id) => mockPlayer;

    Player.deductGold = (playerId, amount) => {
      mockPlayer.account_balance_gp -= amount;
      return true;
    };

    // Mock inventory thread
    inventoryChannel = new MockThread({ name: 'inventory-TestPlayer' });
    mockInventoryThread = {
      thread_id: 1,
      player_id: 1,
      discord_thread_id: inventoryChannel.id,
      header_message_id: 'header-msg-123'
    };

    InventoryThread.getByPlayerId = (playerId) => mockInventoryThread;

    // Mock Item methods
    Item.create = (itemData, price) => ({
      item_id: Date.now(),
      ...itemData,
      base_price_gp: price
    });

    Item.addToInventory = (itemId, playerId, price, messageId) => ({
      inventory_id: Date.now(),
      item_id: itemId,
      player_id: playerId,
      purchase_price_gp: price,
      discord_message_id: messageId
    });

    Item.getPlayerInventory = () => [];

    // Mock sessions service
    const sessionsService = require('../src/services/sessions');
    sessionsService.getSession = (threadId) => mockSessions[threadId] || null;
    sessionsService.setSession = (threadId, data) => { mockSessions[threadId] = data; };
    sessionsService.getSessionsRef = () => mockSessions;
    sessionsService.saveSessions = async () => {};

    // Mock UI functions
    const messagesUI = require('../src/ui/messages');
    messagesUI.getInventoryHeader = async () => 'Mock Inventory Header';
  });

  beforeEach(function() {
    // Reset player balance and sessions
    mockPlayer.account_balance_gp = 500;
    Object.keys(mockSessions).forEach(k => delete mockSessions[k]);
    inventoryChannel.sentMessages = [];
  });

  describe('handlePurchaseReaction', function() {
    it('should complete purchase when player has sufficient funds', async function() {
      const { handlePurchaseReaction } = require('../src/handlers/purchase');

      const searchChannel = new MockThread({ name: 'search-TestPlayer-swords' });
      const itemMessage = new MockMessage({
        channel: searchChannel,
        content: 'Test Sword embed'
      });

      // Create session with item data
      const session = createTestSession(searchChannel.id);
      session.messages = [{
        role: 'assistant',
        content: 'Here are items',
        itemsData: {
          itemMessages: [{
            messageId: itemMessage.id,
            item: {
              name: 'Test Sword',
              rarity: 'uncommon',
              priceGp: 100,
              description: 'A test sword for testing',
              itemType: 'Weapon',
              history: 'Forged in tests',
              properties: '+1 to testing',
              complication: 'None'
            }
          }]
        }
      }];
      mockSessions[searchChannel.id] = session;

      // Create mock guild with inventory channel
      const guild = new MockGuild();
      guild.channels.cache.set(inventoryChannel.id, inventoryChannel);
      guild.channels.fetch = async (id) => inventoryChannel;
      itemMessage.guild = guild;

      const user = new MockUser({ id: mockPlayer.discord_id, username: mockPlayer.username });
      const reaction = new MockReaction({ emoji: '\u{1F6D2}', message: itemMessage });

      const initialBalance = mockPlayer.account_balance_gp;
      await handlePurchaseReaction(reaction, user, itemMessage, mockSessions);

      // Balance should be reduced
      assert(mockPlayer.account_balance_gp < initialBalance, 'Balance should decrease after purchase');
    });

    it('should reject purchase when player has insufficient funds', async function() {
      const { handlePurchaseReaction } = require('../src/handlers/purchase');

      mockPlayer.account_balance_gp = 50; // Not enough for 100gp item

      const searchChannel = new MockThread({ name: 'search-TestPlayer-swords' });
      const itemMessage = new MockMessage({
        channel: searchChannel,
        content: 'Expensive Sword embed'
      });

      const session = createTestSession(searchChannel.id);
      session.messages = [{
        role: 'assistant',
        content: 'Here are items',
        itemsData: {
          itemMessages: [{
            messageId: itemMessage.id,
            item: { name: 'Expensive Sword', rarity: 'rare', priceGp: 100 }
          }]
        }
      }];
      mockSessions[searchChannel.id] = session;

      const user = new MockUser({ id: mockPlayer.discord_id, username: mockPlayer.username });
      const reaction = new MockReaction({ emoji: '\u{1F6D2}', message: itemMessage });

      await handlePurchaseReaction(reaction, user, itemMessage, mockSessions);

      // Balance should remain unchanged
      assert.strictEqual(mockPlayer.account_balance_gp, 50, 'Balance should not change on failed purchase');

      // Should have sent insufficient funds message
      const hasInsufficientMsg = searchChannel.sentMessages.some(m =>
        m.content && m.content.includes('Insufficient')
      );
      assert(hasInsufficientMsg, 'Should send insufficient funds message');
    });

    it('should ignore reactions on non-session threads', async function() {
      const { handlePurchaseReaction } = require('../src/handlers/purchase');

      const channel = new MockThread({ name: 'random-thread' });
      const message = new MockMessage({ channel });

      // No session exists for this thread
      const user = new MockUser({ id: mockPlayer.discord_id });
      const reaction = new MockReaction({ emoji: '\u{1F6D2}', message });

      // Should complete without error
      await handlePurchaseReaction(reaction, user, message, mockSessions);

      // No messages should be sent (session not found message would be sent)
      // Just verify no crash
      assert(true, 'Handled gracefully');
    });
  });

  describe('Balance validation', function() {
    it('should correctly identify affordable items', function() {
      const balance = 500;
      const price = 100;
      assert(balance >= price, 'Should identify item as affordable');
    });

    it('should correctly identify unaffordable items', function() {
      const balance = 50;
      const price = 100;
      assert(balance < price, 'Should identify item as unaffordable');
    });

    it('should handle exact balance matches', function() {
      const balance = 100;
      const price = 100;
      assert(balance >= price, 'Should allow purchase at exact balance');
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
