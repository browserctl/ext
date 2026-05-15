# Chrome Use Extension Design Document

## Goal

Control Chrome browser via Chrome extension without requiring `--remote-debugging-port` flag when starting Chrome.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Chrome Browser                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Chrome Use Extension                    │ │
│  │                                                      │ │
│  │   background.js <──── WebSocket ────> Python      │ │
│  │       │                                              │ │
│  │       └── Browser control: DOM, navigation, screenshot, JS    │ │
│  │                                                      │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Control Methods

### 1. CDP (Chrome DevTools Protocol) - For Installation
- Used to **install extension to user Chrome profile one-time**
- Uses headless Chrome + `--load-extension` flag
- Does not require extension to be pre-installed

### 2. WebSocket (via Extension) - For Daily Use
- Python starts WebSocket server
- Chrome extension connects to server
- Extension executes browser operations (DOM, navigation, screenshot, etc.)

## File Structure

```
extension/
├── manifest.json          # Chrome extension manifest (Manifest V3)
├── background.js          # Extension background script, handles WebSocket communication
├── popup.html             # Extension popup UI
├── popup.js              # Popup logic
├── chrome_websocket_server.py  # Python WebSocket server
├── chrome_bridge.py      # Python client library (public API)
└── README.md             # Usage instructions
```

## Workflow

### One-time Installation Flow

1. Python: Start headless Chrome
   - Command: `google-chrome --headless=new --load-extension=/path/to/extension --user-data-dir=~/.config/google-chrome`
   - Purpose: Install extension to user's Chrome profile

2. Chrome: Extension is loaded into profile

3. Python: Verify installation, close headless Chrome

4. Done: Extension permanently installed to user's Chrome profile

### Daily Usage Flow (connect)

1. Python: Start WebSocket server (default port 9224)

2. Python: Start user's Chrome (normal startup, extension auto-loads)
   - Extension background.js auto-runs and connects to WebSocket server

3. Python: Send commands via API
   - `chrome.navigate(url)` → Extension receives → Browser executes
   - `chrome.click(selector)` → Extension receives → Browser executes
   - `chrome.screenshot()` → Extension receives → Browser executes
   - `chrome.evaluate(js)` → Extension receives → Browser executes

4. Extension: Returns results via WebSocket after execution

5. Python: Receives results, continues execution

## API Interface (chrome_bridge.py)

```python
import chrome_bridge as chrome

# Connect (extension must be installed first)
chrome.connect(host='localhost', port=9224)

# Basic operations
chrome.navigate(url)                    # Navigate to URL
chrome.get_tabs()                      # Get all tabs
chrome.switch_tab(tab_id)              # Switch tab

# DOM operations
chrome.click(selector)                 # Click element
chrome.fill(selector, value)           # Fill input
chrome.evaluate(script)                # Execute JavaScript

# Page content
chrome.get_html()                      # Get page HTML
chrome.screenshot(full_page=False)     # Screenshot (returns base64)

# Status
chrome.is_connected()                 # Check connection status
chrome.get_status()                   # Get detailed status
chrome.disconnect()                   # Disconnect
```

## WebSocket Protocol

### Python → Extension Commands

| Command | Parameters | Description |
|---------|-----------|-------------|
| `get_tabs` | - | Get tabs list |
| `navigate` | tabId, url | Navigate to URL |
| `evaluate` | tabId, expression | Execute JavaScript |
| `click` | tabId, selector | Click element |
| `fill` | tabId, selector, value | Fill input |
| `screenshot` | tabId, fullPage | Screenshot |
| `get_content` | tabId | Get page HTML |

### Extension → Python Response

```json
{
  "id": 123,
  "type": "tabs_list",
  "success": true,
  "tabs": [...]
}
```

## Notes

1. **headless Chrome limitation**: Extension WebSocket may not connect in headless mode
2. **Profile lock**: Cannot access profile if Chrome is already running
3. **One-time installation**: After extension is installed to profile, no need to reinstall for daily use

## TODO

1. [ ] Verify extension auto-connect in headless Chrome environment
2. [ ] Extension installation verification logic
3. [ ] Exception handling and reconnection mechanism

## Future Tasks

1. Complete headless Chrome extension installation flow
2. Implement extension WebSocket auto-reconnect
3. Add more DOM operation APIs (hover, scroll, select, etc.)
4. Implement cookies and localStorage read/write APIs
5. Add network request monitoring
6. Improve error handling and logging
