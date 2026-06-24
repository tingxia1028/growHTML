// PtySession — the seam between the AI layer and a real pseudo-terminal. The
// node-pty implementation (desktop/Node) and a deterministic fake (tests) both
// satisfy it, so the provider logic is testable without the native module.
export interface PtySession {
  write(data: string): void;
  onData(listener: (chunk: string) => void): void;
  kill(): void;
}

export type PtySessionFactory = () => PtySession | Promise<PtySession>;

// Deterministic in-memory session for tests: each written line is answered by
// the responder's chunks, emitted synchronously.
export class FakePtySession implements PtySession {
  private readonly listeners: ((chunk: string) => void)[] = [];
  killed = false;

  constructor(private readonly responder: (input: string) => string[]) {}

  write(data: string): void {
    for (const chunk of this.responder(data)) {
      for (const listener of this.listeners) listener(chunk);
    }
  }

  onData(listener: (chunk: string) => void): void {
    this.listeners.push(listener);
  }

  kill(): void {
    this.killed = true;
  }
}
