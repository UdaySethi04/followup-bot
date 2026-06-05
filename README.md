# FollowUp Bot

FollowUp Bot is a local Discord accountability bot for freelancers. It tracks open client loops in your DMs so you can answer the real question: "who am I leaving hanging?" It is now a decision coach too: reminder cards push you to reply, wait on the client, ask for info, delay intentionally, or close the loop.

## One-time Discord setup

1. Go to https://discord.com/developers/applications, create a **New Application**, open the **Bot** tab, add a bot, and copy the bot token.
2. Open **OAuth2 -> URL Generator**.
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Send Messages`, `Read Message History`
3. Open the generated URL and add the bot to any server. This is needed for slash command registration.
4. Enable Developer Mode in Discord settings, right-click your username, choose **Copy User ID**, and paste it as `YOUR_USER_ID` in `.env`.

## Running the bot

```bash
npm install
cp .env.example .env
node bot.js
```

Fill in `.env` before running:

```env
BOT_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
YOUR_USER_ID=your_discord_user_id_here
TIMEZONE=Asia/Kolkata
REMINDER_INTERVAL_HOURS=3
```

## Keeping it alive

```bash
npm install -g pm2
pm2 start bot.js --name followup-bot
pm2 save
```

## Command reference

| Command | What it does |
| --- | --- |
| `/followup add` | Adds a new client loop and DMs you a follow-up card. |
| `/followup list` | Shows all non-closed follow-ups grouped by status. |
| `/inbox` | Shows only items currently waiting on you. |
| `/overdue` | DMs cards for every overdue item. |
| `/draft <id> type:<status_update\|apology\|follow_up\|delay>` | Generates a simple copyable client reply draft. |
| `/client show client:<name>` | Shows client notes, preferred platform, and open loops. |
| `/client note client:<name> note:<text>` | Updates lightweight client notes. |
| `/client platform client:<name> platform:<discord\|whatsapp\|email>` | Updates the preferred client platform. |
| `/replied <id>` | Marks an item as waiting on the client. |
| `/close <id>` | Closes an item. |
| `/snooze <id>` | Snoozes an item for 1 hour. |
| `/delay <id> <deadline>` | Intentionally delays an item and sets a new deadline. |

Deadline examples:

```text
today 6pm
tomorrow
tomorrow 3pm
monday 10am
in 2 hours
in 30 mins
eod
eow
```

## Snooze limits

The first snooze moves the follow-up one hour out. On the second snooze attempt, FollowUp Bot shows a warning card: reply, intentionally delay, close it, or take one last snooze from that warning card. Status changes to `waiting_on_client`, `delayed`, or `closed` reset the snooze count.

## Catch-up on startup

When the bot starts, it immediately checks for missed follow-ups. Any item whose `followUpAt` is in the past and whose status is `waiting_on_me` or `delayed` is marked `overdue`, a history entry is added, and you get one catch-up digest DM listing the newly overdue items.

## Digest schedule

FollowUp Bot sends triage digest DMs at 09:00, 15:00, and 19:00 in your configured timezone. The digest groups open loops by needs decision, overdue, waiting on you, and waiting on client.

## Reminder frequency

FollowUp Bot checks every 5 minutes. If a follow-up has a specific due time, it sends a decision reminder when that time arrives. If a loop is still `waiting_on_me`, it re-nudges every `REMINDER_INTERVAL_HOURS` hours, defaults to 3, and escalates from a normal reminder to a decision prompt to a stalled-loop card.

## Timezone

The bot defaults to `Asia/Kolkata`. Change `TIMEZONE` in `.env` if you want deadlines, digests, and display times to use another IANA timezone such as `America/New_York` or `Europe/London`.

## Data

All data lives in `followups.json`. There is no database. The file stores follow-ups, client counters, and lightweight client profiles under a top-level `clients` object. Writes are atomic: the bot writes `followups.tmp.json` first, then renames it to `followups.json` to reduce the risk of corruption if the process crashes.
