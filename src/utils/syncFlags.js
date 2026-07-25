function isSyncEnabled(flag) {
  if (flag === null || flag === undefined) return true;
  if (typeof flag === 'boolean') return flag;
  if (typeof flag === 'number') return flag !== 0;
  if (typeof flag === 'string') {
    const normalized = flag.trim().toLowerCase();
    if (normalized === '') return true;
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  }
  return Boolean(flag);
}

module.exports = {
  isSyncEnabled
};
