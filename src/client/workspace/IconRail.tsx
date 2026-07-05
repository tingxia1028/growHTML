// IconRail (R1) — the narrow (~56px) vertical strip on the far left. It is CHROME, not a
// dock pane (rendered by WorkspaceShell outside the resizable tree). Each icon swaps which
// view-kind fills the left rail slot (the dock's switchable left leaf); the default is
// Library. This is how the panes that used to be always-on columns (Bookmarks / Concepts /
// Operations / Layers) are now reached — they stay registered + fully reachable.
//
// Bottom: the SHELL-1 user menu (UserMenu) — the avatar/identity button + popover
// aggregating the app's scattered settings/config surfaces (设置 / Kit & 插件 /
// 画像与记忆 / 分享身份 / 账户积分-stub / 新手引导 / 关于). The display name is the
// local Tier-A svpack identity when one exists, else 本地用户 — replacing the old
// R1.5 static "Growte" placeholder now that a real (optional) identity exists.

import { BookOpenCheck, Folder, Network, UserRound } from "lucide-react";
import type { ComponentType } from "react";
import { defineMessages, resolveText, t, useLocale, type LocalizedText } from "../i18n";
import { UserMenu } from "./UserMenu";

export type RailEntry = {
  kind: string;
  label: LocalizedText;
  Icon: ComponentType<{ size?: number }>;
};

const railMessages = defineMessages({
  panels: { zh: "面板", en: "Panels" },
  library: { zh: "资料库", en: "Library" },
  concepts: { zh: "知元", en: "Concepts" },
  review: { zh: "复习", en: "Review" },
  profile: { zh: "画像", en: "Profile" }
});

// Maps to existing registered view kinds (spec §4). Anchors/Bookmarks (bookmark.list),
// AI Chat (study) and Layers (layer.switcher) were removed from the rail — they duplicate
// the right sidebar's tabs (Anchor / Notes / Layers / AI Chat). layer.switcher stays
// reachable from the user menu (分享身份) and onboarding; the bookmark.list/study views
// stay registered (right sidebar + navigation resolve them) — only the rail icons are gone.
export const RAIL_ENTRIES: RailEntry[] = [
  { kind: "library", label: railMessages.library, Icon: Folder },
  { kind: "review.panel", label: railMessages.review, Icon: BookOpenCheck },
  { kind: "concept.list", label: railMessages.concepts, Icon: Network },
  { kind: "profile.panel", label: railMessages.profile, Icon: UserRound }
];

export type IconRailProps = {
  /** The view-kind currently shown in the left rail slot. */
  selected: string;
  /** Show a pane kind in the left rail slot. */
  onSelect(kind: string): void;
};

export function IconRail({ selected, onSelect }: IconRailProps) {
  useLocale();
  return (
    <nav className="icon-rail" aria-label={t(railMessages.panels)}>
      <div className="icon-rail-entries">
        {RAIL_ENTRIES.map((entry) => {
          const label = resolveText(entry.label);
          return (
            <button
              key={entry.kind}
              type="button"
              className={`icon-rail-btn${selected === entry.kind ? " active" : ""}`}
              aria-label={label}
              aria-pressed={selected === entry.kind}
              title={label}
              onClick={() => onSelect(entry.kind)}
            >
              <entry.Icon size={20} />
            </button>
          );
        })}
      </div>
      <UserMenu />
    </nav>
  );
}
