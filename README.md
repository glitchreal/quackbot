# Quackbot

Discord bot with QuackQuack chat behavior, ticket greetings, rules agreement logging, and BypassTools link bypassing.

## Setup

```sh
npm install
cp .env.example .env
```

Fill in `.env` with your real keys:

```env
DISCORD_TOKEN=your_discord_bot_token
GROQ_API_KEY=your_groq_api_key
BYPASSTOOLS_API_KEY=bt_your_api_key_here
```

Start the bot:

```sh
npm start
```

## Bypass Features

- The bot auto-checks links in channel `1479215541506932746`.
- Users can run `/bypass link:<url>` to bypass a supported link.
- Use `/bypass link:<url> refresh:true` to skip the BypassTools cache.

## Commands

- `/bypass` bypasses a supported link.
- `/set-ticket-message` updates the ticket greeting. Admin only.
