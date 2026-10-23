export const PROTOCOL_VERSION = 2 as const;

export const API_PREFIX = `/v${PROTOCOL_VERSION}` as const;

export const apiPath = <P extends `/${string}`>(path: P) =>
  `${API_PREFIX}${path}` as const;
