/**
 * Purchase handler - Cart reaction handling for item purchases
 */

const { Player, InventoryThread, Item } = require('../database/models');
const { formatItemAsEmbed } = require('../ui/embeds');
const { getInventoryHeader } = require('../ui/messages');
const sessionsService = require('../services/sessions');

/**
 * Handle shopping cart reaction (purchase item)
 * @param {Object} reaction - Discord reaction
 * @param {Object} user - Discord user who reacted
 * @param {Object} message - Discord message that was reacted to
 * @param {Object} cbnSessions - Sessions reference
 */
async function handlePurchaseReaction(reaction, user, message, cbnSessions) {
  try {
    // Find the session for this thread
    const threadId = message.channel.id;
    const session = cbnSessions[threadId];

    if (!session) {
      try {
        await message.channel.send('This search session is no longer active. Please start a new search by typing your query in #crystal-ball-network.');
      } catch (e) {
        console.warn('[PURCHASE] Could not send session expired message:', e.message);
      }
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

    // Format item as embed for inventory
    const inventoryEmbed = formatItemAsEmbed(item, price, { priceLabel: 'Purchased for' });

    // Post item in inventory thread FIRST (need message ID for database)
    const inventoryMessage = await inventoryChannel.send({ embeds: [inventoryEmbed] });
    await inventoryMessage.react('\u{2696}');
    console.log(`[PURCHASE] Posted item to inventory thread`);

    // Add item to player inventory with message ID
    Item.addToInventory(dbItem.item_id, player.player_id, price, inventoryMessage.id);
    console.log(`[PURCHASE] Added item to player inventory in database`);

    // Deduct gold
    Player.deductGold(player.player_id, price);
    console.log(`[PURCHASE] Deducted ${price}gp from player ${player.username}`);

    // Get updated player balance
    const updatedPlayer = Player.getById(player.player_id);

    // Update inventory header
    const headerMessage = await inventoryChannel.messages.fetch(invThread.header_message_id);
    const inventory = Item.getPlayerInventory(player.player_id, true, false);
    const totalValue = inventory.reduce((sum, i) => sum + (i.purchase_price_gp || 0), 0);
    const updatedHeader = await getInventoryHeader(
      updatedPlayer.account_balance_gp,
      inventory.length + 1,  // +1 for the item we just added
      totalValue + price
    );
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
    try {
      await message.channel.send(`Error processing purchase: ${error.message}`);
    } catch (e) {
      console.warn('[PURCHASE] Could not send error message:', e.message);
    }
  }
}

module.exports = {
  handlePurchaseReaction
};
