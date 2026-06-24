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
