/**
 * Optional hook to translate raw errors (network / SDK failures) into domain
 * errors before they leave the data layer. Slices that need provider-specific
 * error handling implement this and pass it to `BaseGateway`'s constructor.
 */
export interface IErrorMapper {
  toErrorEntity(error: unknown): unknown;
}

/** Default mapper — re-throws the original error unchanged. */
const passthroughErrorMapper: IErrorMapper = {
  toErrorEntity: (error) => error,
};

/**
 * Base class for data-layer gateways. Centralizes the
 * `try { ... } catch { throw errorMapper.toErrorEntity(error) }` boilerplate so
 * concrete gateways focus on SDK calls + mapper invocation. Wrap each method
 * body in `this.execute(async () => { ... })`.
 *
 * By default a thrown error is re-thrown unchanged; slices that need to
 * translate provider-specific error shapes pass an `IErrorMapper` to `super()`.
 */
export abstract class BaseGateway {
  protected errorMapper: IErrorMapper;

  constructor(errorMapper?: IErrorMapper) {
    this.errorMapper = errorMapper ?? passthroughErrorMapper;
  }

  protected async execute<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw this.errorMapper.toErrorEntity(error);
    }
  }
}
