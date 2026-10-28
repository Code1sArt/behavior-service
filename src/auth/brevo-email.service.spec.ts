import { BrevoEmailService } from './brevo-email.service';

describe('Brevo OTP sender', () => {
  const originalFetch = global.fetch;
  const keys = [
    'STAFF_EMAIL_OTP_ENABLED',
    'BREVO_API_KEY',
    'BREVO_SENDER_EMAIL',
    'STAFF_OTP_SECRET',
  ];
  let previous: (string | undefined)[];
  beforeEach(() => {
    previous = keys.map((key) => process.env[key]);
    process.env.STAFF_EMAIL_OTP_ENABLED = 'true';
    process.env.BREVO_API_KEY = 'fake-server-only-key';
    process.env.BREVO_SENDER_EMAIL = 'noreply@example.com';
    process.env.STAFF_OTP_SECRET = 'test-secret-with-at-least-32-characters';
    global.fetch = jest.fn(async () => ({ ok: true })) as any;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
  });
  it('sends only through the official server API with a timeout', async () => {
    await new BrevoEmailService().sendOtp('staff@example.com', '012345', true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'api-key': 'fake-server-only-key' }),
        signal: expect.any(AbortSignal),
      }),
    );
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.to).toEqual([{ email: 'staff@example.com' }]);
    expect(body.textContent).toContain('012345');
  });
  it.each(keys)('fails closed without %s', async (key) => {
    delete process.env[key];
    await expect(
      new BrevoEmailService().sendOtp('staff@example.com', '012345', false),
    ).rejects.toMatchObject({ status: 503 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each([false, 'timeout'])(
    'maps delivery rejection %s to a safe 503',
    async (failure) => {
      global.fetch = jest.fn(async () => {
        if (failure === 'timeout') throw new Error('secret-provider-detail');
        return { ok: false };
      }) as any;
      await expect(
        new BrevoEmailService().sendOtp('staff@example.com', '012345', false),
      ).rejects.toMatchObject({ status: 503 });
    },
  );
});
