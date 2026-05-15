# Chrome Use Extension

Chrome extension for browser automation using `chrome.debugger` API.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Chrome Browser                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Chrome Use Extension                    │ │
│  │                                                      │ │
│  │   background.js <──── WebSocket ────> Python      │ │
│  │                                                      │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Installation (One-time)

1. Open Chrome, go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select this folder (`extension/` directory)

## How It Works

### 1. Start WebSocket Server

The Python script starts a WebSocket server (default: `localhost:9224`).

### 2. Connect Extension in Chrome

1. Click the extension icon in Chrome toolbar
2. Click **Connect** button
3. Status turns green when connected

### 3. Python Code

```python
import sys
sys.path.insert(0, 'scripts')
import chrome_bridge as chrome

# Connect (extension must be connected in Chrome first)
chrome.connect()

# Get tabs
tabs = chrome.get_tabs()
print(tabs)

# Navigate
chrome.navigate('https://www.google.com')

# Execute JavaScript
title = chrome.evaluate('document.title')

# Click element
chrome.click('#submit-button')

# Fill form
chrome.fill('input[name="q"]', 'search query')

# Screenshot
img_base64 = chrome.screenshot()

# Get page HTML
html = chrome.get_html()

# Disconnect
chrome.disconnect()
```

## API Reference

| Function | Description |
|----------|-------------|
| `connect(host='localhost', port=9224)` | Connect to extension WebSocket server |
| `disconnect()` | Disconnect |
| `is_connected()` | Check connection status |
| `get_tabs()` | Get all tabs |
| `navigate(url, tab_id=None)` | Navigate to URL |
| `evaluate(script, tab_id=None)` | Execute JavaScript |
| `click(selector, tab_id=None)` | Click element |
| `fill(selector, value, tab_id=None)` | Fill input |
| `screenshot(full_page=False, tab_id=None)` | Screenshot |
| `get_html(tab_id=None)` | Get page HTML |
| `switch_tab(tab_id)` | Switch tab |

## How It Works

1. Python starts WebSocket server
2. Chrome extension connects to the server
3. Python sends JSON commands to server
4. Server forwards to connected extension
5. Extension executes browser operations

## Benefits

- **No special launch arguments**: Chrome starts normally
- **More stable**: Does not depend on CDP debugging port
- **Full permissions**: Extension has complete Chrome permissions
- **Cross-platform**: Windows, macOS, Linux supported
