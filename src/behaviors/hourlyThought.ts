import type { BehaviorCtx } from './onMessage.ts';
import { generateAndPost } from '../post.ts';

export function startHourlyThought(ctx: BehaviorCtx, intervalMs: number): () => void {
  if (!ctx.enabled.has('hourly_thought')) return () => {};
  const tick = async () => {
    if (!ctx.rl.tryConsume('hourly', false)) return;
    if (ctx.state.recent.length === 0) {
      ctx.log('hourly_thought: no chat context yet, skipping');
      return;
    }
    await generateAndPost(
      ctx,
      `It's your scheduled moment to speak. Look at the recent chat and post one in-character observation, question, or vibe-check. Don't summarize, don't be meta. Just say something a regular here would say.`,
    );
  };
  const handle = setInterval(tick, intervalMs);
  // Fire once after a short warm-up so we don't go silent for an hour on boot.
  const warm = setTimeout(tick, 5 * 60 * 1000);
  return () => {
    clearInterval(handle);
    clearTimeout(warm);
  };
}
