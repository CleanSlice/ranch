export interface ILogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}

/** What a pod-log read hands back: the text, and why it may be a marker. */
export type PodLogState = 'logs' | 'no_pod' | 'waiting' | 'failed';

export interface IPodLogRead {
  /** Real lines came back (`logs`), or the reason they did not. */
  state: PodLogState;
  /** Raw log text, or a timestamp-less `[...]` marker line when there is none. */
  logs: string;
}

/**
 * The same read, reduced to what the console's collapsed Logs bar renders:
 * one line and two numbers (CLEAN-233). The bar used to download the whole
 * window every five seconds to work these out in the browser.
 */
export interface IPodLogSummary {
  state: PodLogState;
  /** The newest line, raw — or the `[...]` marker, which is the whole read. */
  logs: string;
  /** Lines in the window that was read, not in the pod's whole history. */
  total: number;
  /** How many of them carry a warn or error level. */
  alerts: number;
}
