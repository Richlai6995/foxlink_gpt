// Shared upload file-type classification for chat uploads.
// Mirrored at client/src/lib/uploadFileTypes.ts — keep both sides in sync.

const CODE_EXT = new Set([
  '.py', '.pyw', '.pyi', '.pyx', '.ipynb',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
  '.java', '.kt', '.kts', '.scala', '.groovy', '.gradle',
  '.clj', '.cljs', '.cljc', '.edn',
  '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.ino',
  '.m', '.mm',
  '.cs', '.csx', '.vb', '.fs', '.fsx', '.razor', '.cshtml', '.vbhtml',
  '.go', '.rs', '.zig', '.nim', '.cr', '.v',
  '.php', '.phtml', '.rb', '.erb', '.rake', '.gemspec',
  '.pl', '.pm', '.lua',
  '.swift', '.dart',
  '.hs', '.lhs', '.ml', '.mli',
  '.ex', '.exs', '.erl', '.hrl',
  '.lisp', '.lsp', '.scm', '.ss', '.jl',
  '.asm', '.s', '.pas', '.dpr',
  '.f', '.for', '.f90', '.f95', '.cbl', '.cob',
  '.r', '.rmd',
  '.sql', '.psql', '.tsql', '.plsql', '.cql', '.hql', '.prql',
  '.sol', '.proto', '.thrift', '.avsc', '.capnp', '.fbs',
  '.graphql', '.gql',
  '.html', '.htm', '.xhtml', '.xml', '.xsl', '.xslt', '.svg',
  '.css', '.scss', '.sass', '.less', '.styl',
  '.vue', '.svelte', '.astro',
  '.hbs', '.ejs', '.pug', '.jade', '.mustache',
  '.liquid', '.twig', '.j2', '.jinja', '.jinja2',
  '.wat',
  '.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh',
  '.ps1', '.psm1', '.psd1',
  '.bat', '.cmd',
  '.awk', '.tcl', '.vim',
]);

const CONFIG_EXT = new Set([
  '.yml', '.yaml', '.toml',
  '.json', '.jsonc', '.json5', '.ndjson', '.geojson',
  '.xsd', '.dtd', '.rng',
  '.ini', '.conf', '.cnf', '.cfg', '.config', '.properties',
  '.env',
  '.lock', '.mod', '.sum',
]);

const DOC_EXT = new Set([
  '.txt', '.text',
  '.md', '.markdown', '.mdx',
  '.rst', '.adoc', '.asciidoc', '.org',
  '.tex', '.bib',
  '.csv', '.tsv', '.psv',
]);

const LOG_EXT = new Set([
  '.log', '.out', '.diff', '.patch',
]);

const TEXT_EXT = new Set([...CODE_EXT, ...CONFIG_EXT, ...DOC_EXT, ...LOG_EXT]);

const OFFICE_EXT = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);

// Fallback extension lists for when browser sends empty/octet-stream mime.
const IMAGE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
  '.tif', '.tiff', '.ico', '.heic', '.heif', '.avif',
]);
const AUDIO_EXT = new Set([
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac',
  '.webm', '.opus', '.wma', '.oga',
]);

const OFFICE_MIMES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const SPECIAL_FILENAMES = new Set([
  'Dockerfile', 'Containerfile',
  'Makefile', 'makefile', 'GNUmakefile',
  'Jenkinsfile', 'Rakefile', 'Gemfile', 'Procfile',
  'BUILD', 'WORKSPACE', 'BUILD.bazel', 'WORKSPACE.bazel',
  'Pipfile', 'Vagrantfile', 'Caddyfile', 'Brewfile',
]);

const DOTFILE_NAMES = new Set([
  '.gitignore', '.gitattributes', '.gitmodules',
  '.editorconfig', '.prettierrc', '.eslintrc', '.eslintignore',
  '.babelrc', '.npmrc', '.nvmrc', '.yarnrc', '.dockerignore',
  '.htaccess',
]);

const DOTFILE_PATTERNS = [
  /^\.env(\..+)?$/i,
  /^\.eslintrc\..+$/i,
  /^\.prettierrc\..+$/i,
  /^\.babelrc\..+$/i,
  /^\.stylelintrc(\..+)?$/i,
];

const BLACKLIST_EXT = new Set([
  '.exe', '.dll', '.so', '.dylib', '.msi', '.com', '.bin',
  '.app', '.dmg', '.deb', '.rpm', '.apk', '.ipa',
  '.pem', '.key', '.p12', '.pfx', '.keystore', '.jks',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
  '.tgz', '.tbz2',
]);

const TEXT_HARD_CAP_BYTES = 5 * 1024 * 1024;
const TEXT_WARN_BYTES = 500 * 1024;

function getBasename(filename) {
  return String(filename || '').split(/[\\/]/).pop() || '';
}

function getExt(basename) {
  const m = basename.match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : '';
}

function isEnvFile(basename) {
  return /^\.env(\..+)?$/i.test(basename);
}

function isDotfileMatch(basename) {
  if (DOTFILE_NAMES.has(basename.toLowerCase())) return true;
  for (const pat of DOTFILE_PATTERNS) if (pat.test(basename)) return true;
  return false;
}

const _SPECIAL_LC = new Set([...SPECIAL_FILENAMES].map((n) => n.toLowerCase()));
function matchesSpecialFilename(basename) {
  return _SPECIAL_LC.has(basename.toLowerCase());
}

// Map ext-based kind back to a canonical mime so downstream mime-based
// branching (e.g., gemini.js PDF inline / image inline) still works when
// the browser sent empty / application/octet-stream.
const _OFFICE_EXT_MIME = {
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt':  'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
function canonicalMimeForKind(cls) {
  if (!cls || !cls.ok) return null;
  if (cls.kind === 'pdf') return 'application/pdf';
  if (cls.kind === 'office') return _OFFICE_EXT_MIME[cls.ext] || null;
  if (cls.kind === 'image') {
    const e = cls.ext.slice(1);
    if (e === 'jpg') return 'image/jpeg';
    if (e === 'tif') return 'image/tiff';
    if (e === 'heic' || e === 'heif') return 'image/heic';
    return e ? `image/${e}` : null;
  }
  if (cls.kind === 'audio') {
    const e = cls.ext.slice(1);
    if (e === 'mp3') return 'audio/mpeg';
    if (e === 'm4a') return 'audio/x-m4a';
    if (e === 'oga') return 'audio/ogg';
    return e ? `audio/${e}` : null;
  }
  return null;
}

function classifyUpload(rawFilename, rawMime) {
  const mime = String(rawMime || '');
  const basename = getBasename(rawFilename);
  const ext = getExt(basename);

  if (BLACKLIST_EXT.has(ext)) {
    return { ok: false, basename, ext, reason: `不允許的副檔名: ${ext}（執行檔／壓縮檔／私鑰）` };
  }

  if (mime.startsWith('video/')) {
    return { ok: false, basename, ext, reason: '不允許上傳影片檔案' };
  }

  if (mime.startsWith('image/') || IMAGE_EXT.has(ext)) return { ok: true, kind: 'image', basename, ext };
  if (mime.startsWith('audio/') || AUDIO_EXT.has(ext)) return { ok: true, kind: 'audio', basename, ext };

  if (mime === 'application/pdf' || ext === '.pdf') {
    return { ok: true, kind: 'pdf', basename, ext };
  }

  if (OFFICE_MIMES.has(mime) || OFFICE_EXT.has(ext)) {
    return { ok: true, kind: 'office', basename, ext };
  }

  if (CODE_EXT.has(ext))   return { ok: true, kind: 'text', subtype: 'code',   basename, ext };
  if (CONFIG_EXT.has(ext)) return { ok: true, kind: 'text', subtype: 'config', basename, ext };
  if (DOC_EXT.has(ext))    return { ok: true, kind: 'text', subtype: 'doc',    basename, ext };
  if (LOG_EXT.has(ext))    return { ok: true, kind: 'text', subtype: 'log',    basename, ext };

  if (matchesSpecialFilename(basename) || isDotfileMatch(basename)) {
    return { ok: true, kind: 'text', subtype: 'special', basename, ext };
  }

  if (mime.startsWith('text/')) {
    return { ok: true, kind: 'text', subtype: 'doc', basename, ext };
  }

  return { ok: false, basename, ext, reason: `不支援的檔案格式: ${basename}` };
}

module.exports = {
  CODE_EXT, CONFIG_EXT, DOC_EXT, LOG_EXT, TEXT_EXT,
  OFFICE_EXT, OFFICE_MIMES,
  IMAGE_EXT, AUDIO_EXT,
  SPECIAL_FILENAMES, DOTFILE_NAMES, DOTFILE_PATTERNS,
  BLACKLIST_EXT,
  TEXT_HARD_CAP_BYTES, TEXT_WARN_BYTES,
  getBasename, getExt, isEnvFile, isDotfileMatch, matchesSpecialFilename,
  canonicalMimeForKind,
  classifyUpload,
};
