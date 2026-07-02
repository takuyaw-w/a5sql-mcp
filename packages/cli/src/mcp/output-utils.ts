import { withUntrustedPayloadContract } from "./output-contract.js";
import type { JsonObject } from "./types.js";

export function withUntrustedContentSignal(output: JsonObject): JsonObject {
  return withUntrustedPayloadContract(output);
}

export type PageSlice<T> = {
  items: T[];
  offset: number;
  limit: number;
  totalCount: number;
  returnedCount: number;
  hasMore: boolean;
  truncated: boolean;
};

export function slicePage<T>(
  items: T[],
  options: { offset?: number; limit: number },
): PageSlice<T> {
  const offset = options.offset ?? 0;
  const limit = options.limit;
  const pageItems = items.slice(offset, offset + limit);
  const hasMore = offset + pageItems.length < items.length;
  return {
    items: pageItems,
    offset,
    limit,
    totalCount: items.length,
    returnedCount: pageItems.length,
    hasMore,
    truncated: hasMore,
  };
}

export function limitItems<T>(
  items: T[],
  limit: number,
): { items: T[]; returnedCount: number; truncated: boolean } {
  const limitedItems = items.slice(0, limit);
  return {
    items: limitedItems,
    returnedCount: limitedItems.length,
    truncated: items.length > limitedItems.length,
  };
}
