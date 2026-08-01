import Image from "next/image";

/**
 * The real club logo, from public/logo/logo.png.
 *
 * The source is a white mark on a solid #00612E field. The green is keyed
 * out of the derived assets below so the white mark can sit on whatever is
 * behind it — which, on the light re-theme, is nothing, since white-on-
 * transparent is invisible against a cream page. Both are wrapped in a small
 * green backdrop of their own instead, so the mark keeps its original
 * white-on-green contrast regardless of the page around it:
 *   crest-mark.png — hexagon + 武 + pine, no wordmark
 *   lockup.png     — the same crest with the ĐÀ LẠT / KENDO CLUB wordmark
 * Both are regenerated from logo.png; see scripts in the build notes.
 */

export function CrestMark({ className = "" }: { className?: string }) {
  return (
    <span className={`hex-tall inline-flex shrink-0 items-center justify-center bg-forest-700 ${className}`}>
      <Image
        src="/logo/crest-mark.png"
        alt="Huy hiệu Đà Lạt Kendo Club"
        width={523}
        height={604}
        priority
        className="h-[82%] w-[82%] object-contain"
      />
    </span>
  );
}

/** The club's own lockup, crest over wordmark. Used on the splash. */
export function FullLockup({ className = "" }: { className?: string }) {
  return (
    <div className={`hex-card inline-flex items-center justify-center bg-forest-700 p-8 ${className}`}>
      <Image
        src="/logo/lockup.png"
        alt="Đà Lạt Kendo Club"
        width={523}
        height={816}
        priority
        className="h-full w-auto"
      />
    </div>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`display leading-none ${className}`}>
      <span className="block text-bone">Đà Lạt Kendo Club</span>
      {/* The tagline is the first thing to go when width is scarce. */}
      <span className="hidden text-[0.55em] tracking-[0.3em] text-brass-600 sm:block">
        Mô phỏng huấn luyện viên
      </span>
    </span>
  );
}

/**
 * Header lockup: crest and wordmark side by side. The club's own lockup stacks
 * vertically, which would leave the wordmark unreadable at header height.
 */
export function Lockup({
  size = "md",
  className = "",
}: {
  size?: "md" | "lg";
  className?: string;
}) {
  if (size === "lg") {
    return <FullLockup className={`h-52 w-auto ${className}`} />;
  }
  return (
    <div className={`flex items-center gap-2 sm:gap-3 ${className}`}>
      <CrestMark className="h-9 w-9 sm:h-11 sm:w-11" />
      <Wordmark className="text-sm sm:text-lg" />
    </div>
  );
}
