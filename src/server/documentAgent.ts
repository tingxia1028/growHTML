import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AiProvider,
  GenerateDocumentRequest,
  GenerateDocumentResponse
} from "../shared/types";
import { getDocumentWorkspace } from "./storage";

const documentSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    html: {
      type: "string",
      description: "Body HTML only. Do not include html/head/body tags."
    },
    css: {
      type: "string",
      description: "CSS for the generated body HTML."
    },
    summary: { type: "string" }
  },
  required: ["title", "html", "css", "summary"],
  additionalProperties: false
} as const;

function buildDocumentPrompt(instruction: string) {
  return `你是 GrowHTML 的 HTML 学习资料生成 agent。

请根据用户描述生成一份可以直接放进 GrapesJS 编辑、也能作为学习资料阅读的 HTML 页面。

硬性规则：
1. 返回结构化 JSON。
2. html 字段只包含 body 内部片段，不要包含 html/head/body 标签。
3. css 字段包含页面所需 CSS。
4. 不要内联 script。
5. 页面应像学习资料，不要营销落地页。
6. 默认中文。
7. 用清晰章节、卡片、表格或示意区域组织内容。
8. 给主要 section/article 添加语义化 data-ai-id，便于后续选区编辑。
9. CSS 要让页面一打开就有完整视觉风格，不依赖外部资源。

用户描述：
${instruction}`;
}

function resolveCodexExecutable() {
  if (process.env.CODEX_EXECUTABLE) return process.env.CODEX_EXECUTABLE;
  const command = process.platform === "win32" ? "where" : "which";
  try {
    const output = execFileSync(command, ["codex"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.split(/\r?\n/).find(Boolean) ?? "codex";
  } catch {
    return "codex";
  }
}

function getCodexServiceTier() {
  return process.env.GROWHTML_CODEX_SERVICE_TIER === "flex" ? "flex" : "fast";
}

function resolveClaudeExecutable() {
  if (process.env.CLAUDE_CODE_EXECUTABLE) return process.env.CLAUDE_CODE_EXECUTABLE;
  const command = process.platform === "win32" ? "where" : "which";
  try {
    const output = execFileSync(command, ["claude"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.split(/\r?\n/).find(Boolean);
  } catch {
    return undefined;
  }
}

function parseGeneratedDocument(text: string): GenerateDocumentResponse {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace >= firstBrace ? raw.slice(firstBrace, lastBrace + 1) : raw;
  const parsed = JSON.parse(jsonText) as Partial<GenerateDocumentResponse>;

  if (
    typeof parsed.title !== "string" ||
    typeof parsed.html !== "string" ||
    typeof parsed.css !== "string" ||
    typeof parsed.summary !== "string"
  ) {
    throw new Error("Agent returned JSON, but it did not match the generated document shape.");
  }

  return {
    title: parsed.title,
    html: parsed.html,
    css: parsed.css,
    summary: parsed.summary
  };
}

async function generateWithClaude(prompt: string): Promise<GenerateDocumentResponse> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const options: Record<string, unknown> = {
    cwd: getDocumentWorkspace(),
    maxTurns: 6,
    allowedTools: ["WebSearch", "WebFetch"],
    disallowedTools: ["Bash", "Edit", "Write", "NotebookEdit"],
    outputFormat: {
      type: "json_schema",
      schema: documentSchema
    },
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: "Generate scoped HTML learning documents for GrowHTML. Never modify files directly."
    },
    title: "GrowHTML document generation"
  };

  const pathToClaudeCodeExecutable = resolveClaudeExecutable();
  if (pathToClaudeCodeExecutable) {
    options.pathToClaudeCodeExecutable = pathToClaudeCodeExecutable;
  }

  for await (const message of query({ prompt, options })) {
    const msg = message as Record<string, unknown>;
    if (msg.type === "result") {
      if (msg.subtype !== "success") {
        throw new Error(typeof msg.result === "string" ? msg.result : `Claude ended with ${String(msg.subtype)}`);
      }
      if (msg.structured_output) {
        return msg.structured_output as GenerateDocumentResponse;
      }
    }
  }

  throw new Error("Claude did not return a generated document.");
}

async function generateWithCodex(prompt: string): Promise<GenerateDocumentResponse> {
  const tempDir = path.join(os.tmpdir(), "growhtml-codex");
  await mkdir(tempDir, { recursive: true });

  const runId = randomUUID();
  const schemaPath = path.join(tempDir, `${runId}.generate.schema.json`);
  const outputPath = path.join(tempDir, `${runId}.generate.json`);
  await writeFile(schemaPath, JSON.stringify(documentSchema, null, 2), "utf8");

  const child = spawn(
    resolveCodexExecutable(),
    [
      "-c",
      `service_tier="${getCodexServiceTier()}"`,
      "--search",
      "--sandbox",
      "read-only",
      "exec",
      "--skip-git-repo-check",
      "--json",
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      "-"
    ],
    {
      cwd: getDocumentWorkspace(),
      env: process.env,
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"]
    }
  );

  let stdout = "";
  let stderr = "";
  const timeout = setTimeout(() => child.kill(), 10 * 60 * 1000);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.write(prompt);
  child.stdin.end();

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  clearTimeout(timeout);

  try {
    if (exitCode !== 0) {
      throw new Error(stderr || stdout || `codex exited with code ${exitCode}`);
    }
    return parseGeneratedDocument(await readFile(outputPath, "utf8"));
  } finally {
    await rm(schemaPath, { force: true });
    await rm(outputPath, { force: true });
  }
}

export async function generateDocument(request: GenerateDocumentRequest) {
  const prompt = buildDocumentPrompt(request.instruction);
  return request.provider === "codex" ? generateWithCodex(prompt) : generateWithClaude(prompt);
}
