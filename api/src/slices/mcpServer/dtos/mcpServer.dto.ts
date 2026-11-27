import { ApiProperty } from '@nestjs/swagger';

/** An MCP server of the registry, as `GET /mcp-servers` answers it. */
export class McpServerDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty() url: string;
  @ApiProperty({ enum: ['streamableHttp', 'sse'] }) transport: string;
  @ApiProperty({ enum: ['none', 'bearer', 'header', 'oauth'] })
  authType: string;
  @ApiProperty({ type: String, nullable: true }) authValue: string | null;
  @ApiProperty({ type: String, nullable: true }) oauthClientId: string | null;
  @ApiProperty() enabled: boolean;
  @ApiProperty() builtIn: boolean;
  @ApiProperty({ type: [String] }) templateIds: string[];
  @ApiProperty({
    description:
      'True when the Ranch assistant is built from this resource (CLEAN-271): only the Owner can change it, and a console shows it read-only to anybody else.',
  })
  assistantDependency: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
