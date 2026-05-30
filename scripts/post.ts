// One-shot: post a message via server creds to test the SDK and (indirectly) the WS.
import { loadConfig } from '../src/config.ts';
import { configureApi, api } from '@coin-communities/sdk/react';

const cfg = await loadConfig();
if (!cfg) throw new Error('no chance.config.json');

configureApi({
  baseUrl: cfg.cc.baseUrl,
  headers: {
    'x-api-key': cfg.cc.apiKey,
    'x-server-key': cfg.cc.serverKey,
    'x-server-secret': cfg.cc.serverSecret,
  },
});

const content = process.argv[2] ?? 'gm chat 🤝';
const token = cfg.communities[0]!;
console.log(`posting to ${token}: "${content}"`);

const { data, error, response } = await api.postMessageServer({
  path: { token_address: token },
  body: {
    content,
    chainId: cfg.cc.chainId,
    walletAddress: cfg.cc.walletAddress,
    twitterId: cfg.cc.twitterId,
  },
});

console.log('status:', response.status);
console.log('data:', data);
if (error) console.log('error:', error);

await new Promise((r) => setTimeout(r, 4000));
const { data: msgs, error: rErr } = await api.getMessagesServer({
  path: { token_address: token },
  query: { limit: 5 } as never,
});
console.log('\nrecent messages:');
if (rErr) console.log('read error:', rErr);
else console.log(JSON.stringify(msgs, null, 2));
