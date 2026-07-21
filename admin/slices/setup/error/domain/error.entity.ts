export class ErrorEntity extends Error {
  public statusCode: number = 500;
  public isToast = false;
  public title: string = "";
  public description: string = "";
  public code: string = "";

  constructor(
    message?: string,
    options?: {
      statusCode?: number;
      isToast?: boolean;
      name?: string;
      code?: string;
    }
  ) {
    super(message);
    this.title = `${message}_title`;
    this.description = `${message}_description`;
    this.statusCode = options?.statusCode ?? 500;
    this.isToast = options?.isToast ?? false;
    this.name = options?.name ?? this.constructor.name;
    this.code = options?.code ?? "";
  }

  getStatus() {
    return this.statusCode;
  }
}
