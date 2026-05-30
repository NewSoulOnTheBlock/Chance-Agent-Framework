import type { Config } from './config.ts';
import {
  api,
  CommunityRealtimeClient,
  configureFromConfig,
  makeTicketFetcher,
  type CommunityMessageEvent,
  type ModerationUpdatePayload,
} from './sdk.ts';
import { makeLLM } from './llm/index.ts';
import { CommunityState, type SeenMessage } from './state.ts';
import { RateLimiter } from './rateLimit.ts';
import { buildSystemPrompt } from './personas.ts';
import { onMessage, type BehaviorCtx } from './behaviors/onMessage.ts';
import { maybeLike } from './behaviors/reactLikes.ts';
import { onModeration } from './behaviors/moderationTattle.ts';
import { startHourlyThought } from './behaviors/hourlyThought.ts';

export async function run(cfg: Config): Promise<void> {
  configureFromConfig(cfg);

  // Resolve Chance's own userId from twitterId so we can ignore our own posts.
  const { data: idRes, error: idErr } = await api.getUserIdByTwitterId({
    path: { twitter_id: cfg.cc.twitterId },
  });
  if (idErr || !idRes?.userId) {
    throw new Error(`Could not resolve userId from twitterId ${cfg.cc.twitterId}: ${idErr?.message ?? 'no userId'}`);
  }
  const ownUserId = idRes.userId;
  console.log(`[chance] resolved own userId: ${ownUserId}`);

  const llm = await makeLLM(cfg.llm);
  const systemPrompt = buildSystemPrompt(cfg.persona.archetype, cfg.persona.name, cfg.persona.systemPrompt);
  const enabled = new Set<string>(cfg.behaviors);

  const disposers: Array<() => void> = [];

  for (const tokenAddress of cfg.communities) {
    const log = (m: string) => console.log(`[${tokenAddress.slice(0, 8)}…] ${m}`);
    const state = new CommunityState();
    const rl = new RateLimiter(cfg.rateLimits.maxRepliesPerHour);
    rl.setCooldown('reply', cfg.rateLimits.replyCooldownMs);
    rl.setCooldown('welcome', cfg.rateLimits.replyCooldownMs);
    rl.setCooldown('like', cfg.rateLimits.likeCooldownMs);
    rl.setCooldown('hourly', cfg.rateLimits.hourlyThoughtIntervalMs);

    const ctx: BehaviorCtx = {
      cfg,
      tokenAddress,
      state,
      llm,
      systemPrompt,
      log,
      ownUserId,
      personaName: cfg.persona.name,
      rl,
      enabled,
    };

    // Seed recent messages so the LLM has immediate context.
    try {
      const { data: msgs } = await api.getMessagesServer({
        path: { token_address: tokenAddress },
        query: { limit: 20 } as never,
      });
      const items = (msgs as { items?: Array<Record<string, unknown>> } | undefined)?.items ?? [];
      for (const raw of items.reverse()) {
        const m = raw as { id?: string; userId?: string; username?: string; content?: string; createdAt?: string; parentMessageId?: string | null };
        if (!m.id || !m.userId || !m.content) continue;
        state.pushRecent({
          id: m.id,
          userId: m.userId,
          username: m.username ?? 'unknown',
          content: m.content,
          createdAt: m.createdAt ?? new Date().toISOString(),
          parentMessageId: m.parentMessageId ?? null,
        });
      }
      log(`seeded ${state.recent.length} recent messages`);
    } catch (e) {
      log(`seed failed (non-fatal): ${(e as Error).message}`);
    }

    const client = CommunityRealtimeClient.getOrCreate({
      baseUrl: cfg.cc.baseUrl,
      tokenAddress,
      auth: { getTicket: makeTicketFetcher(tokenAddress) },
    });

    const dispose = client.subscribe({
      onConnect: () => log('realtime connected'),
      onDisconnect: () => log('realtime disconnected'),
      onGap: () => log('realtime gap — would refetch in production'),
      onMessage: async (event: CommunityMessageEvent) => {
        // If this echoes one of our pending optimistic posts, reconcile + record id.
        if (state.reconcile(event.content)) {
          state.ownMessageIds.add(event.id);
          if (event.isSpam || event.isHarmful) {
            log(`⚠ own post removed by moderation: "${event.content}"`);
          }
          return;
        }
        const m: SeenMessage = {
          id: event.id,
          userId: event.userId,
          username: event.username,
          content: event.content,
          createdAt: event.createdAt,
          parentMessageId: event.parentMessageId,
        };
        state.pushRecent(m);
        // Fire reply behaviors (mention / question / welcome) and reactions in parallel.
        void onMessage(ctx, m);
        void maybeLike(ctx, m);
      },
      onModeration: (event: ModerationUpdatePayload) => {
        if (state.ownMessageIds.has(event.messageId) && (event.isSpam || event.isHarmful)) {
          log(`⚠ own post ${event.messageId} flagged after the fact`);
        }
        onModeration(ctx, event);
      },
      onLike: () => {
        // No-op for now; could be used for engagement scoring.
      },
    });
    disposers.push(dispose);

    const stopHourly = startHourlyThought(ctx, cfg.rateLimits.hourlyThoughtIntervalMs);
    disposers.push(stopHourly);

    log(`attached`);
  }

  console.log(`[chance] running as "${cfg.persona.name}" (${cfg.persona.archetype}) across ${cfg.communities.length} community(ies). Ctrl-C to stop.`);

  const shutdown = () => {
    console.log('\n[chance] shutting down…');
    for (const d of disposers) {
      try { d(); } catch { /* ignore */ }
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
