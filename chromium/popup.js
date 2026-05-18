// Browserctl - Popup Script

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const hostInput = document.getElementById('host');
const portInput = document.getElementById('port');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const forceConnectBtn = document.getElementById('forceConnectBtn');
const debugDiv = document.getElementById('debug');

function debug(...args) {
  const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  console.log('[popup]', line);
  if (debugDiv) {
    const el = document.createElement('div');
    el.textContent = line;
    debugDiv.appendChild(el);
    debugDiv.scrollTop = debugDiv.scrollHeight;
  }
}

// Update status display
function updateStatus(text) {
  // Derive color class from text (same logic as background.js icon switching)
  const color = text === 'Connected' ? 'connected' : text === 'Disconnected' ? 'disconnected' : 'connecting';
  statusDot.className = 'status-dot ' + color;
  statusText.textContent = text;
}

// Get current status from background
function checkStatus() {
  debug('Requesting status from background...');
  chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
    debug('get_status response:', response);
    if (response) {
      if (response.connected) {
        updateStatus('Connected');
        hostInput.value = response.host;
        portInput.value = response.port;
      } else {
        updateStatus('Disconnected (' + (response.host || '?') + ':' + (response.port || '?') + ')');
      }
    } else {
      updateStatus('No response from background');
      debug('No response - service worker may be dead or reloading');
    }
  });
}

// Connect button
connectBtn.addEventListener('click', () => {
  const host = hostInput.value || 'localhost';
  const port = parseInt(portInput.value) || 9224;

  debug('Connect clicked:', host, port);
  updateStatus('Connecting...');

  chrome.runtime.sendMessage({
    type: 'connect',
    host: host,
    port: port
  }, (response) => {
    debug('connect response:', response);
    if (response && response.status === 'connecting') {
      // Background will update status on actual connection
    }
  });
});

// Disconnect button
disconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'disconnect' }, (response) => {
    if (response && response.status === 'disconnected') {
      updateStatus('Disconnected');
    }
  });
});

// Force reconnect button
forceConnectBtn.addEventListener('click', () => {
  debug('Force reconnect clicked');
  chrome.runtime.sendMessage({ type: 'force_reconnect' }, (response) => {
    debug('force_reconnect response:', response);
    if (response && response.status === 'ok') {
      updateStatus('Reconnecting...');
    }
  });
});

// Listen for status updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'status') {
    updateStatus(message.text);
  }
});

// Initial status check
checkStatus();

// View Service Worker Logs link
document.getElementById('swLogsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://serviceworker-internals/' });
});
