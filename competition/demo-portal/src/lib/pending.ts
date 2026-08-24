/**
 * Small, additive helper that lets the homepage carry a typed question into the
 * experience workspace without adding any server or credential surface.
 */
export const PENDING_PROMPT_KEY = "portal.pendingPrompt";

export function setPendingPrompt(text: string): void {
  try {
    window.sessionStorage.setItem(PENDING_PROMPT_KEY, text);
  } catch {
    /* sessionStorage unavailable; the experience page falls back to the fixture prompt. */
  }
}

export function consumePendingPrompt(): string | null {
  try {
    const value = window.sessionStorage.getItem(PENDING_PROMPT_KEY);
    window.sessionStorage.removeItem(PENDING_PROMPT_KEY);
    return value || null;
  } catch {
    return null;
  }
}
