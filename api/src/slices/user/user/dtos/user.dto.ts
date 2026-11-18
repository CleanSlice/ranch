import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRoleTypes } from '../domain';
import { AgentAccessSummaryDto } from '#/user/agentAccess/dtos/agentAccess.dto';

export class UserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty({
    enum: UserRoleTypes,
    enumName: 'UserRoleTypes',
    example: UserRoleTypes.User,
  })
  role: UserRoleTypes;

  @ApiProperty()
  status: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({
    type: AgentAccessSummaryDto,
    description:
      'What the account\u2019s agent access lists come to (CLEAN-231): the mark on the user list. The Owner is always `all`. The lists themselves are read through GET /users/:id/agent-access. Present on the /users routes only: the session routes (login, /auth/me) do not carry it.',
  })
  agentAccess?: AgentAccessSummaryDto;
}
