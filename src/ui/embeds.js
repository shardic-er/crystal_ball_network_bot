/**
 * Discord embed and formatting utilities
 */

const { EmbedBuilder } = require('discord.js');

// Rarity colors for embeds (WoW-style)
const RARITY_COLORS = {
  common: 0x9D9D9D,
  uncommon: 0x1EFF00,
  rare: 0x0070DD,
  'very rare': 0xA335EE,
  legendary: 0xFF8000
};

/**
 * Format an item as a Discord embed
 * @param {Object} item - Item data
 * @param {number} price - Price in gp
 * @param {Object} options - Optional settings
 * @param {string} options.priceLabel - Label for price field (default: 'Price')
 * @param {string} options.footer - Footer text (optional)
 * @returns {EmbedBuilder} Discord embed
 */
function formatItemAsEmbed(item, price, options = {}) {
  const { priceLabel = 'Price', footer = null } = options;

  // Handle both camelCase (from AI) and snake_case (from DB) field names
  const itemType = item.itemType || item.item_type || 'Unknown';
  const rarity = item.rarity || 'common';
  const description = item.description || '';
  const history = item.history || '';
  const properties = item.properties || 'None';
  const complication = item.complication || 'None';

  const embed = new EmbedBuilder()
    .setTitle(item.name)
    .setDescription(description)
    .setColor(RARITY_COLORS[rarity?.toLowerCase()] || 0x5865F2)
    .addFields(
      { name: 'Type', value: `${itemType}, ${rarity}`, inline: true },
      { name: priceLabel, value: `${price.toLocaleString()} gp`, inline: true }
    );

  if (history) {
    embed.addFields({ name: 'History', value: history, inline: false });
  }

  embed.addFields(
    { name: 'Properties', value: properties, inline: false },
    { name: 'Complication', value: complication, inline: false }
  );

  if (footer) {
    embed.setFooter({ text: footer });
  }

  return embed;
}

/**
 * Format a buyer as markdown for display
 * @param {Object} buyer - Buyer object with calculated offerGp
 * @param {number} index - Buyer index (0-2)
 * @returns {string} Formatted markdown
 */
function formatBuyerAsMarkdown(buyer, index) {
  let markdown = `### ${buyer.name}, ${buyer.title}\n`;
  markdown += `*Prospective Buyer*\n\n`;
  markdown += `${buyer.description}\n\n`;
  markdown += `**Interest:** "${buyer.motivation}"\n\n`;
  markdown += `**Offer: ${buyer.offerGp.toLocaleString()} gp**\n\n---`;
  return markdown;
}

/**
 * Format synergy scores for display
 * @param {Object} synergy - Synergy scoring result
 * @returns {string} Formatted markdown
 */
function formatSynergyDisplay(synergy) {
  return `**Synergy Analysis**
**Physical Fit:** ${synergy.physicalCompatibility?.score || 3}
**Complication Counter:** ${synergy.complicationCountering?.score || 3}
**Thematic Harmony:** ${synergy.thematicHarmony?.score || 3}
**Power Match:** ${synergy.powerLevelMatching?.score || 3}
**History Synergy:** ${synergy.historicalSynergy?.score || 3}

**Synergy Bonus: +${synergy.totalBonus}**`;
}

module.exports = {
  RARITY_COLORS,
  formatItemAsEmbed,
  formatBuyerAsMarkdown,
  formatSynergyDisplay
};
