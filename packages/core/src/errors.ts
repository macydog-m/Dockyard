export type ResourceErrorCode =
  | 'INVALID_REF' | 'NOT_FOUND' | 'AMBIGUOUS_REF' | 'CONFIG_INVALID'
  | 'DATA_UNAVAILABLE' | 'DATA_BUSY' | 'LEGACY_DATA' | 'INDEX_NOT_READY' | 'RESOURCE_TOO_LARGE' | 'INVALID_QUERY' | 'INDEX_STALE' | 'INDEX_INVALID' | 'INDEX_PARTIAL' | 'INDEX_REFRESH_FAILED';

export class ResourceError extends Error {
  constructor(
    public readonly code: ResourceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ResourceError';
  }
}
