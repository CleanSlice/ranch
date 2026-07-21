import { ErrorEntity } from "../error.entity";

export class GlobalError extends ErrorEntity {
  constructor(
    message: string,
    options: { statusCode: number; name: string; isToast: boolean }
  ) {
    super(message);
    this.name = options.name;
    this.statusCode = options.statusCode;
    this.isToast = options.isToast;
  }
}
