# npm-check
> Check npm packages for updates. Beautiful output, changelog previews, interactive upgrade.

```bash
npx npm-check
```

```
npm-check · 3 packages need attention
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATCH (safe to update)
  lodash         4.17.19 → 4.17.21   ✓ safe
  dotenv         16.0.1  → 16.0.3    ✓ safe

MINOR (new features, usually safe)
  express        4.18.0  → 4.19.2    △ review changelog
    ↳ 4.19.0: Added support for async error handlers...

MAJOR (breaking changes)
  webpack        4.46.0  → 5.90.0    ✗ breaking
    ↳ See migration guide: webpack.js.org/migrate

Run with -i for interactive upgrade mode
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Commands
| Command | Description |
|---------|-------------|
| `npm-check` | Check all packages for updates |
| `-i, --interactive` | Interactive mode — pick what to upgrade |
| `--update patch` | Auto-update all patch versions |
| `--update minor` | Auto-update patch + minor versions |
| `--update major` | Update all (shows breaking change warning) |
| `--prod` / `--dev` | Filter by dep type |
| `--ignore <pkg>` | Ignore a package (saved to .npmcheckignore) |
| `--json` | JSON output |

## Install
```bash
npx npm-check
npm install -g npm-check
```

---
**Zero dependencies** · **Node 18+** · Made by [NickCirv](https://github.com/NickCirv) · MIT
