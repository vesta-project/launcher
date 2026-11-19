import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

// The renderer's eager glob bundles assets; it does not make them used. Trace
// names at call sites and in the catalogs that feed those call sites instead.
export function iconReferences(root) {
  const found = [];
  const unresolved = [];
  const catalog = readFileSync(join(root, 'src/features/installation/launchers.ts'), 'utf8');
  const launcherNames = [...catalog.matchAll(/icon:\s*["']([^"']+)["']/g)].map(m => `branding/${m[1]}`);
  for (const file of ['src', 'ui', 'workbench'].flatMap(dir => files(join(root, dir))).filter(p => /\.(?:[cm]?[jt]sx?|css)$/.test(p))) {
    const text = readFileSync(file, 'utf8');
    const at = index => `${relative(root, file).replaceAll('\\', '/')}:${text.slice(0, index).split('\n').length}`;
    for (const m of text.matchAll(/(["'`])((?:icons|branding)\/[a-z0-9/-]+)(?:\.svg)?\1/g)) {
      found.push({ name: m[2], at: at(m.index) });
    }
    // Direct SVG imports and CSS URLs (including relative asset paths).
    for (const m of text.matchAll(/(?:assets\/)((?:icons|branding)\/[a-z0-9/-]+)\.svg/g)) {
      found.push({ name: m[1], at: at(m.index) });
    }
    for (const m of text.matchAll(/`((?:icons|branding)\/[^`]*\$\{[^`]+)`|(["'])((?:icons|branding)\/)\2\s*\+\s*([\w.]+)/g)) {
      const expression = m[0];
      let names;
      if (['`branding/${visual.icon}`', '"branding/" + visual.icon', '"branding/" + item.icon'].includes(expression)) {
        // All three consume findLauncher/launchers from installation/launchers.ts.
        names = launcherNames;
      } else if (['`branding/modloaders/${first()}-logo`', '`branding/modloaders/${loader}-logo`'].includes(expression)) {
        const marks = text.match(/const loaderMarks = new Set\(\[([^\]]+)\]/)?.[1];
        if (marks) names = [...marks.matchAll(/["']([a-z]+)["']/g)].map(x => `branding/modloaders/${x[1]}-logo`);
      } else if (expression === '`branding/modloaders/${value}-logo`') {
        // Read the actual options array immediately feeding .map(value).
        const options = text.slice(0, m.index).match(/options=\{\[([^\]]+)\]\.map\(\(value\)[\s\S]*$/)?.[1];
        if (options) names = [...options.matchAll(/["']([a-z]+)["']/g)].map(x => x[1]).filter(x => x !== 'vanilla').map(x => `branding/modloaders/${x}-logo`);
      }
      if (!names?.length) unresolved.push(`${at(m.index)} ${expression}`);
      else for (const name of names) found.push({ name, at: `${at(m.index)} (dynamic catalog)` });
    }
  }
  return { found, unresolved };
}

// Canonicalize tag/attribute order, whitespace, and path/points number spacing.
// Preserve presentation attributes so differently styled brands aren't collapsed.
export function normalizeSvg(svg) {
  return [...svg.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<\/?([\w:-]+)\b([^>]*?)(\/?)>/g)].map(m => {
    const attrs = [...m[2].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].filter(a => !['aria-hidden', 'xmlns', 'version'].includes(a[1]) && !(m[1] === 'svg' && ['width', 'height'].includes(a[1]))).map(a => {
      let v = a[3].trim().replace(/\s+/g, ' ');
      if (a[1] === 'd' || a[1] === 'points') v = (v.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? []).map(t => isNaN(Number(t)) ? t : String(Number(t))).join(' ');
      return `${a[1]}=${v}`;
    }).sort();
    return `${m[0].startsWith('</') ? '/' : ''}${m[1]} ${attrs.join('|')}`;
  }).join('\n').replace(/\n\/(?:path|circle|rect|line|polyline|polygon|ellipse) /g, '');
}
