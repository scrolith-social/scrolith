import { Server } from 'socket.io';
import { attachSocketAuthSessionGuard, isAuthSessionRecordActive, resolveAuthSessionToken } from '../services/authSession.service';

export function initSocket(httpServer: any) {
  const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth && (socket.handshake.auth as any).token) || socket.handshake.query?.token;
      if (!token) return next(new Error('Unauthorized'));
      const raw = String(token).startsWith('Bearer ') ? String(token).slice(7) : String(token);
      const auth = await resolveAuthSessionToken(raw);
      if (!auth || !auth.user.isActive) return next(new Error('Unauthorized'));
      const active = await isAuthSessionRecordActive({
        sessionId: auth.sessionId,
        userId: auth.userId,
        sessionVersion: auth.sessionVersion,
        role: auth.user.role
      });
      if (!active) return next(new Error('Unauthorized'));
      (socket as any).data = {
        ...(socket as any).data,
        user: auth.user,
        authSession: { sessionId: auth.sessionId, userId: auth.userId, sessionVersion: auth.sessionVersion }
      };
      (socket as any).user = auth.user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    attachSocketAuthSessionGuard(socket);
    const user = (socket as any).user;
    if (user && (user as any).id) {
      socket.join(`user:${(user as any).id}`);
      socket.join(`role:${(user as any).role}`);
    }
  });

  return io;
}

export function emitToUser(io: Server, userId: string, event: string, payload: any) {
  io.to(`user:${userId}`).emit(event, payload);
}

export function emitToRole(io: Server, role: string, event: string, payload: any) {
  io.to(`role:${role}`).emit(event, payload);
}

export default initSocket;
