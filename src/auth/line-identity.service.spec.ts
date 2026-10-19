import axios from 'axios';
import { LineIdentityService } from './line-identity.service';
jest.mock('axios');
const get = axios.get as jest.Mock;
describe('LINE identity proof', () => {
  const service = new LineIdentityService();
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.LINE_LOGIN_CHANNEL_ID = 'school-channel';
  });
  afterEach(() => delete process.env.LINE_LOGIN_CHANNEL_ID);
  it('does not accept a LINE ID alone', async () => {
    await expect(service.verify(undefined, 'claimed-id')).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  it.each([
    { client_id: 'foreign-channel', expires_in: 100 },
    { client_id: 'school-channel', expires_in: 0 },
  ])('rejects foreign or expired tokens', async (response) => {
    get.mockResolvedValueOnce({ data: response });
    await expect(service.verify('token')).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('compares claimed ID to the verified profile', async () => {
    get
      .mockResolvedValueOnce({
        data: { client_id: 'school-channel', expires_in: 100 },
      })
      .mockResolvedValueOnce({ data: { userId: 'actual' } });
    await expect(service.verify('token', 'forged')).rejects.toThrow();
  });
  it('returns only the identity retrieved from LINE', async () => {
    get
      .mockResolvedValueOnce({
        data: { client_id: 'school-channel', expires_in: 100 },
      })
      .mockResolvedValueOnce({ data: { userId: 'actual' } });
    await expect(service.verify('token', 'actual')).resolves.toBe('actual');
  });
});
