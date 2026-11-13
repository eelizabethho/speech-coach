/** Short random id, safe to call on client or server. */
export function makeId(prefix = ""): string {
  let rand = "";
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    }
  } catch {
    /* ignore */
  }
  if (!rand) rand = Math.random().toString(36).slice(2, 14);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}
