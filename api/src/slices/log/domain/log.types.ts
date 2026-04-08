export interface ILogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}
