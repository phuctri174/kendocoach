"use client";

import { useState, useSyncExternalStore } from "react";
import { isInAppBrowser } from "@/lib/browser/inAppBrowser";

// The user agent can't change mid-session, so there's nothing to actually
// subscribe to — this only exists to give useSyncExternalStore a value that
// differs between server (no navigator, always the safe "false" default)
// and client, without the extra render pass a setState-in-effect would add.
function subscribeNever() {
  return () => {};
}
function getUserAgentIsInApp() {
  return isInAppBrowser(navigator.userAgent);
}
function getServerSnapshot() {
  return false;
}

/**
 * In-app WebViews (Messenger, Zalo, Instagram, TikTok) are unreliable enough
 * — inconsistent viewport-unit support, their own persistent toolbar eating
 * into available height unpredictably — that chasing every rendering quirk
 * inside them isn't worth it; many sites just point the user at their real
 * browser instead. This is that pointer: a small, dismissible strip, not a
 * blocking wall — the app still has to work reasonably well here regardless.
 */
export function InAppBrowserBanner() {
  const detected = useSyncExternalStore(subscribeNever, getUserAgentIsInApp, getServerSnapshot);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!detected || dismissed) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can itself be blocked inside some in-app WebViews —
      // the banner's own text is the fallback instruction either way.
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-brass-400 px-3 py-2 text-center text-xs text-forest-900 sm:px-6">
      <span>
        Bạn đang mở bằng trình duyệt trong ứng dụng — một số phần có thể hiển thị sai. Hãy mở bằng
        Safari/Chrome để xem tốt nhất.
      </span>
      <div className="flex items-center gap-3">
        <button type="button" onClick={copyLink} className="underline underline-offset-2 hover:no-underline">
          {copied ? "Đã sao chép!" : "Sao chép liên kết"}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Đóng thông báo"
          className="font-bold"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
