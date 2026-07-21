import { ErrorEntity } from "../domain/error.entity";
import { ErrorCodes } from "../domain";
import type { ErrorDetailResponse, PlatformStatusResponse } from "../domain/error.types";

type ErrorResponseBody = ErrorDetailResponse & PlatformStatusResponse;

export class ErrorMapper {
  toErrorEntity(error: unknown): ErrorEntity {
    const fetchError = error as { response?: { status?: number; _data?: ErrorResponseBody }; statusCode?: number; data?: ErrorResponseBody };
    const status = fetchError.response?.status ?? fetchError.statusCode ?? 500;
    const responseData = fetchError.response?._data ?? fetchError.data;

    // Platform status (6000 geo-block / 6001 maintenance): every boot request
    // fails with the same body, and the api.config onResponse interceptor
    // already handles the redirect — surface a silent entity (no toast).
    if (responseData?.error === 6000 || responseData?.error === 6001) {
      return new ErrorEntity(responseData.message || "platform_status", {
        statusCode: status,
        isToast: false,
        name: "platform_status",
        code: responseData.error === 6000 ? ErrorCodes.GEO_BLOCKED : ErrorCodes.MAINTENANCE,
      });
    }

    const { text: detail, fromStructuredDetail } = this.extractDetail(responseData?.detail);
    const errorCode = detail ? detail : "UNEXPECTED_ERROR";
    const name = this.toGetErrorName(errorCode);
    const message = detail
      ? fromStructuredDetail
        ? detail
        : this.toGetDetail(detail)
      : name;

    return new ErrorEntity(message, {
      statusCode: status,
      name,
      isToast: true,
    });
  }

  private extractDetail(detail: ErrorDetailResponse["detail"]): {
    text: string;
    fromStructuredDetail: boolean;
  } {
    if (!detail) return { text: "", fromStructuredDetail: false };
    if (typeof detail === "string") {
      return { text: detail, fromStructuredDetail: false };
    }
    if (Array.isArray(detail)) {
      return {
        text: detail
          .map((d) => {
            const field = d.loc?.filter((l) => l !== "body").join(".") ?? "";
            const msg = d.msg ?? d.ctx?.error ?? "";
            return field ? `${field}: ${msg}` : msg;
          })
          .filter(Boolean)
          .join(" | "),
        fromStructuredDetail: true,
      };
    }
    return {
      text: detail.msg ?? detail.ctx?.error ?? "",
      fromStructuredDetail: true,
    };
  }

  private toGetErrorName(error: string): string {
    const errorTypeMap: Record<string, ErrorCodes> = {
      UNEXPECTED_ERROR: ErrorCodes.UNEXPECTED_ERROR,
      UNAUTHORIZED: ErrorCodes.UNAUTHORIZED,
      FORBIDDEN: ErrorCodes.FORBIDDEN,
      NOT_FOUND: ErrorCodes.NOT_FOUND,
      BAD_REQUEST: ErrorCodes.BAD_REQUEST,
      ERR_NETWORK: ErrorCodes.ERR_NETWORK,
    };
    return (errorTypeMap[error.toUpperCase()] || ErrorCodes.UNEXPECTED_ERROR).toLowerCase();
  }

  private toGetDetail(detail: string): string {
    return detail.toLowerCase().replace(/\s+/g, "_");
  }
}
