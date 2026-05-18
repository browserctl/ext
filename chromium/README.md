# Browserctl Extension

Chrome extension for browserctl that provides browser automation using Chrome's built-in APIs.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Chrome Browser                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Browserctl Extension                    │ │
│  │                                                      │ │
│  │   background.js <──── WebSocket ────> browserctl  │ │
│  │                           service                   │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Installation (One-time)

1. Open Chrome, go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select this folder (`chromium/` directory)

## How It Works

1. Start the browserctl service: `sudo systemctl start browserctl-svc`
2. Open Chrome (extension loads automatically)
3. Click the extension icon in Chrome toolbar
4. Click **Connect** button
5. Status turns green when connected

## Features

- **No special launch arguments**: Chrome starts normally
- **Full Chrome permissions**: Extension has complete browser access
- **WebSocket communication**: Connects to browserctl service for control
- **Cross-platform**: Works on Windows, macOS, and Linux

## Technical Details

The extension runs in Chrome's background and communicates with the browserctl service via WebSocket. It uses Chrome's `chrome.debugger` API and messaging system to perform browser operations.

## See Also

- [browserctl/svc](https://github.com/browserctl/svc) - Service documentation
- [browserctl/cli](https://github.com/browserctl/cli) - CLI documentation