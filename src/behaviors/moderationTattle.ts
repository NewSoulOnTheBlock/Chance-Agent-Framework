import type { BehaviorCtx } from './onMessage.ts';

export function onModeration(
  ctx: BehaviorCtx,
  event: { messageId: string; isSpam: boolean; isHarmful: boolean },
): void {
  if (!ctx.enabled.has('moderation_tattle')) return;
  if (!event.isSpam && !event.isHarmful) return;
  const flags = [event.isSpam && 'spam', event.isHarmful && 'harmful'].filter(Boolean).join('+');
  ctx.log(`⚠ moderation: message ${event.messageId} flagged ${flags}`);
}
