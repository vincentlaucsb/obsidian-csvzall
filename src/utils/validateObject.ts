type Guard<T> = (value: unknown) => value is T;

type ObjectValidator<T extends object> = {
  [K in keyof T]-?: Guard<T[K]>;
};

export const isString = (value: unknown): value is string => typeof value === "string";
export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
export const isNumber = (value: unknown): value is number => typeof value === "number";
export const isArray: Guard<unknown[]> = Array.isArray;

export function literal<T extends string | number>(expected: T): Guard<T> {
  return (value): value is T => value === expected;
}

export function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (value): value is T | undefined => value === undefined || guard(value);
}

export function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(guard);
}

/** Check the declared fields in place, preserving additional properties. */
export default function validateObject<T extends object>(validators: ObjectValidator<T>): Guard<T> {
  const keys = Reflect.ownKeys(validators) as (keyof T)[];
  return (value): value is T => isRecord(value) && keys.every(key => validators[key](value[key]));
}
