const NOISY_CODEX_WARNING_PATTERNS = [
  "WARN codex_core_plugins::manifest: ignoring interface.defaultPrompt",
  "WARN codex_core::shell_snapshot: failed to create shell snapshot",
  "WARN codex_core_skills::loader: ignoring interface.icon_small",
  "WARN codex_core_skills::loader: ignoring interface.icon_large"
];

export function cleanCodexStderr(stderr: string) {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const lowerLine = line.toLowerCase();
      return !NOISY_CODEX_WARNING_PATTERNS.some((pattern) => lowerLine.includes(pattern.toLowerCase()));
    })
    .join("\n")
    .trim();
}

export function formatCodexFailure(input: { stderr: string; stdout: string; exitCode: number | null }) {
  const stderr = cleanCodexStderr(input.stderr);
  return stderr || input.stdout.trim() || `codex exited with code ${input.exitCode}`;
}
