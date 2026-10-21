import { ApiInstanceService } from './apiInstance.service';
import { IApiInstanceGateway } from './apiInstance.gateway';

const BASE_NOW = 1_760_000_000_000;

function createTestBed() {
  const gateway = {
    heartbeat: jest.fn().mockResolvedValue(undefined),
    countLive: jest.fn().mockResolvedValue(1),
    remove: jest.fn().mockResolvedValue(undefined),
    pruneBefore: jest.fn().mockResolvedValue(0),
  };
  const service = new ApiInstanceService(
    gateway as unknown as IApiInstanceGateway,
  );
  return { service, gateway };
}

describe('ApiInstanceService', () => {
  let now: number;
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    jest.useFakeTimers();
    now = BASE_NOW;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('registers itself on boot and keeps the row fresh every 10 s', async () => {
    const { service, gateway } = createTestBed();
    await service.onModuleInit();

    expect(gateway.heartbeat).toHaveBeenCalledTimes(1);
    const [id, hostname, at] = gateway.heartbeat.mock.calls[0] as [
      string,
      string,
      Date,
    ];
    expect(id).toBe(service.id);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(hostname.length).toBeGreaterThan(0);
    expect(at.getTime()).toBe(BASE_NOW);

    now += 10_000;
    await jest.advanceTimersByTimeAsync(10_000);
    expect(gateway.heartbeat).toHaveBeenCalledTimes(2);
    expect(gateway.heartbeat.mock.calls[1][0]).toBe(service.id);
    expect((gateway.heartbeat.mock.calls[1][2] as Date).getTime()).toBe(
      BASE_NOW + 10_000,
    );

    service.onModuleDestroy();
  });

  test('a copy is live while its row is under 30 s old', async () => {
    const { service, gateway } = createTestBed();
    gateway.countLive.mockResolvedValue(2);

    await expect(service.liveCount()).resolves.toBe(2);
    expect((gateway.countLive.mock.calls[0][0] as Date).getTime()).toBe(
      BASE_NOW - 30_000,
    );
  });

  test('prunes rows nobody refreshed for an hour on each heartbeat', async () => {
    const { service, gateway } = createTestBed();
    await service.onModuleInit();

    expect(gateway.pruneBefore).toHaveBeenCalledTimes(1);
    expect((gateway.pruneBefore.mock.calls[0][0] as Date).getTime()).toBe(
      BASE_NOW - 60 * 60_000,
    );

    service.onModuleDestroy();
  });

  test('a failed heartbeat is logged and the next tick still runs', async () => {
    const { service, gateway } = createTestBed();
    gateway.heartbeat.mockRejectedValueOnce(new Error('db away'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    now += 10_000;
    await jest.advanceTimersByTimeAsync(10_000);
    expect(gateway.heartbeat).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
  });

  test('leaving removes the row and stops the timer', async () => {
    const { service, gateway } = createTestBed();
    await service.onModuleInit();

    await service.onModuleDestroy();
    expect(gateway.remove).toHaveBeenCalledWith(service.id);

    now += 30_000;
    await jest.advanceTimersByTimeAsync(30_000);
    expect(gateway.heartbeat).toHaveBeenCalledTimes(1);
  });

  test('a failed removal does not throw out of shutdown', async () => {
    const { service, gateway } = createTestBed();
    await service.onModuleInit();
    gateway.remove.mockRejectedValueOnce(new Error('db away'));

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
