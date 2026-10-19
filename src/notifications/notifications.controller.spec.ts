import { JwtService } from '@nestjs/jwt';
import { NotificationsController } from './notifications.controller';

const secret = 'local-unit-test-only';
const jwt = new JwtService({ secret });
const service = { register: jest.fn(), remove: jest.fn() };
const controller = new NotificationsController(service as never, jwt);

describe('device API JWT ownership', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    jest.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.JWT_SECRET;
  });
  it('derives owner and expiry from the verified JWT rather than client fields', async () => {
    const token = jwt.sign({ sub: 'real-user' }, { expiresIn: '1h' });
    await controller.register(`Bearer ${token}`, {
      token: 'device-token-long-enough',
      platform: 'ios',
      userId: 'attacker',
    } as never);
    expect(service.register).toHaveBeenCalledWith(
      'real-user',
      expect.any(Date),
      expect.any(Object),
    );
  });
  it('rejects tokens with no expiry', async () => {
    const token = jwt.sign({ sub: 'user' });
    await expect(
      controller.register(`Bearer ${token}`, {} as never),
    ).rejects.toThrow();
    expect(service.register).not.toHaveBeenCalled();
  });
  it('rejects invalid signatures', async () => {
    const token = new JwtService({ secret: 'wrong-secret' }).sign(
      { sub: 'user' },
      { expiresIn: '1h' },
    );
    await expect(
      controller.remove(`Bearer ${token}`, { token: 'device-token' }),
    ).rejects.toThrow();
    expect(service.remove).not.toHaveBeenCalled();
  });
});
