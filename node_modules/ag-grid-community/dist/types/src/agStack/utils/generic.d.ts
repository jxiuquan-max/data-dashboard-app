/**
 * If value is undefined, null or blank, returns null, otherwise returns the value
 * @param {T} value
 * @returns {T | null}
 */
export declare const _makeNull: <T>(value?: T) => T | null;
export declare function _exists(value: string | null | undefined): value is string;
export declare function _exists<T>(value: T): value is NonNullable<T>;
export declare function _missing<T>(value: T | null | undefined): value is Exclude<undefined | null, T>;
export declare const _toStringOrNull: (value: any) => string | null;
export declare const _jsonEquals: <T1, T2>(val1: T1, val2: T2) => boolean;
export declare const _defaultComparator: (valueA: any, valueB: any, accentedCompare?: boolean) => number;
