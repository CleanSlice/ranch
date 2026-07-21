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
 * concrete gateways focus on SDK calls + mapper invocation.
 *
 * Usage:
 *   export class ChatGateway extends BaseGateway implements IChatGateway {
 *     private mapper = new ChatMapper();
 *
 *     listMine(page: number, perPage: number): Promise<IChatListResult> {
 *       return this.execute(async () => {
 *         const res = await ChatsService.getMyChats({ query: { page, perPage } });
 *         return this.mapper.toList(unwrapEnvelope(res.data));
 *       });
 *     }
 *   }
 *
 * Wrapping the whole method body (rather than a narrower `executeAndMap`) lets
 * gateways branch, pre-compute query objects, and post-process freely without
 * contorting the signature.
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
