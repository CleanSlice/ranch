import { Test, TestingModule } from '@nestjs/testing';
import { McpRegistryService } from './mcp-registry.service';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { z } from 'zod';

describe('McpRegistryService', () => {
  let service: McpRegistryService;

  const mockResource = (name: string, uri: string) => ({
    type: 'resource',
    metadata: { name, uri },
    providerClass: Symbol(name),
    methodName: 'someMethod',
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpRegistryService,
        {
          provide: DiscoveryService,
          useValue: {
            getProviders: jest.fn(() => []),
            getControllers: jest.fn(() => []),
          },
        },
        MetadataScanner,
      ],
    }).compile();

    service = module.get<McpRegistryService>(McpRegistryService);
    (service as any).discoveredTools = [
      mockResource('res0', '/posts/comments'),
      mockResource('res1', '/users/{id}'),
      mockResource('res2', '/posts/:postId/comments'),
      mockResource('res3', 'mcp://hello-world'),
    ];
  });

  it('should return the correct resource by URI', () => {
    const result = service.findResourceByUri('/users/123');
    expect(result?.resource.metadata.name).toBe('res1');
    expect(result?.params).toEqual({ id: '123' });
  });

  it('should return undefined for unknown URI', () => {
    const result = service.findResourceByUri('/unknown/path');
    expect(result).toBeUndefined();
  });

  it('should match complex URI template', () => {
    const result = service.findResourceByUri('/posts/456/comments');
    expect(result?.resource.metadata.name).toBe('res2');
    expect(result?.params).toEqual({ postId: '456' });
  });

  it('should match simple URI template', () => {
    const result = service.findResourceByUri('/posts/comments');
    expect(result?.resource.metadata.name).toBe('res0');
    expect(result?.params).toEqual({});
  });

  it('should match mcp URI', () => {
    const result = service.findResourceByUri('mcp://hello-world');
    expect(result?.resource.metadata.name).toBe('res3');
    expect(result?.params).toEqual({});
  });

  /**
   * CLEAN-109: a tool the Tools panel cannot show must not boot. Each case
   * removes one required field from an otherwise complete tool and expects
   * the bootstrap to name the tool and the field.
   */
  describe('tool metadata validation', () => {
    const complete = () => ({
      name: 'register_thing',
      description: 'Register a thing.',
      topic: 'mcp_servers',
      title: 'Register a thing',
      template: 'Register the thing «name»',
      parameters: z.object({ name: z.string() }),
    });

    const withTools = (...metas: object[]) => {
      (service as any).discoveredTools = metas.map((metadata, i) => ({
        type: 'tool',
        metadata,
        providerClass: Symbol(`tool${i}`),
        methodName: 'run',
      }));
    };

    it('accepts a complete tool', () => {
      withTools(complete());
      expect(() => service.validateToolMetadata()).not.toThrow();
    });

    it.each([
      ['topic', { topic: 'nope' }, 'unknown topic'],
      ['title', { title: '' }, 'missing title'],
      ['template', { template: '  ' }, 'missing template'],
      ['long title', { title: 'x'.repeat(61) }, 'title longer'],
      ['long template', { template: '«' + 'x'.repeat(200) }, 'template longer'],
      [
        'placeholder',
        { template: 'Register the thing' },
        'template has parameters but no «…» placeholder',
      ],
    ])('refuses a tool with a bad %s', (_label, patch, expected) => {
      withTools({ ...complete(), ...patch });
      expect(() => service.validateToolMetadata()).toThrow(
        expect.objectContaining({
          message: expect.stringContaining(`register_thing: ${expected}`),
        }),
      );
    });

    it('allows a template without placeholders when the tool takes no parameters', () => {
      withTools({
        ...complete(),
        template: 'List every thing',
        parameters: z.object({}),
      });
      expect(() => service.validateToolMetadata()).not.toThrow();
    });

    it('refuses a destructive tool without a boolean confirm parameter', () => {
      withTools({ ...complete(), destructive: true });
      expect(() => service.validateToolMetadata()).toThrow(
        /register_thing: destructive tool without a boolean `confirm`/,
      );
      withTools({
        ...complete(),
        destructive: true,
        parameters: z.object({ name: z.string(), confirm: z.string() }),
      });
      expect(() => service.validateToolMetadata()).toThrow(/confirm/);
      withTools({
        ...complete(),
        destructive: true,
        parameters: z.object({ name: z.string(), confirm: z.boolean() }),
      });
      expect(() => service.validateToolMetadata()).not.toThrow();
    });

    it('refuses duplicate tool names', () => {
      withTools(complete(), complete());
      expect(() => service.validateToolMetadata()).toThrow(/duplicate tool name/);
    });

    it('lists every problem in one error', () => {
      withTools({ ...complete(), title: '', template: '' });
      let message = '';
      try {
        service.validateToolMetadata();
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('register_thing: missing title');
      expect(message).toContain('register_thing: missing template');
    });
  });
});
