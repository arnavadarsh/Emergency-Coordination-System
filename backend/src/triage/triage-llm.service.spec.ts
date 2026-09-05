import { TriageLlmService } from './triage-llm.service';

/**
 * The request controls around the triage LLM: what is sent, what is refused,
 * and what happens when the model misbehaves.
 *
 * The clinical prompt and answer-sanitising are covered by the endpoint's own
 * behaviour; what matters here is that nothing unbounded or unaccounted reaches
 * a paid API, and that triage always has somewhere to fall back to.
 */
describe('TriageLlmService request controls', () => {
  let limits: Record<string, number>;
  let budget: { admit: jest.Mock; release: jest.Mock; recordSuccess: jest.Mock; recordFailure: jest.Mock; report: jest.Mock };
  let generateContent: jest.Mock;
  let service: TriageLlmService;

  const modelReply = (overrides: any = {}) => ({
    text: JSON.stringify({
      reply: 'How long has the chest pain lasted?',
      answers: { emergency_type: 'Chest pain / Heart problem' },
      quick_replies: ['Just started (less than 5 minutes)'],
      input_type: 'choice',
      keywords: ['chest'],
      done: false,
    }),
    usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 120 },
    ...overrides,
  });

  const config = {
    get: (key: string, fallback?: any) => {
      if (key.startsWith('gemini.limits.')) return limits[key.replace('gemini.limits.', '')] ?? fallback;
      if (key === 'gemini.apiKey') return 'test-key';
      if (key === 'gemini.model') return 'gemini-2.5-flash';
      return fallback;
    },
  };

  beforeEach(() => {
    limits = { timeoutMs: 50, maxMessages: 40, maxTranscriptChars: 12_000 };
    budget = {
      admit: jest.fn(() => ({ allowed: true })),
      release: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      report: jest.fn(() => ({ configured: true })),
    };
    generateContent = jest.fn(async () => modelReply());

    service = new TriageLlmService(config as any, budget as any);
    // Stand in for the SDK client the constructor built from the key.
    (service as any).client = { models: { generateContent } };
  });

  const transcript = (turns: number, textLength = 20) =>
    Array.from({ length: turns }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `${i}`.padEnd(textLength, 'x'),
    }));

  it('sends the conversation and returns the model’s reply', async () => {
    const result = await service.converse(transcript(2));

    expect(result.available).toBe(true);
    expect(result.reply).toContain('chest pain');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('bills the tokens the call actually used', async () => {
    await service.converse(transcript(2));
    expect(budget.recordSuccess).toHaveBeenCalledWith(800, 120);
  });

  it('does not call the model at all when a budget control refuses', async () => {
    budget.admit.mockReturnValue({ allowed: false, refusal: 'DAILY_TOKENS', retryAfterSeconds: 3600 });

    const result = await service.converse(transcript(2));

    expect(generateContent).not.toHaveBeenCalled();
    expect(result.available).toBe(false);
    expect(result.limited).toBe(true);
    expect(result.retryAfterSeconds).toBe(3600);
    // Nothing was taken, so nothing may be released.
    expect(budget.release).not.toHaveBeenCalled();
  });

  it('releases the concurrency slot even when the call throws', async () => {
    generateContent.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED'));

    const result = await service.converse(transcript(2));

    expect(budget.recordFailure).toHaveBeenCalled();
    expect(budget.release).toHaveBeenCalledTimes(1);
    expect(result.available).toBe(false);
    expect(result.limited).toBe(true);
  });

  it('gives up on a slow model rather than leaving triage hanging', async () => {
    generateContent.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(modelReply()), 500)));

    const result = await service.converse(transcript(2));

    expect(result.available).toBe(false);
    expect(budget.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('50ms') }));
    expect(budget.release).toHaveBeenCalledTimes(1);
  });

  describe('transcript trimming', () => {
    it('caps how many turns are sent upstream', async () => {
      limits.maxMessages = 10;
      await service.converse(transcript(30));

      const [{ contents }] = generateContent.mock.calls[0];
      expect(contents.length).toBeLessThanOrEqual(10);
    });

    it('caps the characters sent, which is the direct cost lever', async () => {
      limits.maxMessages = 100;
      limits.maxTranscriptChars = 400;

      await service.converse(transcript(40, 100));

      const [{ contents }] = generateContent.mock.calls[0];
      const chars = contents.reduce((sum: number, c: any) => sum + c.parts[0].text.length, 0);
      expect(chars).toBeLessThanOrEqual(400);
    });

    it('keeps the opening turns, where the emergency was established', async () => {
      limits.maxMessages = 8;
      const messages = transcript(30);
      messages[0].text = 'FIRST-TURN-EMERGENCY-TYPE';

      await service.converse(messages);

      const [{ contents }] = generateContent.mock.calls[0];
      expect(contents[0].parts[0].text).toBe('FIRST-TURN-EMERGENCY-TYPE');
      // …and the most recent turn, which carries the question being answered.
      expect(contents[contents.length - 1].parts[0].text).toBe(messages[messages.length - 1].text);
    });

    it('leaves a short conversation untouched', async () => {
      await service.converse(transcript(6));

      const [{ contents }] = generateContent.mock.calls[0];
      expect(contents).toHaveLength(6);
    });
  });

  it('reports unavailable without spending anything when no key is configured', async () => {
    const unconfigured = new TriageLlmService(
      { get: (k: string, f?: any) => (k === 'gemini.apiKey' ? '' : config.get(k, f)) } as any,
      budget as any,
    );

    const result = await unconfigured.converse(transcript(2));

    expect(result.available).toBe(false);
    expect(budget.admit).not.toHaveBeenCalled();
  });
});
