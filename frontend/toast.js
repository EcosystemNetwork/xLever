/**
 * @file toast.js — Simple Toast Notification System
 *
 * Provides slide-in/slide-out toast notifications with four severity types:
 * success, error, warning, and info. Each toast includes a colored icon,
 * message text, and a close button.
 *
 * This is the standalone toast system used on pages that don't load ux.js
 * (which provides the more feature-rich XToast module). For app pages,
 * prefer XToast from ux.js instead.
 *
 * @module toast
 * @exports {Function} window.showToast - Show a toast notification
 *
 * @dependencies None (self-contained DOM manipulation)
 */

// ═══════════════════════════════════════════════════════════════
// TOAST CONTAINER SETUP
// ═══════════════════════════════════════════════════════════════

/** @type {HTMLDivElement} Fixed-position container for all active toasts */
const toastContainer = document.createElement('div');
toastContainer.id = 'toast-container';
toastContainer.style.cssText = `
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: none;
`;
document.body.appendChild(toastContainer);

/**
 * Display a toast notification with an icon, message, and auto-dismiss timer.
 * @param {string} message - The notification text to display
 * @param {'success'|'error'|'warning'|'info'} [type='info'] - Toast severity/style
 * @param {number} [duration=4000] - Auto-dismiss delay in ms; 0 = persist until manually closed
 * @returns {HTMLDivElement} The toast DOM element (for manual dismissal via removeToast)
 */
function showToast(message, type = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#667eea'
  };
  
  toast.style.cssText = `
    background: rgba(0, 0, 0, 0.95);
    border: 1px solid ${colors[type] || colors.info};
    border-radius: 12px;
    padding: 16px 20px;
    min-width: 300px;
    max-width: 500px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    gap: 12px;
    pointer-events: auto;
    animation: slideIn 0.3s ease-out;
    font-family: 'DM Sans', sans-serif;
    color: #fff;
    font-size: 14px;
    line-height: 1.5;
  `;
  
  const icon = document.createElement('div');
  icon.style.cssText = `
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: ${colors[type] || colors.info};
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 16px;
    flex-shrink: 0;
  `;
  icon.textContent = icons[type] || icons.info;
  
  const text = document.createElement('div');
  text.style.cssText = `
    flex: 1;
    white-space: pre-line;
  `;
  text.textContent = message;
  
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = `
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.2s;
    flex-shrink: 0;
  `;
  closeBtn.onmouseover = () => closeBtn.style.color = '#fff';
  closeBtn.onmouseout = () => closeBtn.style.color = 'rgba(255, 255, 255, 0.6)';
  closeBtn.onclick = () => removeToast(toast);
  
  toast.appendChild(icon);
  toast.appendChild(text);
  toast.appendChild(closeBtn);
  toastContainer.appendChild(toast);
  
  // Auto remove after duration
  if (duration > 0) {
    setTimeout(() => removeToast(toast), duration);
  }
  
  return toast;
}

/**
 * Animate a toast off-screen and remove it from the DOM.
 * @param {HTMLDivElement} toast - The toast element to remove
 */
function removeToast(toast) {
  toast.style.animation = 'slideOut 0.3s ease-in';
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

// ═══════════════════════════════════════════════════════════════
// CSS ANIMATIONS
// ═══════════════════════════════════════════════════════════════

/** Inject slide-in/slide-out keyframe animations used by toast transitions */
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// Export for use in other scripts
window.showToast = showToast;
