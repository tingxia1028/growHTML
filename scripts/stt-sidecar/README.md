# GrowNote 本地语音识别 sidecar（faster-whisper）

语音输入（麦克风 → 文字）的本地引擎：识别完全在你自己的电脑上进行，**不联网、不收费**。
它是一个独立的小服务；启动后，growNote 里的麦克风按钮会自动“点亮”（约 30 秒内检测到）。

## 三步启动

在本目录（`scripts/stt-sidecar/`）打开终端：

1. **创建并激活 Python 虚拟环境**（需要 Python 3.9+）

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1     # Windows PowerShell；macOS/Linux 用 source .venv/bin/activate
   ```

2. **安装依赖**

   ```powershell
   pip install -r requirements.txt
   ```

3. **启动服务**

   ```powershell
   python server.py
   ```

   看到 `model=... on http://127.0.0.1:8765` 即成功。保持这个窗口开着；关掉窗口即停止服务。

## 说明

- **模型首次使用会自动下载**（默认 `large-v3`，约 3GB，中文识别效果最好），之后离线可用。
- **GPU 可选**：装了匹配 CUDA 的 PyTorch 会自动用 GPU（float16）；没有 GPU 自动退回 CPU
  （int8，较慢但可用）。
- **机器较弱 / 不想下大模型**：用小模型启动（约 460MB，速度快、精度略降）：

  ```powershell
  $env:WHISPER_MODEL = "small"; python server.py
  ```

- **端口**：默认 `8765`，只监听本机（127.0.0.1）。改端口：`$env:STT_PORT = "9000"`，
  并给 growNote 服务端设置 `STUDY_VAULT_STT_URL=http://127.0.0.1:9000`。

## 接口（growNote 自动调用，无需手工使用）

- `GET /health` → `{"ok": true, "model": "large-v3"}`
- `POST /transcribe?language=zh`（body 为录音字节，或 multipart 文件）→
  `{"text": "识别出的文字", "language": "zh", "durationMs": 1234}`
