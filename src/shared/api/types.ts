export type JsonBody =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean;

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: JsonBody;
  rawBody?: Blob;
  skipAuthRetry?: boolean;
}

type ApiResponseSuccess<T> = {
  success: true;
  statusCode: number;
  path: string;
  timestamp: string;
  data: T;
};

type ApiResponseError = {
  success: false;
  statusCode: number;
  path: string;
  timestamp: string;
  message: string | string[];
};

export type ApiResponse<T> = ApiResponseSuccess<T> | ApiResponseError;
