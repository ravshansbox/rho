# Telegram integration (MVP)

Rho includes a polling-first Telegram adapter (`extensions/telegram`) that maps Telegram chats to stable rho sessions.

## What it does

- Polls Telegram `getUpdates` with durable offset state
- Normalizes inbound messages and applies authz gates
- Maps chat -> session deterministically (`dm:<chat_id>`, `group:<chat_id>`)
- Runs prompts through rho RPC (`pi --mode rpc`)
- Sends responses back with chunking + retry/backoff
- Exposes operator controls via tool + `/telegram` command
- Follows shared slash RPC contract (`docs/slash-command-contract.md`) for classification, execution, and errors

## Enable

In `~/.rho/init.toml`:

```toml
[modules.tools]
telegram = true

[settings.telegram]
enabled = true
mode = "polling"
bot_token_env = "TELEGRAM_BOT_TOKEN"
poll_timeout_seconds = 30
allowed_chat_ids = []
allowed_user_ids = []
require_mention_in_groups = true
```

Set your token:

```bash
export TELEGRAM_BOT_TOKEN="<your-bot-token>"
```

Apply + run:

```bash
rho sync
rho start
```

## Operator controls

Slash command:

```text
/telegram status
/telegram check
/telegram allow-chat <chat_id>
/telegram revoke-chat <chat_id>
/telegram allow-user <user_id>
/telegram revoke-user <user_id>
```

Tool action interface (`telegram` tool):

- `status`
- `check`
- `send` (`chat_id`, `text`, optional `reply_to_message_id`)
- `allow` / `revoke` (`target=chat|user`, `id`)
- `list_chats`

## Security model

- Default-off transport (`settings.telegram.enabled = false`)
- Optional allowlists (`allowed_chat_ids`, `allowed_user_ids`)
- Group activation gate (`require_mention_in_groups`)
- Runtime operator allow/revoke persistence in `~/.rho/telegram/config.json`

## State files

- `~/.rho/telegram/state.json` (poll offset + health)
- `~/.rho/telegram/session-map.json` (chat/session mapping)
- `~/.rho/telegram/log.jsonl` (audit events)
- `~/.rho/telegram/config.json` (runtime allow/revoke overrides)

## Smoke test

Run local smoke harness (real Telegram API):

```bash
export TELEGRAM_BOT_TOKEN="<token>"
export TELEGRAM_SMOKE_CHAT_ID="<chat-id>"
npm run telegram:smoke
```

Expected output:

- `sent message_id=... chat_id=...`
- `fetched updates=...`

## Known limits (MVP)

- Polling mode only (webhook deferred)
- Text-first outbound rendering
- Operator controls optimized for single-agent runtime
