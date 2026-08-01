"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Giải đấu" },
  { href: "/chi-so", label: "Chỉ số Kendoka" },
];

/** Top-level menu. The tournament itself lives at "/". */
export function MainNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-2">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`hex-tab display px-2.5 py-1.5 text-[10px] transition-colors sm:px-4 sm:py-2 sm:text-[11px] ${
              active
                ? "bg-brass-400 text-forest-900"
                : "bg-forest-700 text-bone-dim hover:bg-forest-600 hover:text-brass-200"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
