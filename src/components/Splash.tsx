import { FullLockup } from "@/components/Crest";

/**
 * Centred club lockup. Also the SSR placeholder for anything seeded randomly
 * on the client — rendering it on both passes keeps hydration honest.
 */
export function Splash({ caption = "Đang chuẩn bị lượt tuyển chọn…" }: { caption?: string }) {
  return (
    <div className="pine-watermark flex min-h-[60vh] flex-col items-center justify-center gap-8">
      <FullLockup className="h-56 w-auto" />
      <p className="display text-xs text-bone-faint">{caption}</p>
    </div>
  );
}
