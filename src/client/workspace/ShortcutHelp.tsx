import { Keyboard } from "lucide-react";
import { defineMessages, t } from "../i18n";
import { registerView } from "./viewRegistry";

const m = defineMessages({
  title: { zh: "快捷键", en: "Shortcuts" },
  commandSearch: { zh: "全库搜索 / 命令", en: "Vault search / commands" },
  close: { zh: "关闭弹窗 / 面板", en: "Close dialog / panel" },
  help: { zh: "打开快捷键帮助", en: "Open shortcuts help" },
  read: { zh: "朗读当前文本按钮", en: "Speak current text button" },
  pinyin: { zh: "选中文本后的拼音按钮", en: "Pinyin button after selecting text" },
  note: { zh: "Enter 发送，Shift+Enter 换行", en: "Enter sends, Shift+Enter inserts a line" }
});

const rows = [
  { key: "Ctrl / Cmd + K", label: m.commandSearch },
  { key: "Esc", label: m.close },
  { key: "?", label: m.help },
  { key: "朗读 / Speak", label: m.read },
  { key: "拼 / Pinyin", label: m.pinyin },
  { key: "Enter", label: m.note }
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
