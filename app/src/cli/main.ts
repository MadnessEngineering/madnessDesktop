import { join, resolve } from 'path'
import parse from 'minimist'
import { execFile, spawn } from 'child_process'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { runSnapshot } from './snapshot'

const run = (...args: Array<string>) => {
  function cb(e: unknown | null, stderr?: string) {
    if (e) {
      console.error(`Error running command ${args}`)
      console.error(stderr ?? `${e}`)
      process.exit(
        typeof e === 'object' && 'code' in e && typeof e.code === 'number'
          ? e.code
          : 1
      )
    }
  }

  if (process.platform === 'darwin') {
    execFile('open', ['-n', join(__dirname, '../../..'), '--args', ...args], cb)
  } else if (process.platform === 'win32') {
    const exeName = `MadnessDesktop${__DEV__ ? '-dev' : ''}.exe`
    spawn(join(__dirname, `../../${exeName}`), args, {
      detached: true,
      stdio: 'ignore',
    })
      .on('error', cb)
      .on('exit', code => (process.exitCode = code ?? process.exitCode))
      .unref()
  } else {
    throw new Error('Unsupported platform')
  }
}

/**
 * Path the app will atomically write a command's result to. The CLI is
 * detached (`open -n`) so it can't capture the app's output directly — it
 * polls this file instead. pid + hrtime is unique enough per invocation.
 */
const tempResultPath = (): string =>
  join(tmpdir(), `madhub-${process.pid}-${process.hrtime.bigint()}.txt`)

/** Poll for the app to write the result file, then print it and exit. */
const printResult = (path: string, timeoutMs = 60000): void => {
  const start = Date.now()
  const tick = () => {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8')
      try {
        unlinkSync(path)
      } catch {
        // best effort cleanup
      }
      process.stdout.write(content.endsWith('\n') ? content : `${content}\n`)
      return
    }
    if (Date.now() - start > timeoutMs) {
      process.stderr.write('madhub: timed out waiting for the app to respond\n')
      process.exit(1)
    }
    setTimeout(tick, 150)
  }
  tick()
}

const args = parse(process.argv.slice(2), {
  alias: { help: 'h', branch: 'b', group: 'g', recursive: 'r' },
  boolean: ['help', 'recursive', 'json'],
  string: ['group'],
})

const usage = (exitCode = 1): never => {
  process.stderr.write(
    'Madness Desktop CLI usage: \n' +
      '  madhub                              Open the current directory\n' +
      '  madhub open [path]                  Open the provided path\n' +
      '  madhub add [path] -g <group>        Add the repo to the list and file it\n' +
      '                                      under <group> (created if it is new)\n' +
      '  madhub clone [-b branch] [-g group] Clone the repository by url or name/owner\n' +
      '         <url>                        (ex torvalds/linux), optionally checking\n' +
      '                                      out the branch and filing it under a group\n' +
      '  madhub sub <op> [path] [sub]        Submodule op (init|pull|push repo-wide, or\n' +
      '                                      against <sub>; sync|rollback need <sub>)\n' +
      '  madhub foreach <cmd> [-r] [path]    Run a shell command across every submodule\n' +
      '                                      and print the combined output\n' +
      '  madhub group <ls|create|rm> [name]  List / create / remove custom groups\n' +
      '  madhub fav [path]                   Toggle the repo as a favorite\n' +
      '  madhub snapshot [--json] [path ...] Print a read-only git snapshot (branch, changes,\n' +
      '                                      recent commits, stash, drift) without opening the app\n' +
      '  madhub upgrade                      Download and install the latest release\n'
  )
  process.exit(exitCode)
}

const REPO_WIDE_OPS = ['init', 'pull', 'push']
const SINGLE_ONLY_OPS = ['sync', 'rollback']
const SUBMODULE_OPS = [...REPO_WIDE_OPS, ...SINGLE_ONLY_OPS]
const GROUP_OPS = ['ls', 'create', 'rm']

delete process.env.ELECTRON_RUN_AS_NODE

const command = args._.at(0)

if (args.help || command === 'help') {
  usage(0)
} else if (command === 'snapshot') {
  runSnapshot(args._.slice(1).map(String), args.json === true).then(
    code => process.exit(code),
    e => {
      process.stderr.write(`madhub snapshot: ${e}\n`)
      process.exit(1)
    }
  )
} else if (command === 'clone') {
  const urlArg = args._.at(1)
  // Assume name with owner slug if it looks like it
  const url =
    urlArg && /^[^\/]+\/[^\/]+$/.test(urlArg)
      ? `https://github.com/${urlArg}`
      : urlArg

  if (!url) {
    usage(1)
  } else {
    const flags = [`--cli-clone=${url}`]
    if (typeof args.branch === 'string') {
      flags.push(`--cli-branch=${args.branch}`)
    }
    if (typeof args.group === 'string' && args.group.length > 0) {
      flags.push(`--cli-group=${args.group}`)
    }
    run(...flags)
  }
} else if (command === 'add') {
  const group = typeof args.group === 'string' ? args.group : undefined
  if (!group) {
    process.stderr.write('madhub add: -g/--group <name> is required\n')
    usage(1)
  }
  const path = resolve(args._.at(1) ?? '.')
  run(`--cli-add=${path}`, `--cli-group=${group}`)
} else if (command === 'sub') {
  const op = args._.at(1)
  if (typeof op !== 'string' || !SUBMODULE_OPS.includes(op)) {
    process.stderr.write(
      `madhub sub: expected one of ${SUBMODULE_OPS.join('|')}\n`
    )
    usage(1)
  }
  // `madhub sub <op> [repo path] [submodule path]`. sync/rollback need a sub.
  const subPath = args._.at(2)
  const isSingleOnly = SINGLE_ONLY_OPS.includes(op as string)
  if (isSingleOnly && typeof subPath !== 'string') {
    process.stderr.write(`madhub sub ${op}: a <submodule path> is required\n`)
    usage(1)
  }
  const repoPath = resolve('.')
  const flags = [`--cli-submodule=${op}`, `--cli-repo=${repoPath}`]
  if (typeof subPath === 'string') {
    flags.push(`--cli-sub-path=${subPath}`)
  }
  run(...flags)
} else if (command === 'foreach') {
  const cmd = args._.at(1)
  if (typeof cmd !== 'string' || cmd.length === 0) {
    process.stderr.write('madhub foreach: a <command> is required\n')
    usage(1)
  }
  const repoPath = resolve(
    typeof args._.at(2) === 'string' ? args._.at(2)! : '.'
  )
  const resultPath = tempResultPath()
  const flags = [
    `--cli-foreach=${cmd}`,
    `--cli-repo=${repoPath}`,
    `--cli-result=${resultPath}`,
  ]
  if (args.recursive === true) {
    flags.push('--cli-recursive')
  }
  run(...flags)
  printResult(resultPath)
} else if (command === 'group') {
  const op = args._.at(1)
  if (typeof op !== 'string' || !GROUP_OPS.includes(op)) {
    process.stderr.write(
      `madhub group: expected one of ${GROUP_OPS.join('|')}\n`
    )
    usage(1)
  }
  if ((op === 'create' || op === 'rm') && typeof args._.at(2) !== 'string') {
    process.stderr.write(`madhub group ${op}: a <name> is required\n`)
    usage(1)
  }
  const flags = [`--cli-group-op=${op}`]
  const name = args._.at(2)
  if (typeof name === 'string') {
    flags.push(`--cli-group=${name}`)
  }
  if (op === 'ls') {
    const resultPath = tempResultPath()
    flags.push(`--cli-result=${resultPath}`)
    run(...flags)
    printResult(resultPath)
  } else {
    run(...flags)
  }
} else if (command === 'fav') {
  const path = resolve(args._.at(1) ?? '.')
  run(`--cli-favorite`, `--cli-repo=${path}`)
} else {
  const pathArg = command === 'open' ? args._.at(1) : command
  const path = resolve(pathArg ?? '.')
  run(`--cli-open=${path}`)
}
