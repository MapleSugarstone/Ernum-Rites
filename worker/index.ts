import { Lobby } from './lobby';
import { MatchRoom } from './room';
import type { QueueReply } from './protocol';

export { Lobby, MatchRoom };

export interface Env {
  MATCH_ROOM: DurableObjectNamespace<MatchRoom>;
  LOBBY: DurableObjectNamespace<Lobby>;
  /** Comma separated list of origins allowed to open a socket. */
  ALLOWED_ORIGINS?: string;
}

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || (allowed.length > 0 && !allowed.includes(origin))) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
}

/** One front desk for the whole deployment, so waiting players can find each other. */
function lobby(env: Env): DurableObjectStub<Lobby> {
  return env.LOBBY.get(env.LOBBY.idFromName('front-desk'));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(env, origin);
    const reply = (body: QueueReply, status = 200) =>
      Response.json(body, { status, headers: cors });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true }, { headers: cors });
    }

    // --- matchmaking --------------------------------------------------------
    if (url.pathname === '/api/queue/public' && request.method === 'POST') {
      const { roomId } = await lobby(env).findPublic();
      return reply({ ok: true, roomId, kind: 'public' });
    }

    if (url.pathname === '/api/queue/host' && request.method === 'POST') {
      const { roomId, code } = await lobby(env).hostPrivate();
      return reply({ ok: true, roomId, kind: 'private', code });
    }

    if (url.pathname === '/api/queue/join' && request.method === 'POST') {
      const code = new URL(request.url).searchParams.get('code') ?? '';
      if (!/^[A-Za-z0-9]{4,12}$/.test(code)) {
        return reply({ ok: false, reason: 'that is not a code' }, 400);
      }
      const found = await lobby(env).joinPrivate(code);
      if (!found) return reply({ ok: false, reason: 'Lobby not found' }, 404);
      return reply({ ok: true, roomId: found.roomId, kind: 'private', code: code.toUpperCase() });
    }

    if (url.pathname === '/api/queue/cancel' && request.method === 'POST') {
      const params = new URL(request.url).searchParams;
      const code = params.get('code');
      const roomId = params.get('roomId');
      if (code) await lobby(env).cancel(code);
      if (roomId) await lobby(env).leavePublic(roomId);
      return reply({ ok: true, roomId: roomId ?? '', kind: 'public' });
    }

    // /api/room/<roomId> upgrades to the websocket for that match.
    const match = url.pathname.match(/^\/api\/room\/([A-Za-z0-9_-]{1,64})$/);
    if (match) {
      const id = env.MATCH_ROOM.idFromName(match[1]);
      return env.MATCH_ROOM.get(id).fetch(request);
    }

    return new Response('not found', { status: 404, headers: cors });
  },
} satisfies ExportedHandler<Env>;
