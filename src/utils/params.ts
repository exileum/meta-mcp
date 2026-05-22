import type { FormParamValue, FormParams } from "../services/meta-client.js";

// Skips only `undefined`, not the rest of the falsy set — `if (x)` checks
// silently dropped `0` (#32 thumb_offset bug), `false`, and `""`.
export function buildParams(
  required: FormParams,
  optional: Record<string, FormParamValue | undefined>
): FormParams {
  const params: FormParams = { ...required };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) {
      params[key] = value;
    }
  }
  return params;
}
