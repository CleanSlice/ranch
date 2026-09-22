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
