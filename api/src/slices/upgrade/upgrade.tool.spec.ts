import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { UpgradeTool } from './upgrade.tool';
import { UserRoleTypes } from '#/user/user/domain';

const request = (roles: UserRoleTypes[]): Request =>
  ({ user: { sub: 'agent:x', email: '', roles } }) as unknown as Request;
const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

const harness = (eligible = true) => {
  const upgrade = {
    getStatus: jest.fn(async () => ({
      eligible,
      reason: eligible ? null : 'working tree is dirty',
      currentVersion: '1.2.3',
    })),
    run: jest.fn(async () => ({ ok: true, output: 'pulled' })),
  };
  return { tool: new UpgradeTool(upgrade as never), upgrade };
};

const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

describe('UpgradeTool (CLEAN-109)', () => {
  it('is listed for operators only', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('refuses a plain agent before touching the service', async () => {
    const { tool, upgrade } = harness();
    await expect(tool.status({}, null, plainAgent())).rejects.toThrow(
      ForbiddenException,
    );
    expect(upgrade.getStatus).not.toHaveBeenCalled();
  });

  it('reports the status', async () => {
    const { tool } = harness(false);
    const text = textOf(await tool.status({}, null, operator()));
    expect(text).toContain('"eligible": false');
    expect(text).toContain('working tree is dirty');
  });

  it('refuses to run when not eligible, without asking for confirmation', async () => {
    const { tool, upgrade } = harness(false);
    const result = await tool.run({ confirm: true }, null, operator());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('working tree is dirty');
    expect(upgrade.run).not.toHaveBeenCalled();
  });

  it('asks for confirmation when eligible and runs once confirmed', async () => {
    const { tool, upgrade } = harness();
    const refused = await tool.run({}, null, operator());
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('confirm: true');
    expect(upgrade.run).not.toHaveBeenCalled();

    const done = await tool.run({ confirm: true }, null, operator());
    expect(upgrade.run).toHaveBeenCalledTimes(1);
    expect(textOf(done)).toContain('pulled');
  });
});
