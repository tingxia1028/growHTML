import { Keyboard } from "lucide-react";
import { defineMessages, t } from "../i18n";
import { registerView } from "./viewRegistry";

const m = defineMessages({
  title: { zh: "快捷键", en: "Shortcuts" },
  commandSearch: { zh: "全库搜索 / 命令", en: "Vault search / commands" },
  close: { zh: "关闭弹窗 / 面板", en: "Close dialog / panel" },
  help: { zh: "打开快捷键帮助", en: "Open shortcuts help" },
  chatSend: { zh: "AI 对话发送，Shift+Enter 换行", en: "AI chat send, Shift+Enter inserts a line" }
});

const rows = [
  { key: "Ctrl / Cmd + K", label: m.commandSearch },
  { key: "Esc", label: m.close },
  { key: "?", label: m.help },
  { key: "Enter", label: m.chatSend }
] as const;

export function ShortcutHelp() {
  return (
    <section className="shortcut-help" aria-label={t(m.title)}>
      <div className="panel-title shortcut-help-title">
        <Keyboard size={16} />
        {t(m.title)}
      </div>
      <div className="shortcut-help-table">
        {rows.map((row) => (
          <div className="shortcut-help-row" key={row.key}>
            <kbd>{row.key}</kbd>
            <span>{t(row.label)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

registerView({ kind: "shortcut.help", render: () => <ShortcutHelp /> });
