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
- Successful bypasses include a `Mobile copy` button that privately shows the raw URL to the requester.
- Unsupported or failed links tell users to run `/supported`.
- `/supported` shows the full supported-service list in grouped embeds.

BypassTools is for ad-link, key-system, social-unlock, paste, and shortener services. Normal media pages like Tenor gifs are not bypass targets.

## Chatlog Style Examples

The bot loads extra QuackQuack style examples from any of these paths on startup:

- `chatlogs.txt`
- `quack-chatlogs.txt`
- `.txt`, `.log`, or `.md` files inside `chatlogs/`

These examples are used in the system prompt as style guidance, not real model training.

## Commands

- `/bypass` bypasses a supported link.
- `/supported` shows all supported BypassTools link types.
- `/set-ticket-message` updates the ticket greeting. Admin only.
