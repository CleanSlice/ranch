import {
  buildAgentEnv,
  IAgentWorkflowManifestInput,
} from './agent-workflow.manifest';

function manifestInput(
  telegram: IAgentWorkflowManifestInput['telegram'],
): IAgentWorkflowManifestInput {
  return {
    agentId: 'a1',
    agentName: 'Test',
    templateId: 't1',
    image: 'ghcr.io/x/runtime:1',
    imagePullPolicy: 'Always',
    cpu: '1',
    memory: '1Gi',
    isAdmin: false,
    debugEnabled: false,
    ownerUserId: 'u1',
    ranchApiUrl: 'http://api',
    ranchApiToken: 'tok',
    bridleUrl: 'http://bridle',
    bridleApiKey: 'key',
    s3Bucket: 'bucket',
    s3Prefix: 'agents/a1',
    s3Endpoint: 'http://s3',
    awsRegion: 'eu-central-1',
    awsAccessKeyId: 'ak',
    awsSecretAccessKey: 'sk',
    secretProvider: 'aws',
    awsSecretPrefix: 'ranch',
    agentConfigB64: 'e30=',
    mcpServersB64: 'W10=',
    llm: {
      provider: 'claude',
      model: 'claude-sonnet-5',
      fallbackModel: '',
      apiKey: 'llm',
      auxProvider: '',
      auxModel: '',
      auxFallbackModel: '',
      auxApiKey: '',
    },
    telegram,
  };
}

describe('buildAgentEnv telegram injection', () => {
  test('tombstoned/unconfigured channel (empty config from getForAgent) injects no TELEGRAM_* vars', () => {
    const env = buildAgentEnv(
      manifestInput({ botToken: '', botName: '', adminIds: '' }),
    );

    const names = env.map((e) => e.name);
    expect(names).not.toContain('TELEGRAM_BOT_TOKEN');
    expect(names).not.toContain('TELEGRAM_BOT_NAME');
    expect(names).not.toContain('TELEGRAM_BOT_ADMIN_IDS');
  });

  test('configured channel injects all TELEGRAM_* vars', () => {
    const env = buildAgentEnv(
      manifestInput({ botToken: '123:abc', botName: 'my_bot', adminIds: '42' }),
    );

    const byName = Object.fromEntries(env.map((e) => [e.name, e.value]));
    expect(byName.TELEGRAM_BOT_TOKEN).toBe('123:abc');
    expect(byName.TELEGRAM_BOT_NAME).toBe('my_bot');
    expect(byName.TELEGRAM_BOT_ADMIN_IDS).toBe('42');
  });
});
