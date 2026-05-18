# Browserctl Extension Design Document

## Goal

Control Chrome browser via Chrome extension without requiring `--remote-debugging-port` flag when starting Chrome.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Chrome Browser                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Browserctl Extension                    │ │
│  │                                                      │ │
│  │   background.js <──── WebSocket ────> browserctl  │ │
│  │                           service                   │ │
│  │       │                                              │ │
│  │       └── Browser control: DOM, navigation, screenshot, JS    │ │
│  │                                                      │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Components

### Chrome Extension
- **manifest.json** - Chrome extension manifest (Manifest V3)
- **background.js** - Extension background script, handles WebSocket communication
- **popup.html** - Extension popup UI
- **popup.js** - Popup logic

### browserctl Service
- Connects via WebSocket to receive and execute commands
- Manages browser lifecycle

## Control Flow

1. browserctl service starts WebSocket server
2. Chrome extension connects to the server
3. Extension receives JSON commands from service
4. Extension executes browser operations using Chrome APIs
5. Results are sent back via WebSocket

## WebSocket Protocol

### Service → Extension Commands

| Command | Parameters | Description |
|---------|-----------|-------------|
| `get_tabs` | - | Get tabs list |
| `navigate` | tabId, url | Navigate to URL |
| `evaluate` | tabId, expression | Execute JavaScript |
| `click` | tabId, selector | Click element |
| `fill` | tabId, selector, value | Fill input |
| `screenshot` | tabId, fullPage | Screenshot |
| `get_content` | tabId | Get page HTML |

### Extension → Service Response

```json
{
  "id": 123,
  "type": "response",
  "success": true,
  "result": ...
}
```

## Notes

1. **headless Chrome**: Extension WebSocket may not connect in headless mode
2. **Profile lock**: Cannot access profile if Chrome is already running
3. **One-time installation**: After installing to profile, extension persists across restarts