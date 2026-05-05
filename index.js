/*
 * QuackQuack Personality Bot
 *
 * A Discord bot that talks exactly like QuackQuack — trained on real chat logs.
 * Responds when mentioned or replied to, in any channel.
 * Remembers recent conversation context per channel.
 *
 * SETUP:
 *   npm install
 *   npm start
 */

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const env = loadEnvFile();

const CONFIG = {
  TOKEN: env.DISCORD_TOKEN,
  GROQ_API_KEY: env.GROQ_API_KEY,
  BYPASSTOOLS_API_KEY: env.BYPASSTOOLS_API_KEY,
  BYPASSTOOLS_BASE_URL: env.BYPASSTOOLS_BASE_URL || 'https://api.bypass.tools/api/v1',
  KEEP_HISTORY: 10,         // messages kept per channel in memory (no Discord fetching)
  HISTORY_TTL: 45 * 60000, // 45 min idle before memory wipes
  AUTO_RESPOND_CHANNELS: parseIdList(env.AUTO_RESPOND_CHANNELS, ['1479215541506932746']), // responds to ALL messages here, no ping needed
  LINK_WATCH_CHANNELS: parseIdList(env.LINK_WATCH_CHANNELS, ['1479215541506932746']), // auto-bypasses links here
  MAX_LINKS_PER_MESSAGE: Number(env.MAX_LINKS_PER_MESSAGE || 3),
  TICKET_CATEGORY_ID: '1428240443237335131',       // TicketKing category — bot greets new tickets here
  TICKET_MSG_FILE: path.join(__dirname, 'ticket-message.txt'), // persists the custom greeting across restarts
  RULES_CHANNEL_ID: '1428274192385839197',           // #rules channel users must read
  LOG_CHANNEL_ID: '1484937622597009591',             // logging channel for rule agreements
  OWNER_ID: '1202577904995794995',                   // QuackQuack's user ID — pinged in logs
};

function loadEnvFile() {
  const loaded = { ...process.env };
  const envPath = path.join(__dirname, '.env');

  if (!fs.existsSync(envPath)) return loaded;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!loaded[key]) loaded[key] = value;
  }

  return loaded;
}

function parseIdList(value, fallback = []) {
  if (!value) return fallback;
  return value.split(',').map(id => id.trim()).filter(Boolean);
}

function requireConfig(name, help) {
  if (!CONFIG[name]) {
    throw new Error(`Missing ${name}. ${help}`);
  }
}

// ─── TICKET GREETING MESSAGE ─────────────────────────────────────────────────
// The greeting sent when a new ticket opens. Updated via /set-ticket-message.
// The rules agreement prompt is always appended automatically — no need to include it.
let ticketMessage = 'yo whats good, before we start';

try {
  if (fs.existsSync(CONFIG.TICKET_MSG_FILE)) {
    ticketMessage = fs.readFileSync(CONFIG.TICKET_MSG_FILE, 'utf8').trim();
    console.log('Loaded custom ticket message from disk');
  }
} catch (e) { console.error('Failed to load ticket message:', e); }

function saveTicketMessage(msg) {
  ticketMessage = msg;
  try { fs.writeFileSync(CONFIG.TICKET_MSG_FILE, msg, 'utf8'); } catch (e) { console.error('Failed to save ticket message:', e); }
}


// ─── IN-MEMORY CONVERSATION HISTORY ──────────────────────────────────────────
// Stores last N messages per channel. No Discord API calls needed — faster and
// uses way fewer tokens than re-fetching the channel every time.
const memory = new Map(); // channelId -> { messages: [{role, content}], lastActive }

setInterval(() => {
  const now = Date.now();
  for (const [id, hist] of memory.entries()) {
    if (now - hist.lastActive > CONFIG.HISTORY_TTL) memory.delete(id);
  }
}, 10 * 60000);

function getHistory(channelId) {
  if (!memory.has(channelId)) {
    memory.set(channelId, { messages: [], lastActive: Date.now() });
  }
  return memory.get(channelId);
}

function pushHistory(channelId, role, content) {
  const hist = getHistory(channelId);
  hist.lastActive = Date.now();
  hist.messages.push({ role, content });
  // Keep only last N*2 entries (N exchanges)
  if (hist.messages.length > CONFIG.KEEP_HISTORY * 2) {
    hist.messages = hist.messages.slice(-CONFIG.KEEP_HISTORY * 2);
  }
}

// ─── QUACKQUACK SYSTEM PROMPT ────────────────────────────────────────────────
// Lean version — personality + rules only, no bulky training examples.
// Token count: ~600 tokens vs the previous ~2970 tokens.
const SYSTEM_PROMPT = `You ARE QuackQuack. A Vietnamese teenager who runs a BSS (Bee Swarm Simulator) service shop on Discord. You farm Roblox accounts using ugphone and sell services for Robux/USD/Star Signs. NEVER say you're an AI. NEVER break character.

━━━ TYPING STYLE ━━━
- Almost always lowercase. "i" is always lowercase.
- NO apostrophes: "dont" "cant" "im" "its" "didnt" "wont"
- Almost never ends with a period
- Casual spelling: "cuz" "u" "ur" "ig" "rn" "fr" "lwk" "ye" "btw" "alr" "prob" "smthing" "ngl" "atp" "nvm" "rq" "wdym"
- "ye" = yes. NEVER use "yeah" (he literally never says it)
- "erm" = hesitation/surprise (not "um" or "hmm")

━━━ MESSAGE LENGTH — CRITICAL ━━━
Each reply is 1 to 4 short messages separated by newlines.
A "message" = a complete short thought, 2-8 words. NOT individual words.

CORRECT — each line is a complete thought:
"i mean its fine ig
just ask ur parent"

CORRECT — single short reaction:
"lol"
"bruh"
"wild"

WRONG — do NOT do this (individual words on separate lines):
"i
mean
its
fine"

WRONG — do NOT do this (one word per line):
"welp
oky
i
mean"

Real burst examples from actual logs:
- "uh | yes | im curious | u cant pay with paypal ?" = 4 short thoughts
- "i will count its as taxed btw | so its not gonna be 800" = 2 thoughts  
- "Wtf | 5 ?" = 2 reactions
- "u can sleep | i have lots of free time today | so dont worry" = 3 thoughts
- "and i will do a service for 800 rb but -30% roblox tax | so its only 560 robux" = 2 thoughts

━━━ MONEY PERSONALITY (very important) ━━━
QQ is extremely money-aware. Always:
- Immediately asks "u cant pay with $ ?" or "u cant pay with paypal ?" if payment hasnt come up
- Always reminds about Roblox 30% tax: "u pay tax" / "its only 560 robux after tax"
- Quick to calculate and correct prices: "erm u only have 2044 :v"
- Knows when hes being underpaid and pushes back: "800 robux wont get u tide popper just to be clear btw"
- Asks "Ok so when u will pay" when order is confirmed
- Will sneakily add extra charges: "i will count its as taxed btw"
- Proud of big orders: "biggest order ive got is 105$ for 5 alt account"
- Aware of market prices: "lv 20 red hive full gifted is worth atleast 90$ alr"
- Always looking to resell/profit: "let me see where i can resell wave key first"
- Money flex: "i used to kill my wallet just for some lil robux now i have too many robux"
- Knows when someone else is overcharging: "hes overcharged u"
- Vietnam prices for comparison: "spring roll is 0.2$ here" "pho is 2$ here"

━━━ CATCHPHRASES — only use in the RIGHT context ━━━
"stop flexing" → ONLY when someone is literally showing off money/items/gear they have
"wild" / "Wild." → ONLY when something genuinely surprises you
"skill issue" → ONLY when someone fails at something they should be able to do
"meat riding" → ONLY when someone is blindly hyping a product/person
"bro is [verb]ing" → ONLY when talking about a third person doing something notable
"aint no ways" → ONLY for genuine disbelief at something absurd
"i mean" → can start many sentences, very natural filler
"real" → agree with something true
"no idea" → genuine uncertainty
"hot" → something is a good deal or impressive
"welp" → something went wrong, a bit resigned
"gotta" → "gotta sleep" "gotta finish config" — casual plans

━━━ PERSONALITY ━━━
- Chill and blunt. Says what he thinks.
- Gets mildly annoyed at dumb questions but still helps
- Strong BSS opinions: atlas > mv4, codex vng = detected, delta = updating bypass
- Lives in Vietnam, runs 4-8 ugphone devices at once
- Sometimes busy: in class, on mobile, sleeping

━━━ BSS KNOWLEDGE ━━━
Services: honey farm, VIP honey farm, gifted bee (80r each / 70r full hive of 50), amulet (gold/diamond/supreme), stinger, magic bean, boost (blue=1sign/30min, white/red=2signs/1hr), drive farm (normal=300r, glitched=800r), waxing, quests (polar/riley=100r per 30), tame windy, Beemas, Bee Bear quest
Payment: Robux (buyer pays tax so divide by 0.7 for gamepass price), USD via PayPal/CashApp, Star Signs (1 sign = 85 magic beans)
Terms: TAD alt = honey buff alt | ugphone = multi-Android emulator | lv 20 = max hive | full gifted = 50 gifted bees | dtc = detected | security = Roblox anti-bot | atlas/mv4/codex/delta/krnl = BSS scripts

━━━ HARD RULES ━━━
- NEVER put single words on their own lines. Each line = a complete short thought.
- Max 4 lines total per reply. Usually 1-2.
- No bullet points, no lists, no headers in replies
- No "Hello!" "Sure!" "Of course!" "Great question!"
- No random catchphrases — only use them when they actually fit the context`;

// ─── GROQ CALL ────────────────────────────────────────────────────────────────
async function askGroq(channelId, username, currentMessage) {
  // Add incoming message to memory before sending
  pushHistory(channelId, 'user', `${username}: ${currentMessage}`);

  const hist = getHistory(channelId);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...hist.messages,
  ];

  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant', // 8b = 6x higher TPM limit than 70b on free tier
          messages,
          temperature: 0.85,
          max_tokens: 120, // QQ never writes long replies anyway
          top_p: 0.9,
        }),
      });

      // Rate limited — read Groq's suggested wait time and retry automatically
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        const errMsg = body?.error?.message || '';
        const waitMatch = errMsg.match(/try again in ([\d.]+)s/);
        const waitMs = waitMatch ? Math.ceil(parseFloat(waitMatch[1]) * 1000) + 500 : 10000;
        console.warn(`Rate limited. Waiting ${waitMs}ms before retry ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        console.error('Groq error:', res.status, await res.text());
        return null;
      }

      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim() || null;
      if (reply) pushHistory(channelId, 'assistant', reply);
      return reply;

    } catch (err) {
      console.error('Groq fetch error:', err);
      return null;
    }
  }

  console.error('Groq: all retries exhausted');
  return null;
}

// ─── BYPASSTOOLS API ─────────────────────────────────────────────────────────
function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s<>()]+/gi) || [];
  const cleaned = matches.map(url => url.replace(/[.,!?;:)\]}>"']+$/g, ''));
  return [...new Set(cleaned)];
}

async function bypassUrl(url, refresh = false) {
  requireConfig('BYPASSTOOLS_API_KEY', 'Set BYPASSTOOLS_API_KEY in .env or your host environment.');

  const res = await fetch(`${CONFIG.BYPASSTOOLS_BASE_URL}/bypass/direct`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CONFIG.BYPASSTOOLS_API_KEY,
    },
    body: JSON.stringify({ url, refresh }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.status !== 'success') {
    const message = data.message || `BypassTools returned HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return {
    inputUrl: url,
    resultUrl: data.result,
    cached: Boolean(data.cached),
    processTime: data.processTime,
    providerId: data.providerId,
  };
}

function formatBypassResult(result) {
  const details = [];
  if (result.cached) details.push('cached');
  if (typeof result.processTime === 'number') details.push(`${result.processTime}ms`);

  const suffix = details.length ? ` (${details.join(', ')})` : '';
  return `bypassed${suffix}: ${result.resultUrl}`;
}

async function bypassLinksForMessage(msg, urls) {
  const selected = urls.slice(0, CONFIG.MAX_LINKS_PER_MESSAGE);
  const lines = [];

  for (const url of selected) {
    try {
      const result = await bypassUrl(url);
      lines.push(formatBypassResult(result));
    } catch (err) {
      console.error(`Bypass failed for ${url}:`, err);
      lines.push(`couldnt bypass ${url}: ${err.message || 'unknown error'}`);
    }
  }

  if (urls.length > selected.length) {
    lines.push(`skipped ${urls.length - selected.length} extra link(s)`);
  }

  await msg.reply({
    content: lines.join('\n'),
    allowedMentions: { parse: [] },
  });
}

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  const mentioned = msg.mentions.has(client.user.id);
  const isAutoChannel = CONFIG.AUTO_RESPOND_CHANNELS.includes(msg.channel.id);
  const isLinkWatchChannel = CONFIG.LINK_WATCH_CHANNELS.includes(msg.channel.id);
  const isReply = msg.reference && msg.type === 19;
  const urls = extractUrls(msg.content);

  if (isLinkWatchChannel && urls.length > 0) {
    await msg.channel.sendTyping();
    await bypassLinksForMessage(msg, urls);
    return;
  }

  // Check if it's a reply to the bot
  let replyToBot = false;
  if (isReply) {
    try {
      const original = await msg.channel.messages.fetch(msg.reference.messageId);
      replyToBot = original.author.id === client.user.id;
    } catch { /* ignore */ }
  }

  // ─── RULES AGREEMENT CHECK ───
  // Works in any ticket channel (inside the ticket category), no tracking needed.
  // Anyone who types exactly "i agree to the rules" triggers confirmation + log.
  const isTicketChannel = msg.channel.parentId === CONFIG.TICKET_CATEGORY_ID;
  if (isTicketChannel && msg.content.trim().toLowerCase() === 'i agree to the rules') {
    // Confirm in the ticket
    await msg.channel.send({
      content: `<@${msg.author.id}> has agreed to the rules`,
      allowedMentions: { users: [msg.author.id] },
    });

    // Log to logging channel
    try {
      const logChannel = await client.channels.fetch(CONFIG.LOG_CHANNEL_ID);
      await logChannel.send({
        content: `<@${CONFIG.OWNER_ID}> — <@${msg.author.id}> (\`${msg.author.id}\`) agreed to the rules in <#${msg.channel.id}>`,
        allowedMentions: { users: [CONFIG.OWNER_ID] },
      });
    } catch (err) {
      console.error('Failed to send to log channel:', err);
    }
    return;
  }

  if (!mentioned && !replyToBot && !isAutoChannel) return;

  // Strip the mention from the message text
  const cleaned = msg.content.replace(/<@!?\d+>/g, '').trim();
  if (!cleaned) return;

  await msg.channel.sendTyping();

  const username = msg.member?.displayName || msg.author.username;
  const reply = await askGroq(msg.channel.id, username, cleaned);
  if (!reply) return;

  await msg.reply({
    content: reply,
    allowedMentions: { parse: [] },
  });
});

// ─── NEW CHANNEL → TICKET GREETING + RULES GATE ─────────────────────────────
client.on('channelCreate', async (channel) => {
  try {
    if (!channel.parentId || channel.parentId !== CONFIG.TICKET_CATEGORY_ID) return;

    // Wait for TicketKing to finish setting permissions
    await new Promise(r => setTimeout(r, 2500));

    // Build the full greeting: custom message + rules prompt
    const greeting = [
      ticketMessage,
      '',
      `please read the rules in <#${CONFIG.RULES_CHANNEL_ID}> before we continue`,
      `once you have read **all** the rules, reply with exactly: \`I agree to the rules\``,
    ].join('\n');

    await channel.send({
      content: greeting,
      allowedMentions: { parse: [] },
    });
    console.log(`Sent ticket greeting in #${channel.name}`);
  } catch (err) {
    console.error('Failed to send ticket greeting:', err);
  }
});

// ─── SLASH COMMAND HANDLER ────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'bypass') {
    const link = interaction.options.getString('link', true);
    const refresh = interaction.options.getBoolean('refresh') ?? false;
    const urls = extractUrls(link);

    if (urls.length === 0) {
      return interaction.reply({ content: 'send a valid http or https link', ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const result = await bypassUrl(urls[0], refresh);
      return interaction.editReply(formatBypassResult(result));
    } catch (err) {
      console.error(`Slash bypass failed for ${urls[0]}:`, err);
      return interaction.editReply(`couldnt bypass that link: ${err.message || 'unknown error'}`);
    }
  }

  if (interaction.commandName !== 'set-ticket-message') return;

  // Only admins can change the greeting
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'no permission', ephemeral: true });
  }

  const newMsg = interaction.options.getString('message', true);
  saveTicketMessage(newMsg);

  await interaction.reply({
    content: `✅ ticket greeting updated:\n\n${newMsg}`,
    ephemeral: true,
  });
});

// ─── READY ────────────────────────────────────────────────────────────────────
client.on('ready', async () => {
  console.log(`✅ QuackQuack bot online as ${client.user.tag}`);

  // Register slash commands globally
  try {
    const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
    const commands = [
      new SlashCommandBuilder()
        .setName('bypass')
        .setDescription('Bypass a supported link')
        .addStringOption(opt =>
          opt.setName('link')
            .setDescription('The link to bypass')
            .setRequired(true)
        )
        .addBooleanOption(opt =>
          opt.setName('refresh')
            .setDescription('Skip the BypassTools cache')
            .setRequired(false)
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('set-ticket-message')
        .setDescription('Set the message QuackQuack sends when a new ticket opens')
        .addStringOption(opt =>
          opt.setName('message')
            .setDescription('The message to send (supports \\n for newlines)')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .toJSON(),
    ];
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands registered: /bypass, /set-ticket-message');
  } catch (err) {
    console.error('Failed to register slash command:', err);
  }
});

requireConfig('TOKEN', 'Set DISCORD_TOKEN in .env or your host environment.');
requireConfig('GROQ_API_KEY', 'Set GROQ_API_KEY in .env or your host environment.');
client.login(CONFIG.TOKEN);
