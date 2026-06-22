export type SourceLink = {
  title: string;
  url: string;
};

export type AiProvider = "claude" | "codex";

export type PageShell = {
  title: string;
  htmlAttrs: Record<string, string>;
  bodyAttrs: Record<string, string>;
  headHtml: string;
};

export type SelectionPayload = {
  componentId: string | null;
  aiId: string | null;
  label: string;
  tagName: string;
  selectedHtml: string;
};

export type AiProposal = {
  summary: string;
  replacementHtml: string;
  sources: SourceLink[];
  confidence: "low" | "medium" | "high";
};

export type ThreadEntry = {
  id: string;
  createdAt: string;
  provider: AiProvider;
  selectionLabel: string;
  instruction: string;
  summary: string;
  sources: SourceLink[];
  selection?: SelectionPayload;
  proposal?: AiProposal;
};

export type FolderPagePayload = {
  path: string;
  title: string;
  html: string;
  css: string;
  shell: PageShell;
};

export type FolderCachePayload = {
  selectedPath: string;
  pages: FolderPagePayload[];
};

export type DocumentPayload = {
  documentId: string;
  title: string;
  html: string;
  css: string;
  shell: PageShell;
  projectData: unknown | null;
  threadId: string | null;
  threads: Record<AiProvider, string | null>;
  history: ThreadEntry[];
  folderCache: FolderCachePayload | null;
};

export type AiProposalRequest = {
  provider: AiProvider;
  instruction: string;
  selection: SelectionPayload;
  document: {
    html: string;
    css: string;
  };
};

export type AiProposalResponse = {
  provider: AiProvider;
  sessionId: string | null;
  threads: Record<AiProvider, string | null>;
  proposal: AiProposal;
  history: ThreadEntry[];
};

export type SaveDocumentRequest = {
  html: string;
  css: string;
  shell: PageShell;
  projectData: unknown;
  folderCache?: FolderCachePayload | null;
};

export type GenerateDocumentRequest = {
  provider: AiProvider;
  instruction: string;
};

export type GenerateDocumentResponse = {
  title: string;
  html: string;
  css: string;
  summary: string;
};

export type ImportExternalRequest = {
  url: string;
};

export type ImportExternalResponse = {
  title: string;
  html: string;
  css: string;
  summary: string;
  sourceUrl: string;
  kind: "webpage" | "pdf" | "file";
};
