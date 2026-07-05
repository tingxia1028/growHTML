// WorkspaceShell — recursively renders a WorkspaceLayout's DOCK TREE (layout.layout)
// through the ViewRegistry. A `split` node becomes a row/column flex container; a `leaf`
// resolves its `nodeId` to a WorkspaceNode and renders it via `renderNode`. The root
// split IS the `.app-shell` flex container, so a single-row layout stays flat; nested
// splits (e.g. a reader with a bottom panel) add `.dock-split` containers.
//
// Panes are DRAG-RESIZABLE in both axes: a thin gutter sits between adjacent children;
// dragging it resizes the neighbouring FIXED pane (col-resize in a row, row-resize in a
// column) while the flexible child (size:"flex", e.g. the reader) absorbs the slack.
// Sizes persist to localStorage so the layout you set sticks across reloads.
//
// Importing this module also registers the built-in views (via ./views etc.), so a
// consumer only has to render <WorkspaceShell layout={…} /> inside a WorkspaceProvider.

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import type { WorkspaceLayout, WorkspaceNode } from "../data/entityClient";
import { resolveText, t, type LocalizedText } from "../i18n";
import { renderNode } from "./viewRegistry";
import { useWorkspace } from "./WorkspaceContext";
import {
  childInitialPx,
  clampDockPx,
  dockNodeMap,
  dockRoot,
  flexFor,
  gutterTarget,
  isCollapsibleLeaf,
  isPaneCollapsed,
  paneCollapseKey,
  paneLabel,
  type DockChild,
  type DockNode
} from "./dock";
// Side-effect imports: register the built-in view plugins.
//   ./views          → library / source.viewer / study (the original three panes)
//   ./conceptViews   → concept.list (the P5 concept/relation pane)
//   ./layerViews     → layer.switcher (the V2 Study Layer pane)
//   ./practiceViews  → practice (the Textbook Learning layout's bottom panel)
import "./views";
//   ./SourceTabs     → source.tabs (F1 P-A1: the multi-document reader host — tab strip
//                      over the open panes + the focused pane's body)
import "./SourceTabs";
import "./conceptViews";
import "./layerViews";
//   ./bookmarkViews  → bookmark.list (the Bookmark V1 jump strip)
import "./bookmarkViews";
import "./practiceViews";
//   ./operationViews → operation.manager (the operation-as-data builder + manager)
import "./operationViews";
//   ./anchorViews    → anchor.excerpt (the right column's Anchor section, R1)
import "./anchorViews";
//   ./BottomBar      → action.bar (the R6.2 third action surface; registered, not docked)
import "./BottomBar";
//   ./RightSidebarTabs → right.tabs (the tabbed right sidebar) + note.list (Page Anchors)
import "./RightSidebarTabs";
//   ./pluginManagerViews → plugin.manager (the Kit & Plugin manager panel)
import "./pluginManagerViews";
//   ./trashViews → trash.panel (the TRUST-3 回收站 — reached via the UserMenu 数据 group)
import "./trashViews";
//   ../review/ReviewPanel → review.panel (the REV-1 复习 runner — reached via the IconRail)
import "../review/ReviewPanel";
//   ./mistakeBookView → mistake.book (the 错题本 browse/manage surface — reached via the IconRail)
import "./mistakeBookView";
//   ../../kits/teachback/TeachbackPanel → teachback.panel (the PRO-2 教回 runner — reached
//   via the teachback.start command / global search + the opt-in teach-back trigger)
import "../../kits/teachback/TeachbackPanel";
//   ../../kits/study-report/ReportListView → report.list (the REPORT-1 学习报告 list — the
//   home of source-less report notes; reached via the study-report.open command / global search)
import "../../kits/study-report/ReportListView";
//   ../profile/ProfilePanel → profile.panel (the MEM-2 画像/记忆管理 page — IconRail)
import "../profile/ProfilePanel";
//   ../settings/SettingsHub → settings.hub (SHELL-1 — reached via the user menu, no rail icon)
import "../settings/SettingsHub";
//   ../onboarding/OnboardingPanel → onboarding.checklist (SHELL-2 — center slot on first run)
import "../onboarding/OnboardingPanel";
import "./ShortcutHelp";
import { entityClient } from "../data/entityClient";
import { shouldAutoOpenOnboarding } from "../onboarding/steps";
import { registerShellNavigator } from "./shellNav";
import { TopBar } from "./TopBar";
import { IconRail } from "./IconRail";
import { SelectionFloatingToolbar } from "./SelectionFloatingToolbar";
import { FloatingNoteEditor } from "./FloatingNoteEditor";
import { ConceptMarkToast } from "./ConceptMarkToast";
import { DraftNoteToast } from "./DraftNoteToast";
import { NudgeToast } from "./NudgeToast";
import { startIdleTracking } from "./idleSignal";
import { startProactiveTick } from "./proactiveTick";
import { GlobalSpeakSelection } from "../speech/GlobalSpeakSelection";
import { GlobalSearch } from "../search/GlobalSearch";
// N6/§D12: the Anchor Focus board overlay — mounted once here (like the floating editor /
// global search above), opened by the TopBar's Anchor Focus tab via the shared store.
import { AnchorBoardMount } from "./AnchorFocusBoard";

// px size overrides keyed by dock child key (leaf nodeId, else its tree path).
const SIZES_KEY = "sv-panel-widths";
// Per-pane collapsed flags, keyed by `${layoutId}:${nodeId}`.
const COLLAPSED_KEY = "sv-pane-collapsed";
// Collapsed left sidebar consumes no dock width; the IconRail is the reopen control.
const RAIL_PX = 0;

// The dock leaf nodeId that the IconRail / TopBar buttons SWAP: selecting a rail entry
// renders that view-kind in this slot instead of the static "library" view. Keeps the
// previously always-on side panes (bookmarks/concepts/layers/operations) reachable without
// always-on columns. Default selection = library.
const LEFT_SLOT_NODE_ID = "library";
const DEFAULT_LEFT_KIND = "library";

// The CENTER slot (the reader leaf) — SHELL-2 swaps it to the onboarding checklist
// (first run / user-menu reopen) exactly the way the IconRail swaps the left slot:
// the SAME leaf renders a different registered kind; closing restores the reader.
const CENTER_SLOT_NODE_ID = "source-viewer";
const ONBOARDING_KIND = "onboarding.checklist";
const modalTitles: Record<string, LocalizedText> = {
  "settings.hub": { zh: "设置", en: "Settings" },
  "plugin.manager": { zh: "套件", en: "Kits" },
  "operation.manager": { zh: "操作", en: "Operations" },
  "layer.switcher": { zh: "分享身份", en: "Share Identity" },
  "trash.panel": { zh: "回收站", en: "Trash" },
  "onboarding.checklist": { zh: "新手引导", en: "Onboarding" },
  "shortcut.help": { zh: "快捷键", en: "Shortcuts" }
};
const modalMessages = {
  close: { zh: "关闭弹窗", en: "Close dialog" }
} as const;

function modalTitle(kind: string): string {
  return resolveText(modalTitles[kind] ?? { zh: kind, en: kind });
}

function loadSizes(): Record<string, number> {
  try {
    const raw = globalThis.localStorage?.getItem(SIZES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(COLLAPSED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function currentWidth(): number {
  return typeof window !== "undefined" ? window.innerWidth : 9999;
}

// Stable storage/identity key for a resizable child: its leaf nodeId (meaningful +
// preserves saved widths) or, for a nested split, its position path.
function childKey(child: DockChild, path: string): string {
  return child.node.type === "leaf" ? child.node.nodeId : path;
}

export function WorkspaceShell({ layout }: { layout: WorkspaceLayout }) {
  const ctx = useWorkspace();
  const nodes = useMemo(() => dockNodeMap(layout), [layout]);
  const root = dockRoot(layout);

  const [sizes, setSizes] = useState<Record<string, number>>(loadSizes);
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;

  // Which view-kind the switchable LEFT_SLOT renders (IconRail / TopBar buttons set it).
  const [leftPaneKind, setLeftPaneKind] = useState<string>(DEFAULT_LEFT_KIND);

  // Whether the CENTER slot shows the onboarding checklist instead of the reader
  // (SHELL-2). Set by the first-run effect below + the shell nav bus (user menu's
  // 帮助/新手引导 reopens it; the checklist's own 跳过/带我去 actions close it).
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [modalKind, setModalKind] = useState<string | null>(null);
  const modalCloseRef = useRef<HTMLButtonElement | null>(null);

  // Register the "show the operation manager" handler the Customize-Toolbar seam fires
  // (R6.3): the manager is reachable as the left-slot kind, so showing it = swapping the
  // left pane to "operation.manager". This is how an ActionMoreMenu's Customize footer
  // opens the panel without reaching into the shell (IRON LAW).
  const { registerOpenOperationManager } = ctx;
  useEffect(() => {
    registerOpenOperationManager(() => setModalKind("operation.manager"));
  }, [registerOpenOperationManager]);

  // The shell nav bus (SHELL-1/2): user menu entries, settings deep-links and
  // onboarding 带我去 buttons navigate through this ONE registered handler instead
  // of reaching into the shell (the registerOpenOperationManager idiom, module-scope).
  useEffect(() => {
    registerShellNavigator((target) => {
      if (target.type === "pane") openLeftPane(target.kind);
      else if (target.type === "modal") setModalKind(target.kind);
      else if (target.open) setModalKind(ONBOARDING_KIND);
      else {
        setOnboardingOpen(false);
        setModalKind((kind) => (kind === ONBOARDING_KIND ? null : kind));
      }
    });
    return () => registerShellNavigator(null);
  }, [layout.id]);

  // PRO-1 主动学习 (proactive-learning.md §1, CLIENT-CENTRIC): while the shell is mounted,
  // track idle activity + run the proactive tick (every 60s + on focus/visibility). The
  // tick evaluates the code-registered built-ins ∪ entity triggers against the REAL LOCAL
  // clock and pushes a pending nudge NudgeToast renders. Started once (no shell reach-in).
  useEffect(() => {
    const stopIdle = startIdleTracking();
    const stopTick = startProactiveTick();
    return () => {
      stopTick();
      stopIdle();
    };
  }, []);

  useEffect(() => {
    if (!modalKind) return;
    modalCloseRef.current?.focus();
  }, [modalKind]);

  useEffect(() => {
    if (!modalKind) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setModalKind(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalKind]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "?" || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (target?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select") return;
      event.preventDefault();
      setModalKind("shortcut.help");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // First-run detection (SHELL-2): fresh vault (no sources) AND a pristine onboarding
  // block → auto-open the checklist as the initial center view. Self-contained reads
  // (race-free against the context's own loading); any failure means NO auto-open.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [{ sources }, { onboarding }] = await Promise.all([
          entityClient.sources(),
          entityClient.onboardingState()
        ]);
        if (!cancelled && shouldAutoOpenOnboarding({ sourceCount: sources.length, onboarding })) {
          setOnboardingOpen(true);
        }
      } catch {
        // Endpoints unreachable (tests / degraded transport) — never auto-open.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // User collapse flags (explicit toggles) + the live viewport width (drives responsive
  // auto-collapse of secondary panes). Both feed `isPaneCollapsed`.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const [viewportWidth, setViewportWidth] = useState<number>(currentWidth);
  useEffect(() => {
    const onResize = () => setViewportWidth(currentWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function toggleCollapsed(collapseKey: string, next: boolean) {
    setCollapsed((prev) => {
      const updated = { ...prev, [collapseKey]: next };
      try {
        globalThis.localStorage?.setItem(COLLAPSED_KEY, JSON.stringify(updated));
      } catch {
        // storage unavailable — keep the in-memory flags
      }
      return updated;
    });
  }

  function openLeftPane(kind: string) {
    setLeftPaneKind(kind);
    toggleCollapsed(paneCollapseKey(layout.id, LEFT_SLOT_NODE_ID), false);
  }

  function selectLeftPaneFromRail(kind: string) {
    const collapseKey = paneCollapseKey(layout.id, LEFT_SLOT_NODE_ID);
    const isLeftCollapsed = collapsed[collapseKey] ?? false;
    if (kind === leftPaneKind && !isLeftCollapsed) {
      toggleCollapsed(collapseKey, true);
      return;
    }
    setLeftPaneKind(kind);
    toggleCollapsed(collapseKey, false);
  }

  function pxFor(key: string, fallback: number): number {
    return sizes[key] ?? fallback;
  }

  function startDrag(event: ReactMouseEvent, key: string, sign: 1 | -1, axis: "x" | "y", fallback: number) {
    event.preventDefault();
    const start = axis === "x" ? event.clientX : event.clientY;
    const startPx = sizesRef.current[key] ?? fallback;
    const onMove = (e: MouseEvent) => {
      const cur = axis === "x" ? e.clientX : e.clientY;
      setSizes((prev) => ({ ...prev, [key]: clampDockPx(startPx + sign * (cur - start)) }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSizes((prev) => {
        try {
          globalThis.localStorage?.setItem(SIZES_KEY, JSON.stringify(prev));
        } catch {
          // storage unavailable — keep the in-memory sizes
        }
        return prev;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // The children of a split: panes interleaved with resize gutters. Used for the root
  // split (rendered straight into .app-shell) and for nested .dock-split containers.
  function renderChildren(node: Extract<DockNode, { type: "split" }>, path: string): ReactNode[] {
    const axis: "x" | "y" = node.direction === "row" ? "x" : "y";

    // Resolve each child once: its size key, the WorkspaceNode (for leaves), whether it
    // can collapse, and its effective collapsed state (explicit toggle OR responsive).
    const meta = node.children.map((child, i) => {
      const key = childKey(child, `${path}/${i}`);
      const wsNode = child.node.type === "leaf" ? nodes.get(child.node.nodeId) : undefined;
      const kind = wsNode?.kind ?? "";
      const collapsible = !!wsNode && isCollapsibleLeaf(child, kind);
      const collapseKey = wsNode ? paneCollapseKey(layout.id, wsNode.id) : key;
      const isCollapsed = collapsible && isPaneCollapsed(kind, collapsed[collapseKey] ?? false, viewportWidth);
      return { child, key, wsNode, collapsible, collapseKey, isCollapsed };
    });

    const out: ReactNode[] = [];
    meta.forEach((m, i) => {
      const paneFlex = m.isCollapsed
        ? `0 0 ${RAIL_PX}px`
        : flexFor(m.child, pxFor(m.key, childInitialPx(m.child)));
      out.push(
        <div
          className="dock-pane"
          data-collapsed={m.isCollapsed ? "true" : undefined}
          key={`pane-${m.key}`}
          style={{ flex: paneFlex }}
        >
          {m.collapsible && m.isCollapsed ? (
            <button
              type="button"
              className="dock-rail"
              aria-label={`Expand ${paneLabel(m.wsNode!)}`}
              title={`Expand ${paneLabel(m.wsNode!)}`}
              onClick={() => toggleCollapsed(m.collapseKey, false)}
            >
            </button>
          ) : (
            <>
              {m.collapsible ? (
                <button
                  type="button"
                  className="dock-collapse-btn"
                  aria-label={`Collapse ${paneLabel(m.wsNode!)}`}
                  title={`Collapse ${paneLabel(m.wsNode!)}`}
                  onClick={() => toggleCollapsed(m.collapseKey, true)}
                >
                  ‹
                </button>
              ) : null}
              {renderDock(m.child.node, m.key)}
            </>
          )}
        </div>
      );

      if (i < meta.length - 1) {
        const target = gutterTarget(node.children, i);
        // No live resize at a collapsed boundary (a collapsed pane is a fixed rail).
        const boundaryCollapsed =
          m.isCollapsed || meta[i + 1].isCollapsed || (target ? meta[target.childIndex].isCollapsed : false);
        if (target && !boundaryCollapsed) {
          const tChild = node.children[target.childIndex];
          const tKey = childKey(tChild, `${path}/${target.childIndex}`);
          out.push(
            <div
              key={`gutter-${i}`}
              className={axis === "x" ? "dock-resize dock-resize-x" : "dock-resize dock-resize-y"}
              role="separator"
              aria-orientation={axis === "x" ? "vertical" : "horizontal"}
              onMouseDown={(e) => startDrag(e, tKey, target.sign, axis, childInitialPx(tChild))}
            />
          );
        } else {
          out.push(<div key={`gutter-${i}`} className={boundaryCollapsed ? "dock-gap dock-gap-collapsed" : "dock-gap"} />);
        }
      }
    });
    return out;
  }

  function renderDock(node: DockNode, path: string): ReactNode {
    if (node.type === "leaf") {
      const wsNode = nodes.get(node.nodeId);
      if (!wsNode) {
        return (
          <div className="workspace-node-missing" data-kind={node.nodeId}>
            Unknown node: {node.nodeId}
          </div>
        );
      }
      // The switchable left slot renders the IconRail-selected kind, not its static one,
      // so the panes that used to be always-on columns are reached here on demand.
      if (wsNode.id === LEFT_SLOT_NODE_ID && leftPaneKind !== wsNode.kind) {
        const swapped: WorkspaceNode = { ...wsNode, kind: leftPaneKind };
        return renderNode(swapped, ctx);
      }
      // The center slot swaps to the onboarding checklist while it is open (SHELL-2) —
      // the same kind-swap mechanism, so the checklist IS the initial center view on
      // a first run and the reader returns untouched on close.
      if (wsNode.id === CENTER_SLOT_NODE_ID && onboardingOpen) {
        const swapped: WorkspaceNode = { ...wsNode, kind: ONBOARDING_KIND };
        return renderNode(swapped, ctx);
      }
      return renderNode(wsNode, ctx);
    }
    return <div className={`dock-split dock-${node.direction}`}>{renderChildren(node, path)}</div>;
  }

  // R1 shell chrome: TopBar across the top, then a body row of IconRail (fixed strip) +
  // the resizable dock tree (.app-shell). The dock's root split IS the .app-shell flex
  // container (keeps the dock DOM flat); a degenerate single-leaf root is wrapped so
  // .app-shell always exists.
  const dock =
    root.type !== "split" ? (
      <div className="app-shell dock-row">{renderDock(root, "root")}</div>
    ) : (
      <div className={`app-shell dock-${root.direction}`}>{renderChildren(root, "root")}</div>
    );

  return (
    <div className="app-frame">
      <TopBar ctx={ctx} />
      <div className="app-body">
        <IconRail selected={leftPaneKind} onSelect={selectLeftPaneFromRail} />
        {dock}
      </div>
      {/* Global overlay (portaled to <body>): floats the anchor-scope action toolbar
          just below a live text selection in a reader. Mounted once here like the
          BookmarkIndex chrome — it reads only from useWorkspace and only triggers
          runAction (no new render path). */}
      <SelectionFloatingToolbar />
      {/* D5 floating card editor: a parked GeneratedDraft (kit action / operation /
          classify-reply / slash manual) renders here, floating NEXT TO the passage —
          the pane-bottom GenerationPreview stage is retired. Host chrome like the
          toolbar above; renders nothing while no draft is pending. */}
      <FloatingNoteEditor />
      {/* 标为概念 feedback (CONCEPT-UX-1): the brief toast + 撤销 after
          concept.mark-selection — host chrome like the floating toolbar above. */}
      <ConceptMarkToast />
      {/* D6 auto-materialize feedback (note-presentation-unified.md §6): "已生成笔记 · 撤销"
          after an anchor-context AI answer materializes a draft note — 撤销 dispatches
          note.delete. Host chrome like the toast above. */}
      <DraftNoteToast />
      {/* PRO-1 主动学习 nudge (proactive-learning.md §1): the pending-nudge the proactive
          tick raised — its reason + 去复习 deep-link + 稍后再说/关闭. Host chrome like the
          toast above; the tick + idle tracking are started by the effect below. */}
      <NudgeToast />
      {/* SPEECH-1b 朗读通用化: the host-level 朗读 chip for ANY text selection OUTSIDE
          the reader pane (chat replies, note lists, panels — 读=所有文本的可读能力).
          Reader selections keep their own toolbar above; this never double-serves. */}
      <GlobalSpeakSelection />
      {/* SEARCH-1 全局搜索: the Cmd/Ctrl+K palette (notes/文档/命令) — host chrome like
          the chips above. It owns its own global hotkey (registered once here via the
          single shell mount; no per-view wiring) and dispatches through the existing
          contracts only (focus.setAnchor / setActiveSourceId / navigateShell). */}
      <GlobalSearch />
      {/* N6/§D12: the Anchor Focus board overlay (renders nothing until the TopBar tab
          opens it) — a read-only anchors+notes surface reusing the §10 PreviewCard. */}
      <AnchorBoardMount />
      {modalKind ? (
        <div
          className="shell-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModalKind(null);
          }}
        >
          <section className="shell-modal-dialog" role="dialog" aria-modal="true" aria-label={modalTitle(modalKind)}>
            <header className="shell-modal-head">
              <span className="shell-modal-title">{modalTitle(modalKind)}</span>
              <button
                type="button"
                className="shell-modal-close"
                aria-label={t(modalMessages.close)}
                title={t(modalMessages.close)}
                ref={modalCloseRef}
                onClick={() => setModalKind(null)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="shell-modal-body">
              {renderNode({ id: "shell-modal", kind: modalKind }, ctx)}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
