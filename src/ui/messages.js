/**
 * Message utilities for text splitting and templates
 */

const fs = require('fs').promises;
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Template path
const INVENTORY_HEADER_PATH = path.join(__dirname, '..', 'templates', 'inventory_header.md');

/**
 * Load and populate inventory header template
 * @param {number} balance - Player's gold balance
 * @param {number} itemCount - Number of items in inventory
 * @param {number} totalValue - Total value of inventory items
 * @returns {Promise<string>} Populated header markdown
 */
async function getInventoryHeader(balance, itemCount, totalValue) {
  const template = await fs.readFile(INVENTORY_HEADER_PATH, 'utf-8');
  return template
    .replace('{balance}', balance)
    .replace('{count}', itemCount)
    .replace('{value}', totalValue);
}

/**
 * Split text into chunks that fit within Discord's message limit.
 * @param {string} text - The text to split
 * @param {Object} options - Split options
 * @param {number} options.maxLength - Maximum length per chunk (default 2000)
 * @param {string} options.mode - 'prose' splits on paragraphs/sentences, 'lines' splits on newlines/words
 * @returns {string[]} Array of text chunks
 */
function splitText(text, { maxLength = 2000, mode = 'prose' } = {}) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  const primaryDelimiter = mode === 'prose' ? '\n\n' : '\n';
  const primaryParts = text.split(primaryDelimiter);
  let currentChunk = '';

  for (const part of primaryParts) {
    if ((currentChunk + primaryDelimiter + part).length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      if (part.length > maxLength) {
        // Split oversized parts: prose uses sentences, lines uses words
        const subParts = mode === 'prose'
          ? (part.match(/[^.!?]+[.!?]+/g) || [part])
          : part.split(' ');
        const subDelimiter = ' ';

        for (const subPart of subParts) {
          if ((currentChunk + subDelimiter + subPart).length > maxLength) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = subPart;
          } else {
            currentChunk += (currentChunk ? subDelimiter : '') + subPart;
          }
        }
      } else {
        currentChunk = part;
      }
    } else {
      currentChunk += (currentChunk ? primaryDelimiter : '') + part;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text.substring(0, maxLength)];
}

/**
 * Post a button to close/archive a thread
 * @param {Object} thread - Discord thread channel
 */
async function postCloseThreadButton(thread) {
  try {
    const closeButton = new ButtonBuilder()
      .setCustomId('thread_close')
      .setLabel('Close Thread')
      .setStyle(ButtonStyle.Secondary);

    const buttonRow = new ActionRowBuilder().addComponents(closeButton);
    await thread.send({
      content: '*This session has ended. Click below to close this thread.*',
      components: [buttonRow]
    });
  } catch (e) {
    console.warn('[THREAD] Could not post close button:', e.message);
  }
}

module.exports = {
  getInventoryHeader,
  splitText,
  postCloseThreadButton
};
