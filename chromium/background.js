// Browserctl - Background Script
// Uses chrome.debugger API to control Chrome browser
// Communication: Chrome Extension ↔ WebSocket ↔ Node.js

let ws = null;
let reconnectTimer = null;
let messageId = 0;
let debuggerSessions = new Map(); // tabId -> debugger session info
let attachLocks = new Map(); // tabId -> Promise (pending attach)

// Default connection settings
let serverHost = 'localhost';
let serverPort = 9222;

const DEBUGGER_VERSION = '1.3';
const DEFAULT_PORT = 9222;
const EXTENSION_PATH = '/extension';

// Attach debugger to a tab (with concurrency control)
async function attachToTab(tabId) {
  // If already attached, return immediately
  if (debuggerSessions.has(tabId)) {
    console.log(`[Browserctl] Already attached to tab ${tabId}`);
    return true;
  }
  
  // If attach is in progress, wait for it
  if (attachLocks.has(tabId)) {
    console.log(`[Browserctl] Waiting for pending attach on tab ${tabId}`);
    return attachLocks.get(tabId);
  }
  
  console.log(`[Browserctl] Attempting to attach to tab ${tabId}...`);
  
  // Create attach promise
  const attachPromise = (async () => {
    try {
      await doAttach(tabId);
      return true;
    } finally {
      attachLocks.delete(tabId);
    }
  })();
  
  attachLocks.set(tabId, attachPromise);
  return attachPromise;
}

// Do the actual attach (aggressive detach-first, retry multiple times)
async function doAttach(tabId) {
  const maxRetries = 3;
  const retryDelay = 500; // 0.5 second
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await tryAttachOnce(tabId, attempt);
      return true; // Success
    } catch (err) {
      console.log(`[Browserctl] Attach attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt === maxRetries) {
        // Last attempt - throw with helpful message
        const helpfulError = new Error(`Failed to attach debugger after ${maxRetries} attempts. Another extension or DevTools may be using this tab. Try closing DevTools or disabling debugger extensions. Original error: ${err.message}`);
        throw helpfulError;
      }
      // Wait before retry
      await new Promise(r => setTimeout(r, retryDelay));
    }
  }
  return false; // Should not reach here
}

// Single attach attempt with graceful detach-first
// Single attach attempt with graceful detach-first
async function tryAttachOnce(tabId, attemptNum) {
  return new Promise((resolve, reject) => {
    console.log(`[Browserctl] Attempt ${attemptNum}: Detaching tab ${tabId} (if attached)...`);

    chrome.debugger.detach({tabId}, () => {
      setTimeout(() => {
        console.log(`[Browserctl] Attempt ${attemptNum}: Attaching tab ${tabId}...`);

        chrome.debugger.attach({tabId}, DEBUGGER_VERSION, () => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            if (errorMsg.includes('already attached') || errorMsg.includes('cannot attach')) {
              reject(new Error(errorMsg));
              return;
            }
            reject(new Error(errorMsg));
            return;
          }
          debuggerSessions.set(tabId, { attached: true, attempt: attemptNum });
          console.log(`[Browserctl] Attempt ${attemptNum}: Successfully attached to tab ${tabId}`);
          
          if (!cdpEventListeners.has(tabId)) {
            cdpEventListeners.set(tabId, new Set());
          }
          
          chrome.debugger.sendCommand({tabId}, "Network.enable", {}, (result, err) => {
            if (err) {
              console.error("[Browserctl] Network.enable error:", err);
            } else {
              console.log("[Browserctl] Network domain enabled for tab", tabId);
            }
          });
          
          resolve(true);
        });
      }, 500);
    });
  });
}

// Detach debugger from a tab
async function detachFromTab(tabId) {
  return new Promise((resolve) => {
    if (!debuggerSessions.has(tabId)) {
      resolve(true);
      return;
    }

    chrome.debugger.detach({tabId}, () => {
      debuggerSessions.delete(tabId);
      resolve(true);
    });
  });
}

// Send command to debugger
async function debuggerCommand(tabId, method, params = {}) {
  await attachToTab(tabId);

  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({tabId}, method, params, (result, error) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (error) {
        reject(new Error(error.message || JSON.stringify(error)));
        return;
      }
      resolve(result);
    });
  });
}

// Connect to Python WebSocket server
function connect(host, port) {
  serverHost = host || 'localhost';
  serverPort = port || DEFAULT_PORT;

  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('[Browserctl] Closing existing WS connection before reconnect');
    ws.close();
  }

  const url = `ws://${serverHost}:${serverPort}${EXTENSION_PATH}`;

console.log(`[Browserctl] Connecting to ${url} (host=${serverHost}, port=${serverPort})`);
  statusUpdate(`Connecting to ${url}...`);

  try {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("[Browserctl] Connected");
      statusUpdate("Connected");
      
      // MV3 Service Worker: getCurrent() may return undefined
      // Use getAll() to get all windows and register each
      chrome.windows.getAll({ windowTypes: ['normal'] }, (windows) => {
        if (windows && windows.length > 0) {
          // Register all normal browser windows
          for (const win of windows) {
            console.log(`[Browserctl] Registering window: ${win.id}`);
            send({ type: "register", role: "extension", api: "debugger", windowId: win.id });
          }
        } else {
          // Fallback: use last focused window
          chrome.windows.getLastFocused((win) => {
            if (win) {
              console.log(`[Browserctl] Registering last focused window: ${win.id}`);
              send({ type: "register", role: "extension", api: "debugger", windowId: win.id });
            }
          });
        }
      });

      setTimeout(() => {
        sendTabsList().catch(e => console.error("Failed to send tabs:", e));
      }, 1000);
      
      // Enable console capture for all tabs after connection
      setTimeout(() => {
        enableConsoleCaptureForAllTabs();
      }, 2000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error('[Browserctl] Failed to parse message:', e);
      }
    };

    ws.onclose = () => {
      console.log('[Browserctl] Disconnected');
      statusUpdate('Disconnected');
      scheduleReconnect();
    };

    ws.onerror = (error) => {
      console.error('[Browserctl] WebSocket error:', error);
      statusUpdate('Error');
    };
  } catch (e) {
    console.error('[Browserctl] Failed to connect:', e);
    statusUpdate('Failed to connect');
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  // Don't reconnect if already connected
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    // Double-check before reconnecting
    if (ws && ws.readyState === WebSocket.OPEN) {
      return;
    }
    console.log('[Browserctl] Attempting to reconnect (keeping debugger sessions intact)...');
    statusUpdate('Reconnecting...');
    // NOTE: intentionally do NOT call cleanupAndConnect() here.
    // Detaching all tabs on every WS reconnect would break active CDP sessions.
    // The extension will re-register and re-sync tabs automatically.
    connect(serverHost, serverPort);
  }, 3000);
}

// Send message to Python
function send(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[Browserctl] Not connected, message dropped:', message.type);
    // Return resolved promise to avoid unhandled rejection errors
    // Caller should handle the case where message may not be delivered
    return Promise.resolve();
  }

  // Only assign id if not already present (preserve id from incoming requests)
  if (!('id' in message)) {
    message.id = ++messageId;
  }

  ws.send(JSON.stringify(message));
  return Promise.resolve();
}

// Handle incoming messages from Python
function handleMessage(msg) {
  console.log('[Browserctl] Received:', msg.type, msg);

  // Handle commands from Python
  switch (msg.type) {
    case 'ping':
      send({ type: 'pong' });
      break;

    case 'get_tabs':
      handleGetTabs(msg);
      break;

    case 'navigate':
      handleNavigate(msg);
      break;

    case 'evaluate':
      handleEvaluate(msg);
      break;

    case 'get_content':
      handleGetContent(msg);
      break;

    case 'click':
      handleClick(msg);
      break;

    case 'fill':
      handleFill(msg);
      break;

    case 'screenshot':
      handleScreenshot(msg);
      break;

    case 'switch_tab':
      handleSwitchTab(msg);
      break;

    case 'close_tab':
      handleCloseTab(msg);
      break;

    case 'new_tab':
      handleNewTab(msg);
      break;

    // Generic CDP command - forwards any CDP method to chrome.debugger
    case 'cdp_command':
      handleCdpCommand(msg);
      break;

    // CDP session management
    case 'tab_attach':
      handleTabAttach(msg);
      break;

    case 'tab_detach':
      handleTabDetach(msg);
      break;

    // CDP event subscriptions
    case 'cdp_subscribe':
      handleCdpSubscribe(msg);
      break;

    case 'cdp_unsubscribe':
      handleCdpUnsubscribe(msg);
      break;

    default:
      console.warn('[Browserctl] Unknown message type:', msg.type);
  }
}

// Get list of tabs
async function handleGetTabs(msg) {
  try {
    const tabs = await chrome.tabs.query({});

    const tabInfo = tabs
      .filter(tab => {
        const url = tab.url || '';
        return url.startsWith('http://') || url.startsWith('https://');
      })
      .map(tab => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        active: tab.active,
        windowId: tab.windowId
      }));

    send({
      type: 'tabs_list',
      id: msg.id,
      success: true,
      tabs: tabInfo
    });
  } catch (error) {
    send({
      type: 'tabs_list',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

// Navigate to URL using Page.navigate
async function handleNavigate(msg) {
  const { tabId, url } = msg;

  try {
    await debuggerCommand(tabId, 'Page.navigate', { url });
    send({
      type: 'navigate_result',
      id: msg.id,
      success: true
    });
  } catch (error) {
    send({
      type: 'navigate_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

// Evaluate JavaScript using Runtime.evaluate
async function handleEvaluate(msg) {
  const { tabId, expression } = msg;

  try {
    const result = await debuggerCommand(tabId, 'Runtime.evaluate', {
      expression: expression,
      returnByValue: true
    });

    send({
      type: 'evaluate_result',
      id: msg.id,
      success: true,
      result: result.result ? result.result.value : undefined
    });
  } catch (error) {
    send({
      type: 'evaluate_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

// Get page content
async function handleGetContent(msg) {
  const { tabId } = msg;

  try {
    const result = await debuggerCommand(tabId, 'Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML',
      returnByValue: true
    });

    send({
      type: 'content_result',
      id: msg.id,
      success: true,
      content: result.result ? result.result.value : ''
    });
  } catch (error) {
    send({
      type: 'content_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

// Click element
async function handleClick(msg) {
  const { tabId, selector } = msg;

  try {
    // First find the element
    const result = await debuggerCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (function() {
          const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
          if (!el) return { success: false, error: 'Element not found' };
          el.click();
          return { success: true };
        })()
      `,
      returnByValue: true
    });

    send({
      type: 'click_result',
      id: msg.id,
      ...(result.result ? result.result.value : { success: false, error: 'No result' })
    });
  } catch (error) {
    send({
      type: 'click_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

// Fill input
async function handleFill(msg) {
  const { tabId, selector, value } = msg;

  try {
    const result = await debuggerCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (function() {
          const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
          if (!el) return { success: false, error: 'Element not found' };
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true };
        })()
      `,
      returnByValue: true
    });

    send({
      type: 'fill_result',
      id: msg.id,
      ...(result.result ? result.result.value : { success: false, error: 'No result' })
    });
  } catch (error) {
    send({
      type: 'fill_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

// Take screenshot
async function handleScreenshot(msg) {
  const { tabId, fullPage } = msg;

  try {
    // Enable Page domain first
    await debuggerCommand(tabId, 'Page.enable');

    const result = await debuggerCommand(tabId, 'Page.captureScreenshot', {
      format: 'png',
      quality: 100,
      fromSurface: !fullPage
    });

    send({
      type: 'screenshot_result',
      id: msg.id,
      success: true,
      data: result.data,
      fullPage: fullPage || false
    });
  } catch (error) {
    send({
      type: 'screenshot_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

// Switch to a different tab
async function handleSwitchTab(msg) {
  const { tabId } = msg;

  try {
    await chrome.tabs.update(tabId, { active: true });
    send({
      type: 'switch_tab_result',
      id: msg.id,
      success: true
    });
  } catch (error) {
    send({
      type: 'switch_tab_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

// Close a tab
async function handleCloseTab(msg) {
  const { tabId } = msg;

  try {
    await chrome.tabs.remove(tabId);
    send({
      type: 'close_tab_result',
      id: msg.id,
      success: true
    });
  } catch (error) {
    send({
      type: 'close_tab_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

// Create new tab
async function handleNewTab(msg) {
  const { url, active } = msg;

  try {
    const tab = await chrome.tabs.create({ url: url || 'about:blank', active: active !== false });
    send({
      type: 'new_tab_result',
      id: msg.id,
      success: true,
      tab: {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        windowId: tab.windowId
      }
    });
  } catch (error) {
    send({
      type: 'new_tab_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

// Update extension toolbar badge based on connection state
function statusUpdate(text) {
  // Update toolbar icon based on connection state
  setTimeout(() => {
    try {
      const isConnected = text === 'Connected';
      chrome.action.setIcon({
        path: {
          '48': isConnected ? 'icon-48.png' : 'icon-offline-48.png',
          '96': isConnected ? 'icon-96.png' : 'icon-offline-96.png'
        }
      });
    } catch (e) {
      console.error('[Browserctl] setIcon failed:', e.message || e);
    }
  }, 100);

  // Notify popup if open
  chrome.runtime.sendMessage({ type: 'status', text }).catch(() => {});
}

// ============================================================
// Generic CDP Command Handler (enables full CDP compatibility)
// ============================================================

let cdpEventListeners = new Map(); // tabId -> Set of event names

async function handleCdpCommand(msg) {
  const { tabId, method, params = {} } = msg;

  try {
    // Special handling for Page.addScriptToEvaluateOnNewDocument
    if (method === 'Page.addScriptToEvaluateOnNewDocument') {
      // Use chrome.scripting.registerContentScript for persistent injection
      const scriptId = 'browserctl-inject-' + Date.now();
      await chrome.scripting.registerContentScripts([{
        id: scriptId,
        allFrames: true,
        runAt: 'document_start',
        js: [params.source]
      }]);
      
      send({
        type: 'cdp_result',
        id: msg.id,
        success: true,
        method,
        result: { identifier: scriptId }
      });
      return;
    }
    
    // For other commands, need tabId
    if (!tabId) {
      throw new Error('tabId required for ' + method);
    }
    
    const result = await debuggerCommand(tabId, method, params);
    send({
      type: 'cdp_result',
      id: msg.id,
      success: true,
      method,
      result
    });
  } catch (error) {
    send({
      type: 'cdp_result',
      id: msg.id,
      success: false,
      method,
      error: error.message
    });
  }
}

// ============================================================
// CDP Session Management
// ============================================================

async function handleTabAttach(msg) {
  const { tabId } = msg;

  try {
    await attachToTab(tabId);
    send({
      type: 'tab_attach_result',
      id: msg.id,
      success: true,
      tabId
    });
  } catch (error) {
    send({
      type: 'tab_attach_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

async function handleTabDetach(msg) {
  const { tabId } = msg;

  try {
    await detachFromTab(tabId);
    send({
      type: 'tab_detach_result',
      id: msg.id,
      success: true,
      tabId
    });
  } catch (error) {
    send({
      type: 'tab_detach_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

// ============================================================
// Console Interception Architecture
// ============================================================
// 
// Two sources of console logs:
// 1. Service Worker (extension background) - direct interception
// 2. Web Pages (tabs) - CDP Runtime.consoleAPICalled event
//
// Both are forwarded to cdp-server and written to file:
//   ~/logs/browserctl/YYYY-MM-DD.log
//
// Format: one JSON per line
//   {"timestamp":1234567890,"level":"log","message":"...","source":"worker"}
//   {"timestamp":1234567890,"level":"error","message":"...","source":"page","tabId":123,"url":"https://..."}
//
// IMPORTANT: All tabs get Runtime.enable by default (auto-attach for console capture)

// Track which tabs have Runtime domain enabled for console capture
let consoleCaptureTabs = new Set();

// Intercept Service Worker console logs
(function() {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  function sendConsole(level, args) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'console',
        timestamp: Date.now(),
        level,
        message: args.map(arg => {
          if (typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch { return String(arg); }
          }
          return String(arg);
        }).join(' '),
        source: 'worker'
      }));
    }
  }
  
  console.log = function(...args) {
    originalConsoleLog.apply(console, args);
    sendConsole('log', args);
  };
  
  console.error = function(...args) {
    originalConsoleError.apply(console, args);
    sendConsole('error', args);
  };
  
  console.warn = function(...args) {
    originalConsoleWarn.apply(console, args);
    sendConsole('warn', args);
  };
  
  console.log('[Browserctl] Console interception enabled (Service Worker)');
})();

// Enable Runtime domain for a tab to capture console events
async function enableConsoleCapture(tabId) {
  if (consoleCaptureTabs.has(tabId)) {
    return true; // Already enabled
  }
  
  try {
    // Attach debugger if not already attached
    await attachToTab(tabId);
    
    // Enable Runtime domain
    await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({tabId}, 'Runtime.enable', {}, (result, err) => {
        if (err) {
          reject(new Error(err.message || JSON.stringify(err)));
        } else {
          resolve(result);
        }
      });
    });
    
    consoleCaptureTabs.add(tabId);
    console.log(`[Browserctl] Console capture enabled for tab ${tabId}`);
    return true;
  } catch (err) {
    console.warn(`[Browserctl] Failed to enable console capture for tab ${tabId}:`, err.message);
    return false;
  }
}

// Auto-enable console capture for all tabs on startup
async function enableConsoleCaptureForAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      const url = tab.url || '';
      // Only enable for http/https tabs
      if (url.startsWith('http://') || url.startsWith('https://')) {
        await enableConsoleCapture(tab.id);
      }
    }
    console.log(`[Browserctl] Console capture enabled for ${consoleCaptureTabs.size} tabs`);
  } catch (err) {
    console.error('[Browserctl] Failed to enable console capture for all tabs:', err.message);
  }
}

// ============================================================
// CDP Event Subscriptions
// ============================================================

// Receive CDP events from chrome.debugger and forward to service
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  
  // Handle Runtime.consoleAPICalled separately (always forward for console capture)
  if (method === 'Runtime.consoleAPICalled') {
    // Get tab URL
    chrome.tabs.get(tabId, (tab) => {
      const url = tab?.url || '';
      const level = params.type || 'log'; // log, warning, error, info, debug
      
      // Extract message from args
      const message = (params.args || [])
        .map(arg => {
          if (arg.type === 'string') return arg.value;
          if (arg.type === 'number') return String(arg.value);
          if (arg.type === 'object') {
            try { return JSON.stringify(arg.preview || arg.value || {}); }
            catch { return String(arg.description || ''); }
          }
          return String(arg.value || arg.description || '');
        })
        .join(' ');
      
      // Send to cdp-server for file logging
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'console',
          timestamp: params.timestamp || Date.now(),
          level: level === 'warning' ? 'warn' : level,
          message,
          source: 'page',
          tabId,
          url
        }));
      }
    });
    return; // Don't forward to cdpEventListeners, this is internal logging
  }
  
  // Forward CDP events to clients:
  // - If tab is attached via debuggerSessions, always forward (Browser-level WS mode)
  // - If tab has explicit cdpEventListeners subscriptions, also forward filtered events
  const isAttached = debuggerSessions.has(tabId);
  const hasListeners = cdpEventListeners.has(tabId);
  const isSubscribed = !hasListeners || cdpEventListeners.get(tabId).size === 0 || cdpEventListeners.get(tabId).has(method);

  if (!isAttached && !isSubscribed) return;

  send({
    type: 'cdp_event',
    tabId,
    method,
    params: params || {}
  });
});

async function handleCdpSubscribe(msg) {
  const { tabId, events = [] } = msg;

  try {
    await attachToTab(tabId);

    // Initialize set for this tab
    if (!cdpEventListeners.has(tabId)) {
      cdpEventListeners.set(tabId, new Set());
    }

    const tabListeners = cdpEventListeners.get(tabId);
    for (const eventName of events) {
      tabListeners.add(eventName);
    }

    send({
      type: 'cdp_subscribe_result',
      id: msg.id,
      success: true,
      tabId,
      subscribed: events
    });
  } catch (error) {
    send({
      type: 'cdp_subscribe_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

async function handleCdpUnsubscribe(msg) {
  const { tabId, events = [] } = msg;

  try {
    if (cdpEventListeners.has(tabId)) {
      const tabListeners = cdpEventListeners.get(tabId);
      for (const eventName of events) {
        tabListeners.delete(eventName);
      }
    }

    send({
      type: 'cdp_unsubscribe_result',
      id: msg.id,
      success: true,
      tabId,
      unsubscribed: events
    });
  } catch (error) {
    send({
      type: 'cdp_unsubscribe_result',
      id: msg.id,
      success: false,
      error: error.message
    });
  }
}

// ============================================================
// Tab cleanup on close
// ============================================================

// Handle debugger detachment on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (debuggerSessions.has(tabId)) {
    debuggerSessions.delete(tabId);
  }
  if (cdpEventListeners.has(tabId)) {
    cdpEventListeners.delete(tabId);
  }
  // Clean up console capture tracking
  consoleCaptureTabs.delete(tabId);
});

// Auto-enable console capture for new tabs
chrome.tabs.onCreated.addListener((tab) => {
  // Wait for tab to load
  if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    setTimeout(() => {
      enableConsoleCapture(tab.id);
    }, 1000);
  }
});

// Auto-enable console capture when tab URL changes to http/https
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const url = tab.url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      enableConsoleCapture(tabId);
    }
  }
});

// Send tabs list to server
async function sendTabsList() {
  try {
    const tabs = await chrome.tabs.query({});
    // Filter out non-debuggable tabs (chrome://, about:, devtools://, etc.)
    // chrome.debugger cannot attach to these, so exclude them from the list.
    const tabInfo = tabs
      .filter(tab => {
        const url = tab.url || '';
        return url.startsWith('http://') || url.startsWith('https://');
      })
      .map(tab => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        active: tab.active,
        windowId: tab.windowId
      }));
    send({
      type: 'tabs_list',
      tabs: tabInfo
    });
    console.log('[Browserctl] Sent tabs list:', tabInfo.length, 'tabs');
  } catch (error) {
    console.error('[Browserctl] Failed to get tabs:', error);
  }
}

// Initialize connection when extension loads
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Browserctl] Extension installed');
  cleanupAndConnect();
});

// Also connect when extension starts
chrome.runtime.onStartup.addListener(() => {
  console.log('[Browserctl] Chrome startup, connecting...');
  cleanupAndConnect();
});

// Auto-connect when script is loaded
console.log('[Browserctl] Extension loading, connecting...');
cleanupAndConnect();

// ========================================
// Service Worker Keep-Alive (Manifest V3)
// ========================================

// Create an alarm to wake up the Service Worker every 20 seconds
// This keeps the Service Worker alive and ensures reconnection
const KEEP_ALIVE_ALARM = 'browserctl-keepalive';

// Start the keep-alive alarm
async function startKeepAlive() {
  try {
    const existing = await chrome.alarms.get(KEEP_ALIVE_ALARM);
    console.log('[Browserctl] Checking alarm, existing:', existing ? 'yes' : 'no');
    if (!existing) {
      chrome.alarms.create(KEEP_ALIVE_ALARM, {
        delayInMinutes: 0.05,   // First trigger in 3 seconds
        periodInMinutes: 0.5    // Then every 30 seconds (minimum allowed)
      });
      console.log('[Browserctl] Keep-alive alarm created (30s period)');
    } else {
      console.log('[Browserctl] Keep-alive alarm already exists');
    }
  } catch (e) {
    console.error('[Browserctl] Failed to start keep-alive:', e.message);
  }
}

// Handle alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('[Browserctl] Alarm triggered:', alarm.name);
  if (alarm.name === KEEP_ALIVE_ALARM) {
    // Check if WebSocket is connected, reconnect if not
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('[Browserctl] Keep-alive: WS not connected (ws=' + (ws ? ws.readyState : 'null') + '), connecting...');
      connect(serverHost, serverPort);
    } else {
      console.log('[Browserctl] Keep-alive: WS connected, sending ping');
      // Send a ping to keep connection alive
      send({ type: 'ping' }).catch(() => {});
    }
  }
});

// Start keep-alive on startup
startKeepAlive().catch(console.error);

// Cleanup: detach from all tabs before initial connecting
// Only call this on startup / extension install, NOT on every reconnect.
// On reconnect, tabs don't need to be re-detached — just re-establish WS.
async function cleanupAndConnect() {
  try {
    const tabs = await chrome.tabs.query({});
    console.log(`[Browserctl] Startup cleanup: found ${tabs.length} tabs`);

    for (const tab of tabs) {
      await new Promise((resolve) => {
        chrome.debugger.detach({tabId: tab.id}, () => {
          // "Debugger is not attached" is expected on startup — skip log for that case
          // Only log genuine errors
          const error = chrome.runtime.lastError;
          if (error && !error.message.includes('not attached')) {
            console.log(`[Browserctl] Startup cleanup detach tab ${tab.id}: ${error.message}`);
          }
          debuggerSessions.delete(tab.id);
          resolve();
        });
      });
    }

    debuggerSessions.clear();
    attachLocks.clear();
    console.log('[Browserctl] Startup cleanup complete, connecting...');
  } catch (e) {
    console.error('[Browserctl] Startup cleanup failed:', e);
  }

  // Connect after cleanup
  connect('localhost', DEFAULT_PORT);
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'connect') {
    connect(message.host, message.port);
    sendResponse({ status: 'connecting' });
  } else if (message.type === 'disconnect') {
    if (ws) {
      ws.close();
    }
    sendResponse({ status: 'disconnected' });
  } else if (message.type === 'get_status') {
    sendResponse({
      connected: ws && ws.readyState === WebSocket.OPEN,
      host: serverHost,
      port: serverPort
    });
  }
  return true;
});
