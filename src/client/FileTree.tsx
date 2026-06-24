import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";

// Lazy, IDE-style file tree for an "Open Folder" root. Each directory fetches its
// own children the first time it's expanded, so opening a large folder is cheap.

type DirEntry = { name: string; path: string; isDir: boolean };

export function baseName(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function FileTree({
  root,
  onOpenFile,
  activePath
}: {
  root: string;
  onOpenFile: (path: string) => void;
  activePath?: string;
}) {
  return (
    <div className="file-tree">
      <DirNode path={root} name={baseName(root)} depth={0} defaultOpen onOpenFile={onOpenFile} activePath={activePath} />
    </div>
  );
}

function DirNode({
  path,
  name,
  depth,
  defaultOpen,
  onOpenFile,
  activePath
}: {
  path: string;
  name: string;
  depth: number;
  defaultOpen?: boolean;
  onOpenFile: (path: string) => void;
  activePath?: string;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Fetch children the first time this dir is expanded. Deps are intentionally
    // only [open, path]: including `loading`/`entries` would re-run the effect when
    // they change and fire the cleanup below — cancelling the very fetch it started.
    if (!open || entries) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/fs/list?path=${encodeURIComponent(path)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Failed to list folder");
        return body as { entries: DirEntry[] };
      })
      .then((body) => {
        if (!cancelled) setEntries(body.entries);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to list folder");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, path]);

  const indent = (level: number) => ({ paddingLeft: level * 12 + 8 });

  return (
    <div>
      <button className="tree-row" type="button" style={indent(depth)} onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {open ? <FolderOpen size={14} /> : <Folder size={14} />}
        <span className="tree-label">{name}</span>
      </button>
      {open ? (
        <div>
          {loading ? <div className="tree-hint" style={indent(depth + 1)}>Loading…</div> : null}
          {error ? <div className="tree-hint tree-error" style={indent(depth + 1)}>{error}</div> : null}
          {entries?.map((entry) =>
            entry.isDir ? (
              <DirNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                depth={depth + 1}
                onOpenFile={onOpenFile}
                activePath={activePath}
              />
            ) : (
              <button
                key={entry.path}
                className={`tree-row tree-file${entry.path === activePath ? " active" : ""}`}
                type="button"
                style={indent(depth + 1)}
                onClick={() => onOpenFile(entry.path)}
                title={entry.path}
              >
                <File size={14} />
                <span className="tree-label">{entry.name}</span>
              </button>
            )
          )}
          {entries && entries.length === 0 ? <div className="tree-hint" style={indent(depth + 1)}>Empty folder</div> : null}
        </div>
      ) : null}
    </div>
  );
}
