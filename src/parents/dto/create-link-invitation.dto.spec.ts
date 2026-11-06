import { validate } from 'class-validator';
import { CreateLinkInvitationDto } from './create-link-invitation.dto';

describe('CreateLinkInvitationDto', () => {
  it('accepts a student ID alone for classroom issuance', async () => {
    const dto = Object.assign(new CreateLinkInvitationDto(), {
      studentCitizenId: 'S0001',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts parent-bound requests from older clients', async () => {
    const dto = Object.assign(new CreateLinkInvitationDto(), {
      studentCitizenId: 'S0001',
      parentCitizenId: '0123456789012',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it.each(['', '1234', '123456789012a', 1234567890123])(
    'rejects an invalid parent ID when explicitly supplied: %s',
    async (parentCitizenId) => {
      const dto = Object.assign(new CreateLinkInvitationDto(), {
        studentCitizenId: 'S0001',
        parentCitizenId,
      });
      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'parentCitizenId')).toBe(
        true,
      );
    },
  );

  it('still requires a student ID', async () => {
    const errors = await validate(new CreateLinkInvitationDto());
    expect(errors.some((error) => error.property === 'studentCitizenId')).toBe(
      true,
    );
  });
});
