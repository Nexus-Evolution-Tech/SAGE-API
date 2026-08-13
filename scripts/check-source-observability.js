const fs = require('fs');
const path = require('path');
function semLiterais(source) {
  let output = '';
  let state = 'code';
  let quote = null;
  let interpolationDepth = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    const blank = () => { output += ch === '\n' ? '\n' : ' '; };
    if (state === 'line') {
      blank();
      if (ch === '\n') state = 'code';
    } else if (state === 'block') {
      blank();
      if (ch === '*' && next === '/') { output += ' '; i += 1; state = 'code'; }
    } else if (state === 'regex') {
      blank();
      if (ch === '\\' && next) { output += ' '; i += 1; }
      else if (ch === '/') state = 'code';
    } else if (state === 'quote') {
      blank();
      if (ch === '\\' && next) { output += next === '\n' ? '\n' : ' '; i += 1; }
      else if (ch === quote) state = 'code';
    } else if (state === 'template') {
      blank();
      if (ch === '\\' && next) { output += next === '\n' ? '\n' : ' '; i += 1; }
      else if (ch === '`') state = 'code';
      else if (ch === '$' && next === '{') { output += '{'; i += 1; state = 'code'; interpolationDepth = 1; }
    } else {
      if (ch === '/' && next === '/') { output += '  '; i += 1; state = 'line'; }
      else if (ch === '/' && next === '*') { output += '  '; i += 1; state = 'block'; }
      else if (ch === '/' && /return$/.test(output.trimEnd())) { blank(); state = 'regex'; }
      else if (ch === '/' && /[=(:,[!{;]/.test(output.trimEnd().slice(-1))) { blank(); state = 'regex'; }
      else if (ch === '\'' || ch === '"') { blank(); quote = ch; state = 'quote'; }
      else if (ch === '`') { blank(); state = 'template'; }
      else {
        output += ch;
        if (interpolationDepth) {
          if (ch === '{') interpolationDepth += 1;
          if (ch === '}' && --interpolationDepth === 0) state = 'template';
        }
      }
    }
  }
  return output;
}
function linha(source, index) { return source.slice(0, index).split('\n').length; }
function verificarArquivo(file) {
  const source = semLiterais(fs.readFileSync(file, 'utf8'));
  const rules = [
    [/\bconsole\s*\.\s*[A-Za-z_$][\w$]*/, 'console executável'],
    [/\bcatch\s*(?:\([^)]*\))?\s*\{(?:\s|;)*\}/, 'catch vazio'],
    [/\.catch\s*\(\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{(?:\s|;)*\}\s*\)/, '.catch vazio']
  ];
  return rules.flatMap(([regex, description]) => {
    const found = [];
    let match;
    const global = new RegExp(regex.source, 'g');
    while ((match = global.exec(source))) found.push({ file, line: linha(source, match.index), description });
    return found;
  });
}
function arquivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return arquivos(full);
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
}
function verificarDiretorio(dir) { return arquivos(dir).flatMap(verificarArquivo); }
if (require.main === module) {
  const root = path.resolve(process.argv[2] || 'src');
  const falhas = verificarDiretorio(root);
  if (falhas.length) {
    falhas.forEach(({ file, line: n, description }) => console.error(`${path.relative(process.cwd(), file)}:${n} ${description}`));
    process.exitCode = 1;
  }
}
module.exports = { semLiterais, verificarArquivo, verificarDiretorio };
