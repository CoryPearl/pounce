const os = require('os');
const crypto = require('crypto');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function createId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function createReconnectToken() {
  return crypto.randomBytes(24).toString('hex');
}

function createRoomCode(existingCodes = new Set(), length = 4) {
  let code = '';
  do {
    code = '';
    for (let i = 0; i < length; i += 1) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (existingCodes.has(code));
  return code;
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function getNetworkAddresses(port) {
  const addresses = [];
  const nets = os.networkInterfaces();
  Object.values(nets).forEach((interfaces = []) => {
    interfaces.forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(`http://${net.address}:${port}`);
      }
    });
  });
  return addresses;
}

module.exports = {
  createId,
  createReconnectToken,
  createRoomCode,
  normalizeName,
  getNetworkAddresses
};
