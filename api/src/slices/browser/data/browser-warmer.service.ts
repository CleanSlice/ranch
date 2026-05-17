import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/**
 * Holds a single CDP WebSocket open per pool session so that browserless
 * keeps Chrome alive — otherwise Chrome exits the moment the connecting
 * client disconnects and the `/live` view renders a blank Xvfb desktop.
 *
 * Why this lives on the API side, not the runtime tool:
 *   `openSession` is called from three places — admin UI ("Add account"),
 *   runtime `browser_login` tool, and the MCP `browser_session_open`
 *   wrapper. Warming at the call site means every caller has to know to
 *   do it; warming inside the gateway means a vncUrl is always backed
 *   by a live Chrome the moment it's handed out.
 *
 * Lifecycle:
 *   - `warm()` opens a CDP socket and sends a single `Target.createTarget`
 *     pointing at the loginUrl. The socket stays open in `holds`.
 *   - Default TTL 15 min matches the VNC JWT exp. Earlier release happens
 *     via `release(sessionId)` from `browser_login_done` once the user
 *     finishes signing in.
 *   - `OnModuleDestroy` tears every socket down on api shutdown so we
 *     don't leak Chrome processes during a rolling deploy.
 */
interface IHeldSocket {
  ws: WebSocket;
  timer: ReturnType<typeof setTimeout>;
}

@Injectable()
export class BrowserWarmerService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserWarmerService.name);
  private readonly holds = new Map<string, IHeldSocket>();

  async warm(
    sessionId: string,
    cdpUrl: string,
    launchUrl: string,
    ttlMs = 15 * 60 * 1000,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    // Replace any prior hold for this session — repeated openSession calls
    // for the same (userId, accountKey) shouldn't stack timers / sockets.
    this.release(sessionId);

    let ws: WebSocket;
    try {
      ws = new WebSocket(cdpUrl);
    } catch (err) {
      return { ok: false, error: `Failed to construct CDP WS: ${(err as Error).message}` };
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const openTimer = setTimeout(() => {
          try { ws.close(); } catch { /* ignore */ }
          reject(new Error('CDP open timeout — pool unreachable'));
        }, 15_000);

        ws.addEventListener(
          'open',
          () => {
            clearTimeout(openTimer);
            // Browser-level CDP — Target.createTarget opens a new tab in
            // the running Chrome. browserless launched Chrome with the
            // tenant's --user-data-dir on this WS upgrade, so the tab
            // sees that profile's cookies.
            ws.send(
              JSON.stringify({
                id: 1,
                method: 'Target.createTarget',
                params: { url: launchUrl },
              }),
            );
            resolve();
          },
          { once: true },
        );

        ws.addEventListener(
          'error',
          () => {
            clearTimeout(openTimer);
            reject(new Error('CDP open error — pool refused connection'));
          },
          { once: true },
        );
      });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    const timer = setTimeout(() => {
      this.logger.log(`Warm hold for ${sessionId} expired (${ttlMs}ms)`);
      try { ws.close(); } catch { /* ignore */ }
      this.holds.delete(sessionId);
    }, ttlMs);

    ws.addEventListener('close', (event) => {
      clearTimeout(timer);
      this.holds.delete(sessionId);
      const code = (event as CloseEvent).code;
      if (code !== 1000) {
        this.logger.warn(`Warm hold for ${sessionId} dropped early (close ${code})`);
      }
    });

    this.holds.set(sessionId, { ws, timer });
    return { ok: true };
  }

  release(sessionId: string): void {
    const held = this.holds.get(sessionId);
    if (!held) return;
    clearTimeout(held.timer);
    try { held.ws.close(); } catch { /* ignore */ }
    this.holds.delete(sessionId);
  }

  onModuleDestroy(): void {
    for (const [sessionId, held] of this.holds.entries()) {
      clearTimeout(held.timer);
      try { held.ws.close(); } catch { /* ignore */ }
      this.holds.delete(sessionId);
    }
  }
}
