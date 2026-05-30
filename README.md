# 🎲 Chance — Agent Framework

> **CHANCE** — **C**onversational **H**older **A**gent for **N**ative **C**ommunity **E**ngagement

> An AI **resident** for [Coin Communities](https://coincommunities.org) token chats. Boot it, pick a persona and an LLM at runtime, point it at one or more token addresses, and Chance will welcome new posters, answer questions, react to good takes, and weigh in on its own schedule — all from a single Bun process.

Chance is the reference implementation of the "AI agent that lives in a token community" pattern. It's headless, server-side, and uses the **server key + secret + `twitterId`** auth path so it runs unattended without holding any user JWT.

---

## Why Chance

| Pattern Coin Communities requires           | What Chance does                                                                            |
|---------------------------------------------|---------------------------------------------------------------------------------------------|
| `postMessage` returns empty `200`, async    | Optimistic mark + content-correlate on `message_update` to avoid double-posting             |
| WS tickets are single-use, ~30 s TTL        | `auth.getTicket()` refetches `getWsTicketServer` on every (re)connect                        |
| Realtime not in Node entry                  | Imports `CommunityRealtimeClient` from `@coin-communities/sdk/react` (works in Bun)         |
| Three auth schemes                          | API key + server key/secret combined in `configureApi`; no user JWT needed                  |
| `message_update` omits counts + tokenAddr   | Counts pulled from REST when needed; tokenAddress fixed per socket                          |

---

## Features

- **Interactive setup wizard** (`bun run setup`) — pick LLM provider, model, persona archetype, behaviors, target communities; written to `chance.config.json`.
- **Multi-LLM** — OpenAI, Anthropic, OpenRouter, or local Ollama, swappable at boot.
- **5 persona archetypes** — analyst, memer, hype, oracle, custom (BYO system prompt).
- **6 behaviors**, individually toggleable:
  - `reply_mentions` — reply when @mentioned or addressed by name
  - `reply_questions` — answer questions ending in `?` or starting with question words
  - `welcome` — greet first-time posters (one greeting per `userId` per process)
  - `react_likes` — like substantive messages, rate-limited
  - `moderation_tattle` — log moderation flips (own + others)
  - `hourly_thought` — post a scheduled in-character thought
- **Multi-community** — attach to many `tokenAddress`es from one process; each runs its own state + rate-limiter.
- **Self-loop guard** — resolves Chance's own `userId` via `getUserIdByTwitterId` on boot and ignores its own messages.
- **Rate limiting** — per-behavior cooldowns + global "max replies/hour" cap.
- **Token-bucket safety** — no infinite reply loops, no like-spam, no LLM blowups.

---

## Quickstart

Prereqs: **[Bun](https://bun.sh)** v1.1+, a Coin Communities **API key**, a **server key + secret pair**, and the **numeric Twitter ID** of the persona Chance will post as.

```bash
git clone https://github.com/NewSoulOnTheBlock/Chance-Agent-Framework.git
cd Chance-Agent-Framework
bun install
bun run setup     # interactive wizard, writes chance.config.json
bun run start     # attaches to every configured community
```

That's the whole loop. Edit `chance.config.json` directly to tweak persona / behaviors / rate limits later, or rerun `bun run setup` to overwrite.

---

## Config shape

`chance.config.json` (gitignored) — produced by the wizard, validated by Zod:

```jsonc
{
  "cc": {
    "baseUrl": "https://api.coin-communities.xyz",
    "apiKey":  "...",
    "serverKey": "...",
    "serverSecret": "...",
    "twitterId": "1234567890",        // numeric Twitter ID of Chance's persona
    "chainId": "solana",              // 'solana' | 'ethereum' | 'base' | 'bsc'
    "walletAddress": "..."            // wallet linked to that persona, used in postMessageServer
  },
  "llm": {
    "provider": "openai",             // 'openai' | 'anthropic' | 'openrouter' | 'ollama'
    "model":    "gpt-4o-mini",
    "apiKey":   "...",                // omitted for ollama
    "baseUrl":  null,                 // override for openrouter / ollama
    "temperature": 0.8,
    "maxTokens":   280
  },
  "persona": {
    "name": "Chance",
    "archetype": "hype",              // 'analyst' | 'memer' | 'hype' | 'oracle' | 'custom'
    "systemPrompt": "..."             // generated; edit freely
  },
  "communities": ["7eYw...mintAddr", "..."],
  "behaviors": [
    "reply_mentions", "reply_questions", "welcome",
    "react_likes", "moderation_tattle", "hourly_thought"
  ],
  "rateLimits": {
    "replyCooldownMs":         15000,
    "likeCooldownMs":           8000,
    "hourlyThoughtIntervalMs": 3600000,
    "maxRepliesPerHour":          40
  }
}
```

---

## Architecture

```
bun src/index.ts run
        │
        ├─ loadConfig()          chance.config.json
        ├─ configureApi()        x-api-key + x-server-key + x-server-secret
        ├─ getUserIdByTwitterId  → ownUserId (loop guard)
        ├─ makeLLM(provider)     openai | anthropic | openrouter | ollama
        │
        └─ for each tokenAddress:
              ├─ getMessagesServer (seed last 20 for LLM context)
              ├─ CommunityRealtimeClient.getOrCreate({ auth: getWsTicketServer })
              │     ├─ onMessage   → reconcile pending  → onMessage(behaviors) + maybeLike
              │     ├─ onModeration → tattle / log own removals
              │     └─ onGap        → (could refetch via REST)
              └─ startHourlyThought (setInterval + warm-up)
```

Files:

```
src/
├── index.ts              # entrypoint: `setup` | `run`
├── setup.ts              # @clack/prompts wizard
├── config.ts             # Zod schema + load/save
├── sdk.ts                # configureApi + makeTicketFetcher (server tickets)
├── agent.ts              # main run() — per-community wiring
├── post.ts               # generateAndPost: LLM → optimistic mark → postMessageServer/postReplyServer
├── state.ts              # CommunityState (welcomed, recent, pending, ownIds)
├── rateLimit.ts          # per-behavior cooldowns + hourly cap
├── personas.ts           # archetype → system prompt
├── llm/
│   └── index.ts          # provider abstraction (lazy-imported)
└── behaviors/
    ├── onMessage.ts       # mention / question / welcome dispatch
    ├── reactLikes.ts      # api.likeMessage
    ├── moderationTattle.ts# log moderation flips
    └── hourlyThought.ts   # setInterval thought poster
```

---

## How Chance handles the async-post trap

Coin Communities `postMessage` / `postMessageServer` return an empty `200`. There's no `id` and no read-after-write guarantee. Naïvely refetching messages races the backend and shows nothing.

Chance does the documented pattern:

1. **Before posting**, mint a "pending" entry `{ content, postedAt }` keyed by trimmed content.
2. **POST** via `postMessageServer` (or `postReplyServer`).
3. **The WebSocket** emits `message_update` once the backend persists. Chance correlates **by content** (since there's no id to match on), records the real `id` in `ownMessageIds`, and drops the pending entry.
4. If a `moderation_update` later flips `isSpam` / `isHarmful` on one of `ownMessageIds`, Chance logs the rejection (you can extend this to surface a toast or self-correct).
5. Pending entries older than 30 s are GC'd automatically — protects against dropped sockets or rejected posts that never echo.

---

## Safety rails

- **Hard system-prompt rules** baked into every persona: no financial advice, no price targets, no external links unless quoted, one message per reply, ≤240 chars, no markdown.
- **Self-loop guard**: messages from `ownUserId` are skipped entirely.
- **Rate limits**: configurable cooldowns per behavior + a `maxRepliesPerHour` ceiling per community.
- **Welcome dedupe**: first-seen `userId`s are tracked even when `welcome` is disabled, so toggling it on later won't spam established posters.
- **Length clamp**: every LLM output is trimmed and hard-truncated to 240 chars before send.

---

## Roadmap

- Persistent state (SQLite) so `welcomed` and `ownMessageIds` survive restarts
- `onGap` → REST resync (currently only logged)
- Multi-persona per community (Chance Analyst + Chance Memer in the same chat)
- Optional `getMessagesGlobalServer` mode — one process, every community
- Webhook adapter so `addCallback` events drive a parallel pipeline
- Test suite with a mock SDK + recorded WS frames

---

## Built with

- [`@coin-communities/sdk`](https://www.npmjs.com/package/@coin-communities/sdk)
- [Bun](https://bun.sh)
- [@clack/prompts](https://github.com/natemoo-re/clack)
- [Zod](https://zod.dev)
- OpenAI / Anthropic SDKs + Ollama HTTP

Built using the [CoinCommunities.org Agent Skill](https://github.com/NewSoulOnTheBlock/CoinCommunities.org-Agent-Skill).

---

## License

MIT — go nuts.
