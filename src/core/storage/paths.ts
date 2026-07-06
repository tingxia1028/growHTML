// Pure, OS-independent containment guard for stored relative paths. Replaces the
// Node `path.sep`/prefix check so it works the same on any StorageAdapter backend
// (Node, mobile virtual fs). Source paths are always stored relative + posix
// (e.g. "sources/foo.html"); anything absolute or containing a ".." segment is
// rejected as a traversal attempt.
export function assertSafeRelativePath(relativePath: string): void {
  const isAbsolute = relativePath === "" || /^([a-zA-Z]:)?[\\/]/.test(relativePath);
  const hasDotDot = relativePath.split(/[\\/]+/).some((segment) => segment === "..");
  if (isAbsolute || hasDotDot) {
    throw new Error(`Unsafe source path: ${relativePath}`);
  }
}

/**
 * Compose a LOGICAL vault path (PLAT-LAYER Part-4b): the portable core joins a root/dir with
 * known short segments as a POSIX `/`-string and hands it to the StorageAdapter, which treats
 * paths as opaque keys (the adapter maps logical→physical). Pure — NO `node:path`, so it behaves
 * identically on any backend (Node, mobile virtual fs). Empty/undefined segments are dropped and
 * INTERNAL `//` runs collapse to a single `/`, but a LEADING separator is preserved (so
 * `joinPath("/study", ".study")` → `"/study/.study"`, `joinPath("/", ".study")` → `"/.study"`).
 * A Windows-drive root like `C:\x\vault` is NOT mangled — its backslashes ride through untouched
 * (`joinPath("C:\\x\\vault", ".study")` → `"C:\\x\\vault/.study"`); Node's fs accepts the mixed
 * separators and normalizes them.
 */
export function joinPath(...segments: Array<string | undefined>): string {
  const joined = segments
    .filter((segment): segment is string => segment !== undefined && segment !== "")
    .join("/");
  // Collapse INTERNAL `//` runs to a single `/`, but keep a leading `/` (or a leading `//`
  // collapsing to `/`). Splitting on a leading-anchored regex is fiddly; instead re-collapse
  // every `//` and then restore a single leading slash if the original had one.
  const hadLeadingSlash = joined.startsWith("/");
  const collapsed = joined.replace(/\/+/g, "/");
  return hadLeadingSlash && !collapsed.startsWith("/") ? `/${collapsed}` : collapsed;
}

/**
 * The last path segment (PLAT-LAYER Part-4b) — splits on the same `[\\/]+` separator class as
 * {@link assertSafeRelativePath} so it works on both POSIX logical paths and an EXTERNAL Windows
 * OS path (`C:\Users\me\photo.jpg` → `photo.jpg`). Trailing separators are ignored.
 */
export function basename(p: string): string {
  const segments = p.split(/[\\/]+/).filter((segment) => segment !== "");
  return segments.length === 0 ? "" : segments[segments.length - 1];
}

/**
 * The `.`-suffix of a path's {@link basename} (PLAT-LAYER Part-4b), matching `node:path.extname`
 * semantics: the extension INCLUDES the leading dot (`photo.jpg` → `.jpg`), a name with no dot →
 * `""`, and a leading-dot-only name (`.env`) → `""` (the dot is not an extension separator there).
 */
export function extname(p: string): string {
  const name = basename(p);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}
