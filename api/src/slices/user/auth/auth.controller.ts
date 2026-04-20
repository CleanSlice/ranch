import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './domain';
import { AuthDto, LoginDto } from './dtos';

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
}
