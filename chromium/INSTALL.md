# Chrome Use Extension - 安装指南

## ⚠️ 重要：一次性安装

**Chrome Use 扩展只需要安装一次**，之后会在 Chrome 重启后自动保留。

---

## 📦 安装步骤

### 1. 打开扩展管理页面

在 Chrome 地址栏输入：
```
chrome://extensions/
```

### 2. 启用开发者模式

点击右上角的 **"开发者模式"** 开关（切换到 ON 状态）。

### 3. 加载扩展

1. 点击左上角的 **"加载已解压的扩展程序"** 按钮
2. 选择扩展目录：
   ```
   /home/dave/workspace/skills/chrome-use/extension
   ```
3. 扩展会出现在列表中，状态为 **"已启用"**

### 4. 验证安装

- 扩展图标应该出现在 Chrome 工具栏右上角
- 点击图标会显示 popup 界面
- 状态应显示 "Disconnected"（这是正常的，服务还没启动）

---

## 🚀 启动服务

安装扩展后，启动 chrome-use 服务：

```bash
sudo systemctl start chrome-use.service
```

检查服务状态：

```bash
sudo systemctl status chrome-use.service
```

检查健康状态：

```bash
curl http://localhost:9225/health
```

应该返回：
```json
{
  "status": "ok",
  "chrome": {
    "connected": true
  }
}
```

---

## ✅ 验证扩展持久化

**测试 Chrome 重启后扩展是否保留：**

1. 完全关闭 Chrome：
   ```bash
   pkill chrome
   ```

2. 重新启动 Chrome：
   ```bash
   google-chrome
   ```

3. 检查扩展是否还在：
   - 打开 `chrome://extensions/`
   - "Chrome Use" 扩展应该仍然存在
   - 状态为 "已启用"

---

## 🔧 常见问题

### Q: 扩展在 Chrome 重启后消失了？

**A:** 可能的原因：

1. **使用了 `--load-extension` 参数启动 Chrome**
   - 这个参数加载的扩展是临时的，重启后会消失
   - 解决方案：通过 `chrome://extensions/` 手动安装（见上方步骤）

2. **`manifest.json` 的 `key` 字段无效**
   - 检查 key 是否是有效的 RSA 公钥 Base64 编码
   - 验证命令：
     ```bash
     echo "<key 值>" | base64 -d | openssl rsa -pubin -inform DER -text -noout
     ```
   - 如果报错，需要重新生成 key

3. **扩展目录被移动或删除**
   - 确保 `/home/dave/workspace/skills/chrome-use/extension` 目录存在
   - 不要移动扩展目录

### Q: 扩展显示"已禁用"或"损坏"？

**A:** 重新安装：

1. 在 `chrome://extensions/` 移除旧扩展
2. 点击 "加载已解压的扩展程序"
3. 重新选择扩展目录

### Q: Service Worker 不连接？

**A:** 手动激活：

1. 点击扩展图标打开 popup
2. 这会唤醒 Service Worker
3. Service Worker 会自动连接 WebSocket 服务

---

## 📝 技术说明

### 为什么需要手动安装？

Chrome 扩展有两种加载方式：

| 方式 | 命令 | 持久化 | 用途 |
|------|------|--------|------|
| 临时加载 | `--load-extension=/path` | ❌ 否 | 开发测试 |
| 手动安装 | `chrome://extensions/` | ✅ 是 | 生产使用 |

**chrome-use 使用手动安装方式**，因为：
- ✅ 扩展在 Chrome 重启后保留
- ✅ 不需要每次启动都传递参数
- ✅ 符合 Chrome 扩展安全规范

### 扩展存储位置

安装后，扩展存储在：
```
~/.config/google-chrome/Default/Extensions/<extension_id>/
```

其中 `<extension_id>` 是由 `manifest.json` 的 `key` 字段计算得出的。

---

## 📞 需要帮助？

查看完整文档：
- `README.md` - 使用指南
- `DESIGN.md` - 架构设计

或检查日志：
```bash
journalctl -u chrome-use.service -f
```
