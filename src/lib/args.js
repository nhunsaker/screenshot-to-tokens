// Tiny argv parser shared by the CLI and scripts: --key value, --key=value, --flag, positional args in `_`.
export function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      if (v !== undefined) args[k] = v
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[k] = argv[++i]
      else args[k] = true
    } else args._.push(a)
  }
  return args
}
