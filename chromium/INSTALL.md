# Browserctl Extension - Installation Guide

## One-time Installation

**Browserctl extension only needs to be installed once** and will persist across Chrome restarts.

---

## Installation Steps

### 1. Open Extension Management

Navigate to: `chrome://extensions/`

### 2. Enable Developer Mode

Toggle **"Developer mode"** in the top right corner.

### 3. Load Extension

1. Click **"Load unpacked"** button (top left)
2. Select this directory: `browserctl/ext/chromium/`
3. The extension appears in the list as **"Browserctl"**

### 4. Verify Installation

- Extension icon appears in Chrome toolbar (top right)
- Click icon to open popup
- Status shows "Disconnected" until service starts

---

## Service Setup

After installing the extension, you need to start the browserctl service:

```bash
sudo systemctl start browserctl-svc
```

Check status:
```bash
curl http://localhost:9225/health
```

---

## Common Issues

### Extension disappears after Chrome restart?

**Possible causes:**

1. **Used `--load-extension` flag** - This loads extensions temporarily
   - Solution: Install via `chrome://extensions/` (see above)

2. **Invalid `key` field in manifest.json**
   - The key must be a valid RSA public key in Base64
   - If invalid, regenerate the key

3. **Extension directory was moved or deleted**

### Extension shows "Disabled" or "Corrupted"?

1. Go to `chrome://extensions/`
2. Remove the old extension
3. Click "Load unpacked" and select the directory again

### Service Worker doesn't connect?

1. Click the extension icon to open popup
2. This wakes up the Service Worker
3. It will automatically connect to the WebSocket service

---

## More Information

See [README.md](README.md) for usage instructions.