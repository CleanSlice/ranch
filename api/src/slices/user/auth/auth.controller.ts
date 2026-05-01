import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './domain';
import { IAuthTokenPayload } from './domain/auth.types';
import { AuthDto, LoginDto, RegisterDto } from './dtos';
import { UserDto } from '../user/dtos';
import { JwtAuthGuard } from './guards';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Authenticate and receive an access token' })
  async login(@Body() dto: LoginDto): Promise<AuthDto> {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('register')
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Self-service signup. Requires the 'auth.registration_enabled' setting to be true; otherwise 403.",
  })
  async register(@Body() dto: RegisterDto): Promise<AuthDto> {
    return this.authService.register(dto.name, dto.email, dto.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user' })
  async me(
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<UserDto> {
    return this.authService.me(req.user.sub);
  }
}
