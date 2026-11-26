import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';

const LEVELS = ['basic', 'standard', 'full', 'custom'] as const;
const NAMED_LEVELS = ['basic', 'standard', 'full'] as const;
const ROLES = ['Owner', 'Admin', 'User'] as const;

/** What an editor asks for: any of on/off, a level, a custom pick. */
export class SetAssistantAccessDto {
  @ApiPropertyOptional({ description: 'Whether the assistant is on.' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    enum: LEVELS,
    description:
      'basic: see and ask. standard: plus day-to-day work on agents. full: ' +
      'everything the role can do in the console. custom: the names in `on`.',
  })
  @IsOptional()
  @IsIn(LEVELS)
  level?: (typeof LEVELS)[number];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Only with level custom: the ability names offered. Names the ' +
      'assistant does not have, and names above the role, are refused.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  on?: string[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'The `version` last read. A change made on a stale one is refused ' +
      'with 409 ASSISTANT_ACCESS_STALE.',
  })
  @IsOptional()
  @IsString()
  version?: string | null;
}

export class AssistantPickDto {
  @ApiProperty({ type: [String], description: 'The abilities offered.' })
  on: string[];

  @ApiProperty({
    type: [String],
    description:
      'Abilities that appeared after the pick was saved. Off until saved again.',
  })
  new: string[];
}

/** A setting as it applies to a role or a person. */
export class AssistantResolvedDto {
  @ApiProperty()
  enabled: boolean;

  @ApiProperty({ enum: LEVELS })
  level: (typeof LEVELS)[number];

  @ApiProperty({
    enum: NAMED_LEVELS,
    nullable: true,
    description: 'For a custom pick that equals a level.',
  })
  matchesLevel: (typeof NAMED_LEVELS)[number] | null;

  @ApiProperty({
    enum: ['owner', 'role', 'account'],
    description:
      'Where it comes from: the role, the account’s own exception, or ' +
      '`owner` — the Owner always has everything.',
  })
  source: 'owner' | 'role' | 'account';

  @ApiProperty({ description: 'Abilities offered, within the role.' })
  offered: number;

  @ApiProperty({ description: 'Abilities the role can have at all.' })
  available: number;

  @ApiProperty({ type: String, nullable: true })
  version: string | null;
}

export class AssistantRoleDto extends AssistantResolvedDto {
  @ApiProperty({ type: AssistantPickDto, nullable: true })
  pick: AssistantPickDto | null;
}

export class AssistantRoleRowDto extends AssistantRoleDto {
  @ApiProperty({ description: 'Accounts of the role that follow it.' })
  accounts: number;
}

export class AssistantRolesDto {
  @ApiProperty({ type: AssistantRoleRowDto })
  Admin: AssistantRoleRowDto;

  @ApiProperty({ type: AssistantRoleRowDto })
  User: AssistantRoleRowDto;
}

export class AssistantExceptionDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: ROLES })
  role: string;

  @ApiProperty({ type: AssistantResolvedDto })
  resolved: AssistantResolvedDto;

  @ApiProperty({ type: String, nullable: true, description: 'Who set it.' })
  updatedBy: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt: Date | null;

  @ApiProperty({
    description:
      'The pick holds abilities the account’s present role cannot have.',
  })
  reducedByRole: boolean;
}

export class AssistantRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class AssistantNoticeDto {
  @ApiProperty()
  usersManagingAgents: number;
}

export class AssistantOverviewDto {
  @ApiProperty({
    type: AssistantRefDto,
    nullable: true,
    description: 'Null while the installation has no assistant.',
  })
  assistant: AssistantRefDto | null;

  @ApiProperty({ type: AssistantRolesDto })
  roles: AssistantRolesDto;

  @ApiProperty({ type: [AssistantExceptionDto] })
  exceptions: AssistantExceptionDto[];

  @ApiProperty({
    type: AssistantNoticeDto,
    nullable: true,
    description:
      'Until the Owner has saved the Users’ setting: how many Users created ' +
      'agents and, starting on Basic, no longer manage them through the ' +
      'chat. Null afterwards, and when there are none.',
  })
  notice: AssistantNoticeDto | null;
}

export class AssistantAccountDto extends AssistantRoleDto {
  @ApiProperty()
  userId: string;

  @ApiProperty({ enum: ROLES })
  role: string;

  @ApiProperty({
    type: AssistantResolvedDto,
    nullable: true,
    description: 'What the account would get without its own setting.',
  })
  roleSetting: AssistantResolvedDto | null;

  @ApiProperty({ description: 'Whether the caller may change it.' })
  editable: boolean;

  @ApiProperty({
    type: [String],
    nullable: true,
    description:
      'For an Admin: the abilities they may hand out, their own. Null for ' +
      'the Owner, who has no such limit.',
  })
  ceiling: string[] | null;
}

export class AbilityDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  area: string;

  @ApiProperty({ enum: ['read', 'write'] })
  effect: 'read' | 'write';

  @ApiProperty()
  destructive: boolean;

  @ApiProperty({
    enum: ROLES,
    description: 'The lowest role that can have it.',
  })
  minRole: string;

  @ApiProperty({ enum: NAMED_LEVELS, isArray: true })
  levels: string[];

  @ApiProperty({
    description:
      'For a person below Admin this works on agents they created and on ' +
      'no other, also when it is ticked for them.',
  })
  ownAgentsOnly: boolean;
}

export class AbilityAreaDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  order: number;

  @ApiProperty({ type: [AbilityDto] })
  abilities: AbilityDto[];
}

export class AssistantCatalogDto {
  @ApiProperty({ type: [AbilityAreaDto] })
  areas: AbilityAreaDto[];

  @ApiProperty({
    type: [AbilityDto],
    description:
      'What the assistant needs to hold any conversation. No setting ' +
      'governs these.',
  })
  alwaysOn: AbilityDto[];
}

const ABILITY_STATES = ['included', 'own_agents_only', 'not_included'] as const;

/** One ability of the caller's role, and how it stands for the caller. */
export class MyAssistantAbilityDto {
  @ApiProperty({ description: 'The ability’s name: stable, never shown.' })
  name: string;

  @ApiProperty({ description: 'What it is, in words. Shown as received.' })
  title: string;

  @ApiProperty({
    enum: ABILITY_STATES,
    description:
      'included: the assistant does this for the caller. own_agents_only: ' +
      'only on agents the caller created. not_included: the caller’s role ' +
      'could have it and their setting leaves it out.',
  })
  state: (typeof ABILITY_STATES)[number];
}

export class AssistantAreaCountDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ description: 'How many of `abilities` are `included`.' })
  offered: number;

  @ApiProperty({
    description: 'How many abilities the caller’s role has here.',
  })
  available: number;

  @ApiProperty({
    type: [MyAssistantAbilityDto],
    description:
      'Every ability of the caller’s role in this area, by title. Nothing ' +
      'above their role and nothing about anybody else.',
  })
  abilities: MyAssistantAbilityDto[];
}

/** What a person is told about themselves. Nothing about anybody else. */
export class MyAssistantAccessDto {
  @ApiProperty()
  enabled: boolean;

  @ApiProperty({ enum: [...LEVELS, 'owner'] })
  level: string;

  @ApiProperty({ enum: NAMED_LEVELS, nullable: true })
  matchesLevel: string | null;

  @ApiProperty({ type: [AssistantAreaCountDto] })
  areas: AssistantAreaCountDto[];
}
