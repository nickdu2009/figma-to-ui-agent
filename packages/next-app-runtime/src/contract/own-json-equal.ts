export function ownJsonEqual(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  const leftIsArray = Array.isArray(left);
  if (leftIsArray && (left as unknown[]).length !== (right as unknown[]).length) {
    return false;
  }
  if (!leftIsArray) {
    const leftPrototype = Object.getPrototypeOf(left);
    const rightPrototype = Object.getPrototypeOf(right);
    const leftIsPlain = leftPrototype === Object.prototype || leftPrototype === null;
    const rightIsPlain = rightPrototype === Object.prototype || rightPrototype === null;
    if (!leftIsPlain || !rightIsPlain) return false;
  }

  const seenRights = seen.get(left);
  if (seenRights?.has(right)) return true;
  if (seenRights) seenRights.add(right);
  else seen.set(left, new WeakSet([right]));

  const leftKeys = Reflect.ownKeys(left).filter(
    (key) => !leftIsArray || key !== "length",
  );
  const rightKeys = Reflect.ownKeys(right).filter(
    (key) => !leftIsArray || key !== "length",
  );
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
    const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
    if (
      !leftDescriptor ||
      !rightDescriptor ||
      !("value" in leftDescriptor) ||
      !("value" in rightDescriptor) ||
      !ownJsonEqual(leftDescriptor.value, rightDescriptor.value, seen)
    ) {
      return false;
    }
  }
  return true;
}
