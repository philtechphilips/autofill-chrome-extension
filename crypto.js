

const ALGORITHM = "AES-GCM";

let cachedKey = null;

/**
 * Import encryption key from base64 string (provided by server)
 */
async function importKey(keyBase64) {
  const keyBuffer = base64ToArrayBuffer(keyBase64);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: ALGORITHM, length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  cachedKey = key;
  return key;
}

/**
 * Initialize encryption with key from server
 * Call this after login/register with the encryptionKey from response
 */
async function initializeEncryption(keyBase64) {
  if (!keyBase64) {
    throw new Error("No encryption key provided");
  }
  return importKey(keyBase64);
}

/**
 * Check if encryption is initialized for current session
 */
function isEncryptionInitialized() {
  return cachedKey !== null;
}

/**
 * Clear encryption state (call on logout)
 */
function clearEncryption() {
  cachedKey = null;
}

/**
 * Encrypt data object
 * @param {Object} data - The data to encrypt
 * @returns {Object} - { encryptedData: string, iv: string } both base64 encoded
 */
async function encryptData(data) {
  if (!cachedKey) {
    throw new Error("Encryption not initialized. Please log in.");
  }
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encoder = new TextEncoder();
  const dataString = JSON.stringify(data);
  const dataBuffer = encoder.encode(dataString);
  
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    cachedKey,
    dataBuffer
  );
  
  return {
    encryptedData: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv)
  };
}

/**
 * Decrypt data
 * @param {string} encryptedData - Base64 encoded encrypted data
 * @param {string} iv - Base64 encoded initialization vector
 * @returns {Object} - The decrypted data object
 */
async function decryptData(encryptedData, iv) {
  if (!cachedKey) {
    throw new Error("Encryption not initialized. Please log in.");
  }
  
  const encryptedBuffer = base64ToArrayBuffer(encryptedData);
  const ivBuffer = base64ToArrayBuffer(iv);
  
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: ivBuffer },
    cachedKey,
    encryptedBuffer
  );
  
  const decoder = new TextDecoder();
  const dataString = decoder.decode(decryptedBuffer);
  
  return JSON.parse(dataString);
}

/**
 * Convert ArrayBuffer to Base64 string
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Export for use in popup.js
window.CryptoUtils = {
  initializeEncryption,
  isEncryptionInitialized,
  clearEncryption,
  encryptData,
  decryptData
};
