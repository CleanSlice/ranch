export interface ErrorTypes {
  UNEXPECTED_ERROR: string;
  UNAUTHORIZED: string;
  FORBIDDEN: string;
  NOT_FOUND: string;
  BAD_REQUEST: string;
  INTERNAL_SERVER_ERROR: string;
}
export interface IErrorData {
  title: string;
  description: string;
  code: string;
  statusCode: number;
  isToast: boolean;
}
export enum ErrorCodes {
  UNEXPECTED_ERROR = "UNEXPECTED_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  BAD_REQUEST = "BAD_REQUEST",
  ERR_NETWORK = "ERR_NETWORK",
  GEO_BLOCKED = "GEO_BLOCKED",
  MAINTENANCE = "MAINTENANCE",
}
type ErrorDetail = {
  type?: string;
  msg?: string;
  loc?: string[];
  input?: unknown;
  ctx?: {
    error: string;
  };
}
export type ErrorDetailResponse = {
  detail?: string | ErrorDetail | ErrorDetail[];
}
/**
 * Platform status body (may arrive with any HTTP status):
 * `{ error: 6000, message: "Forbidden geo", redirect_url: "…/blocked" }`.
 * 6000 = geo-block, 6001 = maintenance.
 */
export type PlatformStatusResponse = {
  error?: number;
  message?: string;
  redirect_url?: string;
}
