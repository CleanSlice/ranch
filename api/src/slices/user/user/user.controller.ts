import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IUserGateway } from './domain';
import { CreateUserDto, UpdateUserDto } from './dtos';

@ApiTags('users')
@Controller('users')
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
  @ApiOperation({ summary: 'Update user' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userGateway.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove user' })
  async remove(@Param('id') id: string) {
    const user = await this.userGateway.findById(id);
    if (!user) throw new NotFoundException('User not found');
    await this.userGateway.delete(id);
  }
}
