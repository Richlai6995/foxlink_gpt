// Shared upload file-type classification for chat uploads.
// Mirrored at server/utils/uploadFileTypes.js — keep both sides in sync.

export const CODE_EXT = new Set<string>([
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
])

export const CONFIG_EXT = new Set<string>([
  '.yml', '.yaml', '.toml',
  '.json', '.jsonc', '.json5', '.ndjson', '.geojson',
  '.xsd', '.dtd', '.rng',
  '.ini', '.conf', '.cnf', '.cfg', '.config', '.properties',
  '.env',
  '.lock', '.mod', '.sum',
])

export const DOC_EXT = new Set<string>([
  '.txt', '.text',
  '.md', '.markdown', '.mdx',
  '.rst', '.adoc', '.asciidoc', '.org',
  '.tex', '.bib',
  '.csv', '.tsv', '.psv',
])

export const LOG_EXT = new Set<string>([
  '.log', '.out', '.diff', '.patch',
])

export const TEXT_EXT = new Set<string>([...CODE_EXT, ...CONFIG_EXT, ...DOC_EXT, ...LOG_EXT])

export const OFFICE_EXT = new Set<string>(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'])

// Fallback extension lists for when browser sends empty/octet-stream mime.
export const IMAGE_EXT = new Set<string>([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
  '.tif', '.tiff', '.ico', '.heic', '.heif', '.avif',
])
export const AUDIO_EXT = new Set<string>([
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac',
  '.webm', '.opus', '.wma', '.oga',
])

export const OFFICE_MIMES = new Set<string>([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

export const SPECIAL_FILENAMES = new Set<string>([
  'Dockerfile', 'Containerfile',
  'Makefile', 'makefile', 'GNUmakefile',
  'Jenkinsfile', 'Rakefile', 'Gemfile', 'Procfile',
  'BUILD', 'WORKSPACE', 'BUILD.bazel', 'WORKSPACE.bazel',
  'Pipfile', 'Vagrantfile', 'Caddyfile', 'Brewfile',
])

export const DOTFILE_NAMES = new Set<string>([
  '.gitignore', '.gitattributes', '.gitmodules',
  '.editorconfig', '.prettierrc', '.eslintrc', '.eslintignore',
  '.babelrc', '.npmrc', '.nvmrc', '.yarnrc', '.dockerignore',
  '.htaccess',
])

export const DOTFILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,
  /^\.eslintrc\..+$/i,
  /^\.prettierrc\..+$/i,
  /^\.babelrc\..+$/i,
  /^\.stylelintrc(\..+)?$/i,
]

export const BLACKLIST_EXT = new Set<string>([
  '.exe', '.dll', '.so', '.dylib', '.msi', '.com', '.bin',
  '.app', '.dmg', '.deb', '.rpm', '.apk', '.ipa',
  '.pem', '.key', '.p12', '.pfx', '.keystore', '.jks',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
  '.tgz', '.tbz2',
])

export const TEXT_HARD_CAP_BYTES = 5 * 1024 * 1024
export const TEXT_WARN_BYTES = 500 * 1024

export function getBasename(filename: string): string {
  return String(filename || '').split(/[\\/]/).pop() || ''
}

export function getExt(basename: string): string {
  const m = basename.match(/\.[^.]+$/)
  return m ? m[0].toLowerCase() : ''
}

export function isEnvFile(basename: string): boolean {
  return /^\.env(\..+)?$/i.test(basename)
}

export function isDotfileMatch(basename: string): boolean {
  if (DOTFILE_NAMES.has(basename.toLowerCase())) return true
  for (const pat of DOTFILE_PATTERNS) if (pat.test(basename)) return true
  return false
}

const _SPECIAL_LC = new Set<string>([...SPECIAL_FILENAMES].map((n) => n.toLowerCase()))
export function matchesSpecialFilename(basename: string): boolean {
  return _SPECIAL_LC.has(basename.toLowerCase())
}

const _OFFICE_EXT_MIME: Record<string, string> = {
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt':  'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
export function canonicalMimeForKind(cls: UploadClassification | null | undefined): string | null {
  if (!cls || !cls.ok) return null
  if (cls.kind === 'pdf') return 'application/pdf'
  if (cls.kind === 'office') return _OFFICE_EXT_MIME[cls.ext] || null
  if (cls.kind === 'image') {
    const e = cls.ext.slice(1)
    if (e === 'jpg') return 'image/jpeg'
    if (e === 'tif') return 'image/tiff'
    if (e === 'heic' || e === 'heif') return 'image/heic'
    return e ? `image/${e}` : null
  }
  if (cls.kind === 'audio') {
    const e = cls.ext.slice(1)
    if (e === 'mp3') return 'audio/mpeg'
    if (e === 'm4a') return 'audio/x-m4a'
    if (e === 'oga') return 'audio/ogg'
    return e ? `audio/${e}` : null
  }
  return null
}

export type UploadKind = 'image' | 'audio' | 'pdf' | 'office' | 'text'
export type UploadSubtype = 'code' | 'config' | 'doc' | 'log' | 'special'

export interface UploadClassification {
  ok: boolean
  kind?: UploadKind
  subtype?: UploadSubtype
  basename: string
  ext: string
  reason?: string
}

export function classifyUpload(rawFilename: string, rawMime: string): UploadClassification {
  const mime = String(rawMime || '')
  const basename = getBasename(rawFilename)
  const ext = getExt(basename)

  if (BLACKLIST_EXT.has(ext)) {
    return { ok: false, basename, ext, reason: `不允許的副檔名: ${ext}（執行檔／壓縮檔／私鑰）` }
  }

  if (mime.startsWith('video/')) {
    return { ok: false, basename, ext, reason: '不允許上傳影片檔案' }
  }

  if (mime.startsWith('image/') || IMAGE_EXT.has(ext)) return { ok: true, kind: 'image', basename, ext }
  if (mime.startsWith('audio/') || AUDIO_EXT.has(ext)) return { ok: true, kind: 'audio', basename, ext }

  if (mime === 'application/pdf' || ext === '.pdf') {
    return { ok: true, kind: 'pdf', basename, ext }
  }

  if (OFFICE_MIMES.has(mime) || OFFICE_EXT.has(ext)) {
    return { ok: true, kind: 'office', basename, ext }
  }

  if (CODE_EXT.has(ext))   return { ok: true, kind: 'text', subtype: 'code',   basename, ext }
  if (CONFIG_EXT.has(ext)) return { ok: true, kind: 'text', subtype: 'config', basename, ext }
  if (DOC_EXT.has(ext))    return { ok: true, kind: 'text', subtype: 'doc',    basename, ext }
  if (LOG_EXT.has(ext))    return { ok: true, kind: 'text', subtype: 'log',    basename, ext }

  if (matchesSpecialFilename(basename) || isDotfileMatch(basename)) {
    return { ok: true, kind: 'text', subtype: 'special', basename, ext }
  }

  if (mime.startsWith('text/')) {
    return { ok: true, kind: 'text', subtype: 'doc', basename, ext }
  }

  return { ok: false, basename, ext, reason: `不支援的檔案格式: ${basename}` }
}

// Build the <input accept="..."> attribute value covering whitelisted types.
export function buildAcceptAttr(): string {
  const mimes = [
    'image/*',
    'audio/*',
    'application/pdf',
    ...OFFICE_MIMES,
    'text/*',
  ]
  const exts = [
    ...CODE_EXT, ...CONFIG_EXT, ...DOC_EXT, ...LOG_EXT,
  ]
  return [...mimes, ...exts].join(',')
}
