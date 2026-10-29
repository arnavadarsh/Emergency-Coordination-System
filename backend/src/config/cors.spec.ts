import { isOriginAllowed } from './cors';

/** The socket and the API accept exactly the same sites. */
describe('isOriginAllowed', () => {
  const saved = { origins: process.env.CORS_ORIGINS, env: process.env.NODE_ENV };

  afterEach(() => {
    process.env.CORS_ORIGINS = saved.origins;
    process.env.NODE_ENV = saved.env;
  });

  it('accepts only the configured dashboards', () => {
    process.env.CORS_ORIGINS = 'https://ecs.example.com, https://admin.example.com/';
    expect(isOriginAllowed('https://ecs.example.com')).toBe(true);
    expect(isOriginAllowed('https://admin.example.com')).toBe(true);
    expect(isOriginAllowed('https://evil.example.net')).toBe(false);
  });

  it('lets requests with no Origin through — they still need a token', () => {
    process.env.CORS_ORIGINS = 'https://ecs.example.com';
    expect(isOriginAllowed(undefined)).toBe(true);
  });

  it('allows any origin in development when nothing is configured, and none in production', () => {
    process.env.CORS_ORIGINS = '';
    process.env.NODE_ENV = 'development';
    expect(isOriginAllowed('http://localhost:3001')).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(isOriginAllowed('http://localhost:3001')).toBe(false);
  });
});
