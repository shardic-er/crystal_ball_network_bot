# Setup Guide

Complete setup instructions for the Crystal Ball Network Discord bot.

## Prerequisites

- Node.js 16 or higher
- A Discord account with server admin permissions
- Anthropic API key (required)
- OpenAI API key (optional, for cheap mode)

## 1. Discord Bot Setup

### Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Name it "Crystal Ball Network" (or your preferred name)
4. Go to "Bot" section in sidebar
5. Click "Add Bot" and confirm

### Configure Bot Permissions

1. In the Bot section, enable these Privileged Gateway Intents:
   - **MESSAGE CONTENT INTENT** (required)
   - **SERVER MEMBERS INTENT** (required)

2. Copy your bot token (you'll need this for .env file)

### Generate Invite URL

1. Go to OAuth2 > URL Generator
2. Select scopes:
   - `bot`
3. Select bot permissions:
   - View Channels
   - Send Messages
   - Manage Messages
   - Manage Channels
   - Create Public Threads
   - Create Private Threads
   - Send Messages in Threads
   - Read Message History
   - Embed Links
   - Attach Files
   - Change Nickname

4. Copy the generated URL and open it in a browser
5. Select your Discord server and authorize

## 2. Get API Keys

### Anthropic (Claude) - Required

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key (starts with `sk-ant-...`)

### OpenAI - Optional

Only needed if you want to use `!cheap` mode (GPT-4o-mini):

1. Go to [platform.openai.com](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to API Keys
4. Create a new API key
5. Copy the key

## 3. Install Bot

### Clone/Download Repository

```bash
cd /path/to/your/projects
# If using git:
git clone <repository-url>
cd crystal_ball_network_bot

# Or just download and extract the zip file
```

### Install Dependencies

```bash
npm install
```

This will install:
- discord.js (Discord bot framework)
- @anthropic-ai/sdk (Claude AI SDK)
- openai (OpenAI SDK)
- better-sqlite3 (Database)
- dotenv (Environment variables)
- uuid (Unique IDs)

## 4. Configure Environment

### Create .env File

```bash
cp .env.example .env
```

### Edit .env

Open `.env` in your text editor and fill in:

```env
# Required
DISCORD_TOKEN=your_discord_bot_token_here
CLAUDE_API_KEY=sk-ant-your-key-here

# Optional
OPENAI_API_KEY=sk-your-openai-key-here

# Model Configuration (sonnet, haiku, or cheap)
MODEL_MODE=sonnet
```

**Model options:**
- `sonnet` - Claude Sonnet 4.5 (highest quality, most expensive)
- `haiku` - Claude Haiku 4.5 (fast and affordable)
- `cheap` - GPT-4o-mini (lowest cost, requires OpenAI key)

## 5. Run the Bot

### Development Mode

Automatically restarts when you edit files:

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

You should see:
```
Loading CBN system prompt...
CBN system prompt loaded successfully
Loading CBN pricing prompt...
CBN pricing prompt loaded successfully
Loading sessions...
No existing sessions file found, starting fresh
Loading cost tracking...
No existing cost tracking file found, starting fresh
Database connected: C:\...\data\cbn.db
Created data directory
Database has 0 tables
Initializing database schema...
Database schema initialized
Logged in as Crystal Ball Network
```

## 6. Bootstrap Discord Server

In your Discord server (as the server owner):

1. Type `!bootstrap` in any channel
2. The bot will create:
   - "Crystal Ball Network" category
   - `welcome` channel
   - `about-cbn` channel
   - `bot-commands` channel
3. The bot's nickname will change to "Crystal Ball Network"

## 7. Test the Bot

1. Go to the `bot-commands` channel
2. Type `!start`
3. A private thread will be created
4. You'll receive a greeting with your random account balance
5. Try: "Show me strength items under 500 gold"

## Troubleshooting

### Bot doesn't come online

- Verify DISCORD_TOKEN in .env is correct
- Check that you copied the token correctly (no extra spaces)
- Make sure the bot is invited to your server

### Bot online but doesn't respond

- Verify MESSAGE CONTENT INTENT is enabled in Discord Developer Portal
- Check console for error messages
- Try `!start` in the bot-commands channel

### API errors

- Verify CLAUDE_API_KEY is correct
- Check that your Anthropic account has available credits
- Look for rate limit errors in console

### !bootstrap fails

- Make sure you're the server owner
- Verify bot has "Manage Channels" permission
- Check bot role is high enough in role hierarchy

### Database errors

- Delete `data/cbn.db` and restart bot to recreate
- Check that bot has write permissions in project directory

### Permission errors

Make sure bot role has these permissions in Discord:
- Manage Channels
- Send Messages
- Create Threads
- Manage Messages

## Next Steps

- Read [COMMANDS.md](COMMANDS.md) for all available commands
- Review [../CLAUDE.md](../CLAUDE.md) if you're developing features
- Check [ROADMAP.md](ROADMAP.md) to see what's coming next

## Updating the Bot

To update to a new version:

```bash
git pull  # If using git
npm install  # Update dependencies
npm run dev  # Restart bot
```

Your database and sessions will be preserved across updates.