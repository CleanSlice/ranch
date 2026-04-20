/**
 * Standalone shim for CleanSlice #core imports.
 * When bridle runs inside a full CleanSlice project, this file is unused —
 * the #core alias resolves to the real core setup slice.
 */

/**
 * FlatResponse decorator — in CleanSlice, standardizes response format.
 * Here it's a passthrough so the controller works standalone.
 */
export function FlatResponse(): MethodDecorator {
  return (_target, _key, descriptor) => descriptor;
}
