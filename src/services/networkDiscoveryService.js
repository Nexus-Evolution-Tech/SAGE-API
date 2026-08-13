const os = require('os');
const axios = require('axios');
const pLimit = require('p-limit');
const logger = require('../config/logger');

function ipToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function intToIp(int) {
  return [
    (int >>> 24) & 0xff,
    (int >>> 16) & 0xff,
    (int >>> 8) & 0xff,
    int & 0xff
  ].join('.');
}

function maskFromNetmask(netmask) {
  const n = ipToInt(netmask);
  return n;
}

function cidrFromIpMask(ip, netmask) {
  const mask = maskFromNetmask(netmask);
  const bits = mask.toString(2).split('1').length - 1; // count ones
  const networkInt = ipToInt(ip) & mask;
  return `${intToIp(networkInt)}/${bits}`;
}

function expandCidr(cidr) {
  const [base, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const baseInt = ipToInt(base);
  const hostBits = 32 - bits;
  const total = Math.max(0, (1 << hostBits));
  const ips = [];
  // Skip network and broadcast when hostBits >= 2
  const startOffset = hostBits >= 2 ? 1 : 0;
  const endOffset = hostBits >= 2 ? total - 1 : total;
  for (let i = startOffset; i < endOffset; i++) {
    ips.push(intToIp(baseInt + i));
  }
  return ips;
}

function getLocalPrivateCidrs() {
  const ifaces = os.networkInterfaces();
  const cidrs = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const ip = iface.address;
      // private ranges
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip)) {
        cidrs.push(cidrFromIpMask(ip, iface.netmask));
      }
    }
  }
  return Array.from(new Set(cidrs));
}

async function isControlId(ip, port, timeoutMs) {
  const client = axios.create({ timeout: timeoutMs, validateStatus: () => true });
  const base = `http://${ip}:${port}`;
  try {
    // Try login endpoint
    const resLogin = await client.get(`${base}/login.fcgi`);
    const text = typeof resLogin.data === 'string' ? resLogin.data : JSON.stringify(resLogin.data || {});
    if (resLogin.status < 500 && (/login/i.test(text) || /control id|idaccess|idblock/i.test(text))) {
      return true;
    }
  } catch (e) {
    logger.debug('[DESCOBERTA] codigo=SONDA_LOGIN_INDISPONIVEL');
  }
  try {
    const resRoot = await client.get(base);
    const text = typeof resRoot.data === 'string' ? resRoot.data : JSON.stringify(resRoot.data || {});
    if (resRoot.status < 500 && (/control id|idaccess|idblock|fcgi/i.test(text))) {
      return true;
    }
  } catch (e) {
    logger.debug('[DESCOBERTA] codigo=SONDA_RAIZ_INDISPONIVEL');
  }
  return false;
}

async function discoverControlId({ cidr, ports = [80, 82], timeoutMs = 1200, concurrency = 64 }) {
  const cidrs = cidr ? [cidr] : getLocalPrivateCidrs();
  const results = [];
  const limit = pLimit(concurrency);

  for (const net of cidrs) {
    const hosts = expandCidr(net);
    const tasks = [];
    for (const ip of hosts) {
      for (const port of ports) {
        tasks.push(limit(async () => {
          const ok = await isControlId(ip, port, timeoutMs);
          if (ok) {
            results.push({ ip, port, vendor: 'CONTROLID', name: null, model: null, serial: null });
          }
        }));
      }
    }
    await Promise.all(tasks);
  }

  return { cidrs, found: results };
}

module.exports = {
  getLocalPrivateCidrs,
  discoverControlId
};
