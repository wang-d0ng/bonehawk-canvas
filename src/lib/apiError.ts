export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = "API_ERROR"
  ) {
    super(message);
  }
}

export class CanvasApiError extends ApiError {
  constructor(statusCode: number, message: string) {
    super(statusCode, message, "CANVAS_API_ERROR");
  }
}
