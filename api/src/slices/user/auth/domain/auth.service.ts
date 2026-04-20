import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { UserMapper } from '../../user/data/user.mapper';
import { IAuthResult, IAuthTokenPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private mapper: UserMapper,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<IAuthResult> {
    const record = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!record) throw new UnauthorizedException('Invalid credentials');

    const passwordMatch = await bcrypt.compare(password, record.password);
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials');

    if (record.status === 'disabled') {
      throw new UnauthorizedException('Account disabled');
    }

    const user = this.mapper.toEntity(record);
    const roles: string[] = [];
    if (user.role === 'owner' || user.role === 'admin') roles.push('ADMIN');
    const payload: IAuthTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      roles,
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      user,
    };
  }
}
