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
import {
  AdminEmbedTokenDto,
  AuthDto,
  EmbedTokenDto,
  EmbedTokenResultDto,
  LoginDto,
  RegisterDto,
} from './dtos';
import { UserDto } from '../user/dtos';
import { ApiKeyScopeTypes } from '../apiKey/domain';
import { UserRoleTypes } from '../user/domain';
import {
  ApiKeyGuard,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  Scopes,
  ScopesGuard,
} from './guards';

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

  @Post('embed/token')
  @HttpCode(200)
  @UseGuards(ApiKeyGuard, ScopesGuard)
  @Scopes(ApiKeyScopeTypes.EmbedMint)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Mint a short-lived browser embed JWT for the bridle widget. Auth: API key with embed:mint scope. Owner/Admin roles are stripped from the result regardless of input.',
  })
  embedToken(@Body() dto: EmbedTokenDto): Promise<EmbedTokenResultDto> {
    return this.authService.mintEmbedToken({
      sub: dto.sub,
      email: dto.email,
      roles: dto.roles,
      expiresIn: dto.expiresIn,
    });
  }

  @Post('embed/admin-token')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Mint a short-lived ADMIN embed JWT for the bridle widget. Auth: logged-in Owner/Admin (not API key). Keeps the caller roles, so the hub routes the chat to the admin channel — embed only on private pages. TTL defaults to 12h, capped at 7d.',
  })
  adminEmbedToken(
    @Req() req: Request & { user: IAuthTokenPayload },
    @Body() dto: AdminEmbedTokenDto,
  ): Promise<EmbedTokenResultDto> {
    return this.authService.mintAdminEmbedToken(req.user, dto.expiresIn);
  }
}
