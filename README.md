<div align="center">

# npm-check

**See every outdated package at a glance — patch, minor, and major — with interactive upgrade mode.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?labelColor=0B0A09)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?labelColor=0B0A09)](package.json)
[![Node: >=18](https://img.shields.io/badge/node-%3E%3D18-lightgrey?labelColor=0B0A09)](package.json)

</div>

## Install

```bash
npx github:NickCirv/npm-check
```

## Usage

```bash
# Check all packages for updates
npx github:NickCirv/npm-check

# Interactive mode — pick exactly what to upgrade
npx github:NickCirv/npm-check -i

# Auto-update all patch versions
npx github:NickCirv/npm-check --update patch
```

| Flag | Description |
|------|-------------|
| `-i, --interactive` | Terminal UI — navigate with arrow keys, space to select, enter to upgrade |
| `--update patch\|minor\|major` | Auto-update packages at or below the given semver level |
| `--prod` / `--dev` | Limit check to `dependencies` or `devDependencies` only |
| `--ignore <pkg>` | Skip a package (saved to `.npmcheckignore`) |
| `--json` | Machine-readable JSON output |
| `-h, --help` | Show help |

## What it does

Reads your `package.json`, fetches the latest version for every dependency from the npm registry (up to 10 concurrent requests), and groups results by update level: PATCH (safe), MINOR (new features), MAJOR (breaking). The interactive mode (`-i`) lets you select individual packages to upgrade using arrow keys before writing changes and running `npm install`. The `--update` flag skips the UI and updates all packages at or below the chosen semver level automatically.

---
<sub>Zero dependencies · Node >=18 · MIT · by <a href="https://github.com/NickCirv">NickCirv</a></sub>
