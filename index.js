#!/usr/bin/env node

/**
 * npm-check — Check npm packages for updates.
 * Beautiful output, changelog previews, interactive upgrade.
 * Zero dependencies. Pure Node.js ES modules.
 */

import https from 'https'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import readline from 'readline'

// ─── ANSI Colors ──────────────────────────────────────────────────────────────

const c = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  cyan:    '\x1b[36m',
  white:   '\x1b[97m',
  gray:    '\x1b[90m',
  bgGreen: '\x1b[42m',
  bgRed:   '\x1b[41m',
  bgYellow:'\x1b[43m',
}

const paint = (color, text) => `${color}${text}${c.reset}`
const bold  = (text) => paint(c.bold, text)
const dim   = (text) => paint(c.dim, text)
const green = (text) => paint(c.green, text)
const yellow= (text) => paint(c.yellow, text)
const red   = (text) => paint(c.red, text)
const cyan  = (text) => paint(c.cyan, text)
const gray  = (text) => paint(c.gray, text)

// ─── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

const flags = {
  interactive: args.includes('--interactive') || args.includes('-i'),
  updateLevel: (() => {
    const idx = args.indexOf('--update')
    return idx !== -1 ? args[idx + 1] : null
  })(),
  prod:   args.includes('--prod'),
  dev:    args.includes('--dev'),
  json:   args.includes('--json'),
  help:   args.includes('--help') || args.includes('-h'),
  ignore: (() => {
    const idx = args.indexOf('--ignore')
    return idx !== -1 ? args[idx + 1] : null
  })(),
}

if (flags.help) {
  console.log(`
${bold('npm-check')} — Check npm packages for updates

${bold('USAGE')}
  npx npm-check [options]

${bold('OPTIONS')}
  ${cyan('-i, --interactive')}     Interactive mode — pick what to upgrade
  ${cyan('--update patch')}        Auto-update all patch versions
  ${cyan('--update minor')}        Auto-update patch + minor versions
  ${cyan('--update major')}        Update all (shows breaking change warning)
  ${cyan('--prod')}                Only check dependencies
  ${cyan('--dev')}                 Only check devDependencies
  ${cyan('--ignore <pkg>')}        Skip a package (saved to .npmcheckignore)
  ${cyan('--json')}                Machine-readable JSON output
  ${cyan('-h, --help')}            Show this help

${bold('EXAMPLES')}
  npx npm-check
  npx npm-check -i
  npx npm-check --update patch
  npx npm-check --prod --json
`)
  process.exit(0)
}

// ─── Semver Utilities ─────────────────────────────────────────────────────────

function parseVersion(raw) {
  // strip range operators: ^, ~, >=, <=, >, <, =
  const clean = raw.replace(/^[\^~>=<v\s]+/, '').split(' ')[0]
  const parts = clean.split('.').map(n => parseInt(n, 10) || 0)
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0, raw: clean }
}

function compareVersions(current, latest) {
  if (latest.major > current.major) return 'major'
  if (latest.minor > current.minor) return 'minor'
  if (latest.patch > current.patch) return 'patch'
  return 'up-to-date'
}

function bumpVersion(pkgJsonRange, latest, level) {
  const prefix = pkgJsonRange.match(/^([\^~>=<v]+)/)?.[1] || ''
  return prefix + latest
}

// ─── npm Registry Fetch ───────────────────────────────────────────────────────

function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'npm-check-cli/1.0.0' } }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error(`Invalid JSON from ${url}`))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error(`Timeout fetching ${url}`))
    })
  })
}

async function fetchPackageInfo(name) {
  try {
    const data = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)
    return {
      latest: data.version || null,
      description: data.description || '',
      changelog: extractChangelog(data),
      weeklyDownloads: null, // fetched separately if needed
    }
  } catch {
    return null
  }
}

function extractChangelog(data) {
  // Try to get meaningful changelog info from package metadata
  if (!data) return null
  const changes = data['release-notes'] || data.changelog || null
  if (changes && typeof changes === 'string') return changes.slice(0, 200)
  return null
}

// ─── Concurrency-limited Promise.all ─────────────────────────────────────────

async function mapWithConcurrency(items, fn, limit = 10) {
  const results = []
  let idx = 0

  async function worker() {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// ─── .npmcheckignore ─────────────────────────────────────────────────────────

function loadIgnoreList(cwd) {
  const ignoreFile = path.join(cwd, '.npmcheckignore')
  if (!fs.existsSync(ignoreFile)) return new Set()
  return new Set(
    fs.readFileSync(ignoreFile, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
  )
}

function saveIgnoreEntry(cwd, pkgName) {
  const ignoreFile = path.join(cwd, '.npmcheckignore')
  const existing = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, 'utf8') : ''
  if (!existing.includes(pkgName)) {
    fs.appendFileSync(ignoreFile, (existing.endsWith('\n') || !existing ? '' : '\n') + pkgName + '\n')
  }
}

// ─── Load package.json ────────────────────────────────────────────────────────

function loadPackageJson(cwd) {
  const pkgPath = path.join(cwd, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    console.error(red('No package.json found in current directory.'))
    process.exit(1)
  }
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  } catch {
    console.error(red('Could not parse package.json.'))
    process.exit(1)
  }
}

// ─── Build package list ───────────────────────────────────────────────────────

function collectDeps(pkg, ignoredPkgs) {
  const deps = []

  const addDeps = (map, type) => {
    if (!map) return
    for (const [name, range] of Object.entries(map)) {
      if (!ignoredPkgs.has(name)) {
        deps.push({ name, range, type })
      }
    }
  }

  if (!flags.dev)  addDeps(pkg.dependencies,    'dep')
  if (!flags.prod) addDeps(pkg.devDependencies, 'dev')
  if (!flags.dev && !flags.prod) {
    addDeps(pkg.peerDependencies,     'peer')
    addDeps(pkg.optionalDependencies, 'optional')
  }

  return deps
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function levelLabel(level) {
  switch (level) {
    case 'patch': return green('PATCH')
    case 'minor': return yellow('MINOR')
    case 'major': return red('MAJOR')
    default:      return gray('UP TO DATE')
  }
}

function levelIcon(level) {
  switch (level) {
    case 'patch': return green('✓')
    case 'minor': return yellow('△')
    case 'major': return red('✗')
    default:      return gray('·')
  }
}

function levelHint(level) {
  switch (level) {
    case 'patch': return dim('safe')
    case 'minor': return dim('review changelog')
    case 'major': return red('breaking')
    default:      return ''
  }
}

function padEnd(str, len) {
  // ANSI-safe padEnd (strip codes to measure length)
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '')
  const pad = Math.max(0, len - visible.length)
  return str + ' '.repeat(pad)
}

const RULE = gray('━'.repeat(52))

function printHeader() {
  console.log()
  console.log(bold(cyan('npm-check')) + gray(' · checking for updates...'))
  console.log(RULE)
}

function printResults(outdated) {
  const byLevel = { patch: [], minor: [], major: [] }
  for (const pkg of outdated) byLevel[pkg.level].push(pkg)

  const total = outdated.length
  if (total === 0) {
    console.log(green('All packages are up to date!'))
    console.log(RULE)
    return
  }

  console.log(bold(`${total} package${total !== 1 ? 's' : ''} need attention`))
  console.log(RULE)

  for (const level of ['patch', 'minor', 'major']) {
    if (byLevel[level].length === 0) continue

    let sectionLabel
    switch (level) {
      case 'patch': sectionLabel = green(bold('PATCH')) + gray(' (safe to update)'); break
      case 'minor': sectionLabel = yellow(bold('MINOR')) + gray(' (new features, usually safe)'); break
      case 'major': sectionLabel = red(bold('MAJOR')) + gray(' (breaking changes)'); break
    }

    console.log()
    console.log(sectionLabel)

    for (const pkg of byLevel[level]) {
      const nameCol  = padEnd(cyan(pkg.name), 32)
      const fromCol  = padEnd(gray(pkg.current.raw), 12)
      const arrowCol = gray('→')
      const toCol    = padEnd(bold(pkg.latest), 12)
      const icon     = levelIcon(level)
      const hint     = levelHint(level)

      console.log(`  ${nameCol} ${fromCol} ${arrowCol} ${toCol} ${icon} ${hint}`)

      if (pkg.info?.changelog) {
        console.log(gray(`    ↳ ${pkg.info.changelog.slice(0, 90)}...`))
      } else if (level === 'major') {
        const reg = `https://www.npmjs.com/package/${pkg.name}`
        console.log(gray(`    ↳ Check changelog: ${reg}`))
      }

      if (pkg.info?.description) {
        console.log(gray(`    ${dim(pkg.info.description.slice(0, 80))}`))
      }
    }
  }

  console.log()
  console.log(RULE)

  if (!flags.interactive && !flags.updateLevel) {
    console.log(dim('Run with ' + cyan('-i') + dim(' for interactive upgrade mode')))
    console.log(RULE)
  }
}

// ─── Auto-update logic ────────────────────────────────────────────────────────

function shouldUpdateForLevel(pkgLevel, updateLevel) {
  if (updateLevel === 'major') return true
  if (updateLevel === 'minor') return pkgLevel === 'patch' || pkgLevel === 'minor'
  if (updateLevel === 'patch') return pkgLevel === 'patch'
  return false
}

function applyUpdates(cwd, pkgJson, selectedPkgs) {
  let changed = 0
  const updated = JSON.parse(JSON.stringify(pkgJson))

  for (const pkg of selectedPkgs) {
    const maps = [updated.dependencies, updated.devDependencies, updated.peerDependencies, updated.optionalDependencies]
    for (const map of maps) {
      if (map && map[pkg.name]) {
        map[pkg.name] = bumpVersion(map[pkg.name], pkg.latest, pkg.level)
        changed++
        break
      }
    }
  }

  if (changed === 0) {
    console.log(dim('Nothing to update.'))
    return
  }

  const pkgPath = path.join(cwd, 'package.json')
  fs.writeFileSync(pkgPath, JSON.stringify(updated, null, 2) + '\n')
  console.log(green(`\nUpdated ${changed} package${changed !== 1 ? 's' : ''} in package.json`))
  console.log(cyan('Running npm install...'))

  try {
    execFileSync('npm', ['install'], { cwd, stdio: 'inherit' })
    console.log(green('\nDone!'))
  } catch {
    console.error(red('npm install failed. Run it manually.'))
  }
}

// ─── Interactive mode ─────────────────────────────────────────────────────────

async function interactiveMode(outdated) {
  if (outdated.length === 0) return

  const items = outdated.map(pkg => ({ ...pkg, selected: false }))
  let cursor = 0

  // Hide cursor, enable raw mode
  process.stdout.write('\x1b[?25l')
  readline.emitKeypressEvents(process.stdin)
  if (process.stdin.isTTY) process.stdin.setRawMode(true)

  function render() {
    // Clear lines from top
    process.stdout.write('\x1b[2J\x1b[H')

    console.log(bold(cyan('npm-check')) + gray(' · Interactive Mode'))
    console.log(RULE)
    console.log(dim('↑↓ navigate  ·  space select  ·  a all  ·  enter upgrade  ·  q quit'))
    console.log(RULE)
    console.log()

    for (let i = 0; i < items.length; i++) {
      const pkg = items[i]
      const isCursor  = i === cursor
      const isSelected = pkg.selected

      const check = isSelected ? green('[✓]') : gray('[ ]')
      const name  = isCursor ? bold(cyan(pkg.name)) : cyan(pkg.name)
      const from  = gray(pkg.current.raw)
      const to    = bold(pkg.latest)
      const icon  = levelIcon(pkg.level)
      const hint  = levelHint(pkg.level)

      const line = `  ${check} ${padEnd(name, 30)} ${padEnd(from, 10)} → ${padEnd(to, 10)} ${icon} ${hint}`
      if (isCursor) {
        console.log(bold(line))
      } else {
        console.log(line)
      }
    }

    const selectedCount = items.filter(p => p.selected).length
    console.log()
    console.log(RULE)
    console.log(dim(`${selectedCount} selected · Press ${cyan('Enter')} to upgrade`))
  }

  render()

  return new Promise((resolve) => {
    process.stdin.on('keypress', (str, key) => {
      if (!key) return

      if (key.name === 'up' || key.name === 'k') {
        cursor = Math.max(0, cursor - 1)
        render()
      } else if (key.name === 'down' || key.name === 'j') {
        cursor = Math.min(items.length - 1, cursor + 1)
        render()
      } else if (str === ' ') {
        items[cursor].selected = !items[cursor].selected
        render()
      } else if (str === 'a') {
        const allSelected = items.every(p => p.selected)
        items.forEach(p => { p.selected = !allSelected })
        render()
      } else if (key.name === 'return') {
        process.stdin.setRawMode(false)
        process.stdout.write('\x1b[?25h') // show cursor
        process.stdout.write('\x1b[2J\x1b[H')
        resolve(items.filter(p => p.selected))
      } else if (str === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        process.stdin.setRawMode(false)
        process.stdout.write('\x1b[?25h')
        process.stdout.write('\x1b[2J\x1b[H')
        console.log(dim('Cancelled.'))
        resolve([])
      }
    })
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cwd = process.cwd()

  // Handle --ignore flag (save and exit)
  if (flags.ignore) {
    saveIgnoreEntry(cwd, flags.ignore)
    console.log(green(`Added "${flags.ignore}" to .npmcheckignore`))
    return
  }

  const pkgJson  = loadPackageJson(cwd)
  const ignored  = loadIgnoreList(cwd)
  const allDeps  = collectDeps(pkgJson, ignored)

  if (allDeps.length === 0) {
    console.log(yellow('No dependencies found.'))
    return
  }

  if (!flags.json) printHeader()

  // Fetch all package info in parallel (max 10 concurrent)
  const infos = await mapWithConcurrency(allDeps, async (dep) => {
    const info = await fetchPackageInfo(dep.name)
    return { dep, info }
  }, 10)

  // Build outdated list
  const outdated = []
  const upToDate = []

  for (const { dep, info } of infos) {
    if (!info || !info.latest) continue
    const current = parseVersion(dep.range)
    const latest  = parseVersion(info.latest)
    const level   = compareVersions(current, latest)

    if (level === 'up-to-date') {
      upToDate.push({ ...dep, current, latest: info.latest, level, info })
    } else {
      outdated.push({ ...dep, current, latest: info.latest, level, info })
    }
  }

  // Sort: major first, then minor, then patch
  const levelOrder = { major: 0, minor: 1, patch: 2 }
  outdated.sort((a, b) => levelOrder[a.level] - levelOrder[b.level])

  // JSON output mode
  if (flags.json) {
    const output = {
      checked: allDeps.length,
      upToDate: upToDate.length,
      outdated: outdated.length,
      packages: outdated.map(p => ({
        name:    p.name,
        current: p.current.raw,
        latest:  p.latest,
        level:   p.level,
        type:    p.type,
      }))
    }
    console.log(JSON.stringify(output, null, 2))
    return
  }

  printResults(outdated)

  if (outdated.length === 0) return

  // Auto-update mode
  if (flags.updateLevel) {
    const level = flags.updateLevel
    if (!['patch', 'minor', 'major'].includes(level)) {
      console.error(red(`Invalid update level: "${level}". Use patch, minor, or major.`))
      process.exit(1)
    }

    if (level === 'major') {
      console.log()
      console.log(red(bold('Warning:')) + yellow(' Major updates may contain breaking changes.'))
      console.log(yellow('Review changelogs before running in production.'))
      console.log()
    }

    const toUpdate = outdated.filter(p => shouldUpdateForLevel(p.level, level))
    if (toUpdate.length === 0) {
      console.log(dim(`No ${level} updates available.`))
      return
    }

    console.log(cyan(`Updating ${toUpdate.length} ${level} package${toUpdate.length !== 1 ? 's' : ''}...`))
    applyUpdates(cwd, pkgJson, toUpdate)
    return
  }

  // Interactive mode
  if (flags.interactive) {
    if (!process.stdin.isTTY) {
      console.error(red('Interactive mode requires a TTY. Use --update instead.'))
      process.exit(1)
    }

    const selected = await interactiveMode(outdated)
    if (selected.length > 0) {
      console.log(cyan(`Upgrading ${selected.length} package${selected.length !== 1 ? 's' : ''}...`))
      applyUpdates(cwd, pkgJson, selected)
    } else {
      console.log(dim('No packages selected.'))
    }
  }
}

main().catch(err => {
  console.error(red('Error: ' + err.message))
  process.exit(1)
})
