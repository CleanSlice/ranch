import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IUserGateway, UserRoleTypes } from './domain';
import {
  CreateUserDto,
  UpdateUserDto,
  UpdateUserRolesDto,
} from './dtos';
import {
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from '../auth/guards';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
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
  @ApiOperation({ summary: 'Invite a new user' })
  create(@Body() dto: CreateUserDto) {
    return this.userGateway.create(dto);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update user (name, email, password, status). Use /roles to change roles.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userGateway.update(id, dto);
  }

  @Put(':id/roles')
  @Roles(UserRoleTypes.Owner)
  @ApiOperation({ summary: 'Replace the user\'s roles. Owner only.' })
  updateRoles(@Param('id') id: string, @Body() dto: UpdateUserRolesDto) {
    return this.userGateway.update(id, { roles: dto.roles });
  }

  @Delete(':id')
  @Roles(UserRoleTypes.Owner)
  @ApiOperation({ summary: 'Remove user. Owner only.' })
  async remove(@Param('id') id: string) {
    const user = await this.userGateway.findById(id);
    if (!user) throw new NotFoundException('User not found');
    await this.userGateway.delete(id);
  }
}
