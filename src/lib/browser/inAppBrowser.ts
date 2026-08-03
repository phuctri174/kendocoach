/**
 * Known in-app WebView signatures worth warning about — these embed a
 * stripped-down, less predictable browser engine (inconsistent `dvh`
 * support, their own persistent toolbar eating into the viewport in ways
 * the page can't measure reliably) rather than the user's actual
 * Safari/Chrome. Not exhaustive — just the ones a link posted in a DM/feed
 * realistically arrives from.
 */
const IN_APP_UA_PATTERNS = [
  /FBAN|FBAV|FB_IAB|FBIOS/i, // Facebook app + Messenger
  /Instagram/i,
  /BytedanceWebview|TikTok|musical_ly/i,
  /\bLine\//i,
  /Zalo/i,
] as const;

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_UA_PATTERNS.some((pattern) => pattern.test(userAgent));
}
