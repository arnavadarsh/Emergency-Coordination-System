import { GoneException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { TrackingNotifierService } from './tracking-notifier.service';

/**
 * The public half of the tracking API, exercised over real HTTP.
 *
 * What is being checked here is mostly the *absence* of things: no bearer
 * token, no session, no app — a relative with a link in a text message has none
 * of those, and the feature is worthless if any of them is required.
 */
describe('TrackingController (public routes)', () => {
  let app: INestApplication;
  let trackingService: { getPublicView: jest.Mock; getShareInfo: jest.Mock };
  let notifier: { getOptOutState: jest.Mock; setOptOut: jest.Mock };

  beforeEach(async () => {
    trackingService = { getPublicView: jest.fn(), getShareInfo: jest.fn() };
    notifier = { getOptOutState: jest.fn(), setOptOut: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [TrackingController],
      providers: [
        { provide: TrackingService, useValue: trackingService },
        { provide: TrackingNotifierService, useValue: notifier },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts, so this exercises the same pipeline the browser hits.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the live view with no Authorization header at all', async () => {
    trackingService.getPublicView.mockResolvedValue({ caseReference: 'ECS-ABC12345' });

    const response = await request(app.getHttpServer()).get('/api/tracking/public/tok_abc').expect(200);

    expect(response.body.caseReference).toBe('ECS-ABC12345');
    expect(trackingService.getPublicView).toHaveBeenCalledWith('tok_abc');
  });

  it('answers 410 with a readable reason once the case has ended', async () => {
    trackingService.getPublicView.mockRejectedValue(
      new GoneException({ statusCode: 410, status: 'ENDED', reason: 'COMPLETED', message: 'This case has ended.' }),
    );

    const response = await request(app.getHttpServer()).get('/api/tracking/public/tok_abc').expect(410);

    expect(response.body).toMatchObject({ status: 'ENDED', reason: 'COMPLETED' });
  });

  it('answers 404 for a token that was never issued', async () => {
    trackingService.getPublicView.mockRejectedValue(new NotFoundException('This tracking link is not valid.'));

    await request(app.getHttpServer()).get('/api/tracking/public/made-up').expect(404);
  });

  it('does not mistake the opt-out path for a tracking token', async () => {
    notifier.getOptOutState.mockResolvedValue({ optedOut: false });

    await request(app.getHttpServer()).get('/api/tracking/public/opt-out/opt_1').expect(200);

    expect(trackingService.getPublicView).not.toHaveBeenCalled();
    expect(notifier.getOptOutState).toHaveBeenCalledWith('opt_1');
  });

  it('treats a bare opt-out POST as "stop messaging me"', async () => {
    notifier.setOptOut.mockResolvedValue({ optedOut: true });

    await request(app.getHttpServer()).post('/api/tracking/public/opt-out/opt_1').send({}).expect(201);

    expect(notifier.setOptOut).toHaveBeenCalledWith('opt_1', true);
  });

  it('lets the same person opt back in', async () => {
    notifier.setOptOut.mockResolvedValue({ optedOut: false });

    await request(app.getHttpServer())
      .post('/api/tracking/public/opt-out/opt_1')
      .send({ optOut: false })
      .expect(201);

    expect(notifier.setOptOut).toHaveBeenCalledWith('opt_1', false);
  });

  it('rejects a junk opt-out body rather than guessing', async () => {
    await request(app.getHttpServer())
      .post('/api/tracking/public/opt-out/opt_1')
      .send({ optOut: 'maybe', unexpected: 1 })
      .expect(400);

    expect(notifier.setOptOut).not.toHaveBeenCalled();
  });
});
