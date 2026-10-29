import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { RateLimiterService } from '../src/common/rate-limit/rate-limiter.service';

/**
 * End-to-end checks of the security and dispatch rules, against the real
 * application (same wiring as main.ts) on an in-memory SQLite database seeded
 * with the demo hospitals and ambulances. See test/setup-env.ts.
 *
 * The tests in each block run in order and share state, like a short session.
 */
describe('ECS API (e2e)', () => {
  const ORIGIN = 'http://localhost:3001';
  let app: NestExpressApplication;
  let baseUrl: string;
  const sockets: Socket[] = [];

  const http = () => request(app.getHttpServer());
  const login = async (email: string, password: string): Promise<string> => {
    const res = await http().post('/api/auth/login').send({ email, password }).expect(200);
    return res.body.accessToken;
  };
  const register = (email: string, extra: Record<string, unknown> = {}) =>
    http().post('/api/auth/register').send({ email, password: 'secret12', firstName: 'Test', lastName: 'User', ...extra });

  /** Resolves once the socket connects, or with the connection error message. */
  const connect = (token: string | null, origin = ORIGIN) =>
    new Promise<{ socket: Socket; error?: string }>(resolve => {
      const socket = io(baseUrl, {
        transports: ['websocket'],
        auth: token ? { token } : undefined,
        extraHeaders: { Origin: origin },
        reconnection: false,
        forceNew: true,
      });
      sockets.push(socket);
      socket.on('connect', () => resolve({ socket }));
      socket.on('connect_error', err => resolve({ socket, error: err.message }));
    });
  const reply = (socket: Socket, event: string, data: unknown, replies: string[]) =>
    new Promise<string>(resolve => {
      const timer = setTimeout(() => resolve('timeout'), 3000);
      replies.forEach(name => socket.once(name, () => { clearTimeout(timer); resolve(name); }));
      socket.emit(event, data);
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    sockets.forEach(socket => socket.close());
    await app?.close();
  });

  let admin: string;
  let patient: string;
  let stranger: string;

  describe('sign-up and accounts', () => {
    it('reports healthy', async () => {
      await http().get('/api/health').expect(200);
    });

    it('refuses any role but patient at public sign-up', async () => {
      await register('evil@e2e.test', { role: 'ADMIN' }).expect(400);
      await register('hosp@e2e.test', { role: 'HOSPITAL', hospitalName: 'AIIMS' }).expect(400);
    });

    it('creates patients as USER', async () => {
      const res = await register('patient@e2e.test').expect(201);
      expect(res.body.user.role).toBe('USER');
      await register('stranger@e2e.test').expect(201);
      patient = await login('patient@e2e.test', 'secret12');
      stranger = await login('stranger@e2e.test', 'secret12');
    });

    it('lets the bootstrap admin sign in, and keeps patients out of admin routes', async () => {
      admin = await login('admin@e2e.test', 'e2e-admin-password');
      await http().get('/api/admin/system/status').set('Authorization', `Bearer ${patient}`).expect(403);
      await http().get('/api/admin/system/status').set('Authorization', `Bearer ${admin}`).expect(200);
    });

    it('protects the last admin from being demoted or switched off', async () => {
      const me = await http().get('/api/users/me').set('Authorization', `Bearer ${admin}`).expect(200);
      await http().patch(`/api/admin/users/${me.body.id}`).set('Authorization', `Bearer ${admin}`).send({ role: 'USER' }).expect(409);
      await http().patch(`/api/users/${me.body.id}/status`).set('Authorization', `Bearer ${admin}`).send({ isActive: false }).expect(409);
    });
  });

  describe('bookings and trips', () => {
    let bookingId: string;
    let dispatch: { id: string; ambulanceId: string };
    const drivers: Record<string, string> = {};

    it('dispatches a new booking to an ambulance', async () => {
      const res = await http()
        .post('/api/bookings')
        .set('Authorization', `Bearer ${patient}`)
        .send({ pickupLatitude: 28.5729, pickupLongitude: 77.209, pickupAddress: 'Near AIIMS', severity: 'HIGH' })
        .expect(201);
      bookingId = res.body.id;
      const list = await http().get('/api/dispatch').set('Authorization', `Bearer ${admin}`).expect(200);
      dispatch = list.body.find((d: { bookingId: string }) => d.bookingId === bookingId);
      expect(dispatch).toBeDefined();
    });

    it('shows the booking page only to people on the case, with only the patient id and name', async () => {
      await http().get(`/api/bookings/${bookingId}`).expect(401);
      await http().get(`/api/bookings/${bookingId}`).set('Authorization', `Bearer ${stranger}`).expect(404);
      const own = await http().get(`/api/bookings/${bookingId}`).set('Authorization', `Bearer ${patient}`).expect(200);
      expect(Object.keys(own.body.patient).sort()).toEqual(['id', 'name']);
      expect(JSON.stringify(own.body)).not.toContain('patient@e2e.test');
    });

    it('no longer serves the unauthenticated tracking page', async () => {
      await http().get(`/api/bookings/${bookingId}/tracking`).expect(404);
    });

    it('lets only the assigned driver move the trip, one step at a time', async () => {
      const ambulances = await http().get('/api/admin/ambulances').set('Authorization', `Bearer ${admin}`).expect(200);
      for (const ambulance of ambulances.body) {
        const email = `driver-${ambulance.vehicleNumber}@e2e.test`.toLowerCase();
        await http()
          .post('/api/auth/accounts')
          .set('Authorization', `Bearer ${admin}`)
          .send({ email, password: 'driverpass1', firstName: 'Driver', lastName: 'Test', role: 'DRIVER', vehicleNumber: ambulance.vehicleNumber })
          .expect(201);
        drivers[ambulance.id] = await login(email, 'driverpass1');
      }
      const assigned = drivers[dispatch.ambulanceId];
      const other = Object.entries(drivers).find(([id]) => id !== dispatch.ambulanceId)![1];
      const move = (token: string, status: string) =>
        http().patch(`/api/dispatch/${dispatch.id}/status`).set('Authorization', `Bearer ${token}`).send({ status });

      await move(other, 'EN_ROUTE_PICKUP').expect(404);
      await move(assigned, 'COMPLETED').expect(409);
      await move(assigned, 'EN_ROUTE_PICKUP').expect(200);
      await move(assigned, 'DISPATCHED').expect(409);
    });

    it('authenticates sockets and keeps strangers out of the case chat', async () => {
      expect((await connect(null)).error).toBe('Unauthorized');
      expect((await connect(patient, 'https://evil.example.net')).error).toBeDefined();

      const strangerSocket = await connect(stranger);
      expect(strangerSocket.error).toBeUndefined();
      expect(await reply(strangerSocket.socket, 'join_case_chat', { bookingId }, ['case_chat_history', 'case_chat_error'])).toBe('case_chat_error');

      const patientSocket = await connect(patient);
      expect(await reply(patientSocket.socket, 'join_case_chat', { bookingId }, ['case_chat_history', 'case_chat_error'])).toBe('case_chat_history');
    });
  });

  describe('admin controls', () => {
    it('validates and applies runtime settings', async () => {
      const auth = { Authorization: `Bearer ${admin}` };
      await http().patch('/api/admin/system/settings').set(auth).send({ dispatchRetryMaxAgeMinutes: 1 }).expect(400);
      await http().patch('/api/admin/system/settings').set(auth).send({ patientSignupEnabled: false }).expect(200);
      await register('late@e2e.test').expect(403);
      await http().patch('/api/admin/system/settings').set(auth).send({ patientSignupEnabled: true }).expect(200);
      await register('late@e2e.test').expect(201);
    });

    it('queues bookings for an admin while auto-dispatch is off, then dispatches by hand', async () => {
      const auth = { Authorization: `Bearer ${admin}` };
      await http().patch('/api/admin/system/settings').set(auth).send({ autoDispatchEnabled: false }).expect(200);
      const booking = await http()
        .post('/api/bookings')
        .set('Authorization', `Bearer ${stranger}`)
        .send({ pickupLatitude: 28.64, pickupLongitude: 77.22, pickupAddress: 'Connaught Place', severity: 'CRITICAL' })
        .expect(201);
      const queue = await http().get('/api/admin/bookings/queue').set(auth).expect(200);
      expect(queue.body.items.map((b: { id: string }) => b.id)).toContain(booking.body.id);

      const dispatched = await http().post(`/api/admin/bookings/${booking.body.id}/dispatch`).set(auth).send({}).expect(201);
      expect(dispatched.body.bookingId).toBe(booking.body.id);
      await http().post(`/api/admin/bookings/${booking.body.id}/dispatch`).set(auth).send({}).expect(409);
      await http().patch('/api/admin/system/settings').set(auth).send({ autoDispatchEnabled: true }).expect(200);

      const audit = await http().get('/api/admin/audit?action=MANUAL_DISPATCH').set(auth).expect(200);
      expect(audit.body.items[0].actorEmail).toBe('admin@e2e.test');
    });
  });

  describe('abuse protection', () => {
    // Runs last: afterwards this address cannot sign in for a minute.
    it('rate-limits password guessing per address', async () => {
      const first = await http().post('/api/auth/login').send({ email: 'nobody@e2e.test', password: 'wrong-pass' }).expect(401);
      expect(first.headers['x-ratelimit-limit']).toBe('1000');

      // Use up the rest of this address's allowance (however Node spells loopback).
      const limiter = app.get(RateLimiterService);
      for (const key of ['ip:127.0.0.1', 'ip:::ffff:127.0.0.1', 'ip:::1']) {
        for (let i = 0; i < 1000; i++) limiter.consume('auth-login', key, { limit: 1000, windowMs: 60_000 });
      }
      const refused = await http().post('/api/auth/login').send({ email: 'nobody@e2e.test', password: 'wrong-pass' }).expect(429);
      expect(refused.headers['retry-after']).toBeDefined();
    });
  });
});
