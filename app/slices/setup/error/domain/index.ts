export * from "./error.entity";
export * from "./error.types";
// Note: error.service is NOT exported here to avoid circular dependency
// Import it directly: import { handleError } from "#error/domain/error.service"
export * as GlobalError from "./errors";
