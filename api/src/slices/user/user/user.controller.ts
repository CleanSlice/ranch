import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IUserGateway, UserRoleTypes } from './domain';
import { CreateUserDto, UpdateUserDto, UpdateUserRoleDto } from './dtos';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleTypes.Admin)
export class UserController {
  constructor(private userGateway: IUserGateway) {}

  @Get()
  @ApiOperation({ summary: 'List all users' })
  findAll() {
    return this.userGateway.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  async findById(@Param('id') id: string) {
    const user = await this.userGateway.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  @Post()
  @ApiOperation({ summary: 'Create a user (admin sets the password)' })
  create(@Body() dto: CreateUserDto) {
    return this.userGateway.create(dto);
  }

  @Put(':id')
  @ApiOperation({
    summary:
      'Update user (name, email, password, status). Use /role to change the role.',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const target = await this.getTargetOrThrow(id);
    if (dto.status !== undefined && target.role === UserRoleTypes.Owner) {
      throw new ForbiddenException('The Owner account status cannot be changed');
    }
    return this.userGateway.update(id, dto);
  }

  @Put(':id/role')
  @Roles(UserRoleTypes.Owner)
  @ApiOperation({ summary: "Set the user's role. Owner only." })
  async updateRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    const target = await this.getTargetOrThrow(id);
    if (target.role === UserRoleTypes.Owner) {
      throw new ForbiddenException('The Owner role cannot be changed');
    }
    return this.userGateway.update(id, { role: dto.role });
  }

  @Delete(':id')
  @Roles(UserRoleTypes.Owner)
  @ApiOperation({ summary: 'Remove user. Owner only.' })
  async remove(@Param('id') id: string) {
    const target = await this.getTargetOrThrow(id);
    if (target.role === UserRoleTypes.Owner) {
      throw new ForbiddenException('The Owner account cannot be removed');
    }
    await this.userGateway.delete(id);
  }

  private async getTargetOrThrow(id: string) {
    const user = await this.userGateway.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
