#!/usr/bin/env -S osascript -l JavaScript

// Black box tests. Both scripts are run the way Alfred runs them, with `rex_path`
// pointing at a fake rex that answers from a fixture folder and logs every call, so
// nothing here touches a real Rex server or app.

ObjC.import('Foundation')
ObjC.import('stdlib')

const app = Application.currentApplication()
app.includeStandardAdditions = true

const quote = value => `'${value.replace(/'/g, `'\\''`)}'`

// Wrapping in a group with a trailing echo keeps a failing script from raising, so the
// exit status can be asserted on like any other output.
const shell = command => {
  // doShellScript separates lines with carriage returns rather than newlines.
  const lines = String(app.doShellScript(`{ ${command} ; } 2>&1; echo "__status:$?"`)).split(/\r|\n/)
  const marker = lines.pop()
  return { status: Number(marker.replace('__status:', '')), output: lines.join('\n') }
}

// The repository, as an absolute path. osascript is given this script's path as
// typed, which is often relative, and a relative path doesn't reliably resolve the
// same way in this process as in the shells it starts, so the shell resolves it.
const ROOT = (() => {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments)
  const tests = $(args[args.indexOf('JavaScript') + 1]).stringByDeletingLastPathComponent.js || '.'
  return shell(`cd ${quote(tests)}/.. && pwd -P`).output
})()

const manager = $.NSFileManager.defaultManager
const fixtures = []

const write = (path, contents) =>
  $(contents).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null)

const readFile = path => {
  const contents = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null)
  return contents.isNil() ? '' : contents.js
}

// The fake prints `<command>.out` to stdout and `<command>.err` to stderr, and exits
// with `<command>.status`, where the command is one of the names in the `case` below.
// Each call's arguments are logged one per line, followed by a line holding `--`.
const FAKE_REX = `#!/bin/sh
for arg in "$@"; do printf '%s\\n' "$arg" >> "$FAKE_REX_DIR/calls"; done
echo -- >> "$FAKE_REX_DIR/calls"
case "$*" in
  "do rexws_list --json") command=list ;;
  "client ls --json") command=clients ;;
  *" do rexws_open "*) command=open ;;
  "actions --json") command=actions ;;
  "config check --json") command=check ;;
  "config reload") command=reload ;;
  *) echo "Error: fake rex has no answer for: $*" >&2; exit 2 ;;
esac
[ -f "$FAKE_REX_DIR/$command.out" ] && cat "$FAKE_REX_DIR/$command.out"
[ -f "$FAKE_REX_DIR/$command.err" ] && cat "$FAKE_REX_DIR/$command.err" >&2
exit "$(cat "$FAKE_REX_DIR/$command.status" 2>/dev/null || echo 0)"
`

const LOCAL_APP = {
  client_id: 'client:local-app',
  info: { kind: 'app', platform: 'macos', name: 'Rex Beta' },
  // No process has this ID, so the script finds nothing to bring forward.
  principal: { transport: 'unix', pid: 99999999 },
}

const workspacesOut = (workspaces, file = '/config/rex/workspaces.lua') =>
  ({ out: JSON.stringify({ file, workspaces }) })

const makeRex = (responses = {}) => {
  const directory = shell('mktemp -d').output
  fixtures.push(directory)
  write(`${directory}/rex`, FAKE_REX)
  shell(`chmod +x ${quote(`${directory}/rex`)}`)

  const defaults = {
    list: workspacesOut([]),
    clients: { out: JSON.stringify({ clients: [LOCAL_APP] }) },
    open: { out: '{}' },
    actions: { out: JSON.stringify({ actions: [{ name: 'rexws_list' }, { name: 'rexws_open' }] }) },
    // Setup works in a config folder inside the fixture, which doesn't exist yet.
    check: { out: JSON.stringify({ path: `${directory}/config/init.lua` }) },
    reload: { out: '' },
  }
  const all = Object.assign(defaults, responses)
  Object.keys(all).forEach(command => {
    const response = all[command]
    if (response.out !== undefined) write(`${directory}/${command}.out`, response.out)
    if (response.err !== undefined) write(`${directory}/${command}.err`, response.err)
    if (response.status !== undefined) write(`${directory}/${command}.status`, String(response.status))
  })
  return directory
}

const calls = directory => readFile(`${directory}/calls`).split('--\n').filter(Boolean).map(call => call.split('\n').filter(Boolean))

const removeFixtures = () => fixtures.forEach(directory => manager.removeItemAtPathError(directory, null))

const runScript = (name, { args = [], env = {} } = {}) => {
  const assignments = Object.keys(env).map(key => `${key}=${quote(env[key])}`).join(' ')
  return shell(`cd ${quote(ROOT)} && ${assignments} ./${name} ${args.map(quote).join(' ')}`)
}

const fakeEnv = directory => ({ rex_path: `${directory}/rex`, FAKE_REX_DIR: directory })

const listFeed = directory => {
  const result = runScript('list.js', { env: fakeEnv(directory) })
  if (result.status !== 0) throw new Error(`list.js exited ${result.status}: ${result.output}`)
  return JSON.parse(result.output)
}

const listItems = directory => listFeed(directory).items

// open.js reports its outcome as Alfred's Run Script JSON rather than an exit status,
// so a failure can reach the Error UI. Returns its arg and variables.
const runOpen = (args, env) => {
  const result = runScript('open.js', { args, env })
  if (result.status !== 0) throw new Error(`open.js exited ${result.status}: ${result.output}`)
  let parsed
  try {
    parsed = JSON.parse(result.output).alfredworkflow
  } catch (error) {
    throw new Error(`open.js gave output that is not JSON: ${result.output}`)
  }
  return Object.assign({ arg: parsed.arg }, parsed.variables)
}

const assertFailed = (outcome, message) => {
  assertEqual(outcome.next, 'error', `next (${outcome.arg})`)
  assertContains(outcome.arg, message, 'message')
}

const assertSucceeded = outcome => assertEqual(outcome.next, '', `next (${outcome.arg})`)

let passed = 0
let failed = 0

const test = (name, body) => {
  try {
    body()
    passed++
    console.log(`  ok    ${name}`)
  } catch (error) {
    failed++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${error.message}`)
  }
}

const assertEqual = (actual, expected, label) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (!same) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const assertContains = (actual, needle, label) => {
  if (!String(actual).includes(needle)) throw new Error(`${label}: expected to find ${JSON.stringify(needle)} in ${JSON.stringify(actual)}`)
}

console.log('list.js')

test('lists workspaces in the order they are defined', () => {
  const rex = makeRex({ list: workspacesOut([{ name: 'Zebra', tabs: 1 }, { name: 'Alpha', tabs: 1 }]) })
  assertEqual(listItems(rex).map(item => item.title), ['Zebra', 'Alpha'], 'titles')
})

test('says whether each workspace is running', () => {
  const rex = makeRex({
    list: workspacesOut([
      { name: 'Work', description: 'Everything', tabs: 3, running: true },
      { name: 'Play', description: 'Side projects', tabs: 2, running: false },
    ]),
  })
  assertEqual(listItems(rex).map(item => item.subtitle), ['Running · Everything', 'Not open · Side projects'], 'subtitles')
})

test('describes a workspace by its tab count when it has no description', () => {
  const rex = makeRex({ list: workspacesOut([{ name: 'One', tabs: 1 }, { name: 'Many', tabs: 4 }]) })
  assertEqual(listItems(rex).map(item => item.subtitle), ['Not open · 1 tab', 'Not open · 4 tabs'], 'subtitles')
})

test('opens by name, edits the definitions file, and rebuilds with the modifiers', () => {
  const rex = makeRex({ list: workspacesOut([{ name: 'Get Lucky', tabs: 2, running: true }], '/x/workspaces.lua') })
  const item = listItems(rex)[0]

  assertEqual([item.arg, item.variables.action], ['Get Lucky', 'open'], 'return')
  assertEqual([item.mods.cmd.arg, item.mods.cmd.variables.action], ['/x/workspaces.lua', 'edit'], 'cmd')
  assertEqual([item.mods.alt.arg, item.mods.alt.variables], ['Get Lucky', { action: 'rebuild' }], 'alt')
})

test('offers to edit the definitions file when there are no workspaces', () => {
  // An empty Lua table reaches JSON as an object, so both shapes count as empty.
  ;[[], {}].forEach(empty => {
    const items = listItems(makeRex({ list: workspacesOut(empty, '/x/workspaces.lua') }))
    assertEqual(items.length, 1, 'item count')
    assertEqual([items[0].arg, items[0].variables.action], ['/x/workspaces.lua', 'edit'], 'item')
  })
})

test('reports why Rex could not list the workspaces', () => {
  const rex = makeRex({
    list: { err: 'Error: workspaces.lua:4: unexpected symbol near }', status: 1 },
  })
  const items = listItems(rex)

  assertEqual(items[0].title, 'Could not list workspaces', 'title')
  assertEqual(items[0].subtitle, 'workspaces.lua:4: unexpected symbol near }', 'subtitle')
  assertEqual(items[0].valid, false, 'valid')
})

test('reports an answer from Rex that is not JSON', () => {
  const items = listItems(makeRex({ list: { out: 'Rex is updating…' } }))
  assertEqual(items[0].title, 'Could not list workspaces', 'title')
  assertContains(items[0].subtitle, 'unexpected answer: Rex is updating', 'subtitle')
})

test('offers setup when Rex has no workspace actions', () => {
  const rex = makeRex({
    list: { err: 'Error: no action named "rexws_list". Run "rex actions" to list them.', status: 1 },
    actions: { out: JSON.stringify({ actions: [{ name: 'something_else' }] }) },
  })
  const items = listItems(rex)

  assertEqual(items.length, 1, 'item count')
  assertEqual([items[0].title, items[0].variables.action], ['Set up Rex Workspaces', 'setup'], 'item')
})

test('reports a missing Rex instead of listing workspaces', () => {
  const result = runScript('list.js', { env: { rex_path: '/nonexistent/rex' } })
  const items = JSON.parse(result.output).items
  assertEqual([items[0].title, items[0].valid], ['Rex is not installed', false], 'item')
})

test('makes modifiers an item does not define do nothing', () => {
  const rex = makeRex({ list: { err: 'Error: no action named "rexws_list".', status: 1 }, actions: { out: '{"actions":[]}' } })
  assertEqual(listFeed(rex).strictmods, true, 'strictmods')
})

console.log('open.js')

test('fails when no workspace is given', () => {
  const outcome = runOpen([], fakeEnv(makeRex()))
  assertFailed(outcome, 'No workspace given')
  assertEqual(outcome.error_title, 'Rex Workspaces couldn’t finish', 'title')
})

test('opens the workspace as the local Rex app', () => {
  const remoteApp = Object.assign({}, LOCAL_APP, { client_id: 'client:phone', principal: { transport: 'tailscale', pid: 1 } })
  const cli = { client_id: 'client:cli', info: { kind: 'cli' }, principal: { transport: 'unix', pid: 1 } }
  const rex = makeRex({ clients: { out: JSON.stringify({ clients: [remoteApp, cli, LOCAL_APP] }) } })

  assertSucceeded(runOpen(['Get Lucky'], fakeEnv(rex)))
  assertEqual(calls(rex).pop(), ['-C', 'client:local-app', 'do', 'rexws_open', 'name=Get Lucky'], 'call')
})

test('rebuilds a workspace that is not running without asking', () => {
  // Another workspace is running, which mustn't count for this one.
  const rex = makeRex({ list: workspacesOut([{ name: 'Work', tabs: 1, running: false }, { name: 'Play', tabs: 1, running: true }]) })
  assertSucceeded(runOpen(['Work'], Object.assign(fakeEnv(rex), { action: 'rebuild' })))
  assertEqual(calls(rex).pop(), ['-C', 'client:local-app', 'do', 'rexws_open', 'name=Work', 'rebuild=true'], 'call')
})

test('asks before rebuilding a running workspace', () => {
  const rex = makeRex({ list: workspacesOut([{ name: 'Work', tabs: 1, running: true }]) })
  const outcome = runOpen(['Work'], Object.assign(fakeEnv(rex), { action: 'rebuild' }))

  assertEqual([outcome.next, outcome.arg], ['confirm', 'Work'], 'outcome')
  assertEqual(calls(rex).some(call => call.includes('rexws_open')), false, 'rebuilt without asking')
})

test('rebuilds a running workspace once confirmed', () => {
  const rex = makeRex({ list: workspacesOut([{ name: 'Work', tabs: 1, running: true }]) })
  assertSucceeded(runOpen(['Work'], Object.assign(fakeEnv(rex), { action: 'rebuild', confirmed: 'true' })))
  assertEqual(calls(rex).pop(), ['-C', 'client:local-app', 'do', 'rexws_open', 'name=Work', 'rebuild=true'], 'call')
})

test('clears the confirmation so it cannot carry over to a later run', () => {
  const outcome = runOpen(['Work'], Object.assign(fakeEnv(makeRex()), { confirmed: 'true' }))
  assertEqual(outcome.confirmed, '', 'confirmed')
})

test('does not rebuild when Rex cannot say whether the workspace is running', () => {
  const rex = makeRex({ list: { err: 'Error: workspaces.lua: Work has no tabs', status: 1 } })
  const outcome = runOpen(['Work'], Object.assign(fakeEnv(rex), { action: 'rebuild' }))

  assertFailed(outcome, 'Work has no tabs')
  assertEqual(outcome.error_title, 'Couldn’t rebuild Work', 'title')
  assertEqual(calls(rex).some(call => call.includes('rebuild=true')), false, 'rebuilt anyway')
})

test('rejects an action it does not know', () => {
  assertFailed(runOpen(['Work'], Object.assign(fakeEnv(makeRex()), { action: 'delete' })), 'Unknown action delete')
})

test('reports an answer about the apps that is not JSON', () => {
  const rex = makeRex({ clients: { out: 'Rex is updating…' } })
  assertFailed(runOpen(['Work'], fakeEnv(rex)), 'unexpected answer: Rex is updating')
})

test('reports why Rex could not open the workspace', () => {
  const rex = makeRex({ open: { err: 'Error: no workspace named Nope in /x/workspaces.lua', status: 1 } })
  const outcome = runOpen(['Nope'], fakeEnv(rex))

  assertFailed(outcome, 'no workspace named Nope')
  assertEqual(outcome.error_title, 'Couldn’t open Nope', 'title')
})

test('reports a missing Rex instead of opening', () => {
  assertFailed(runOpen(['Work'], { rex_path: '/nonexistent/rex' }), 'Rex is not installed')
})

test('reports a definitions file that is not there', () => {
  const outcome = runOpen(['/nonexistent/workspaces.lua'], Object.assign(fakeEnv(makeRex()), { action: 'edit' }))
  assertFailed(outcome, 'Nothing to open at /nonexistent/workspaces.lua')
  assertEqual(outcome.error_title, 'Couldn’t open workspaces.lua', 'title')
})

console.log('open.js setup')

const configFolder = rex => `${rex}/config`

const runSetup = rex => runOpen([], Object.assign(fakeEnv(rex), { action: 'setup' }))

const REQUIRE_BLOCK = '-- Named workspaces, defined in workspaces.lua.\nrequire("workspace_actions")\n'

test('sets up a configuration that does not exist yet', () => {
  const rex = makeRex()
  assertSucceeded(runSetup(rex))

  const folder = configFolder(rex)
  assertEqual(readFile(`${folder}/workspace_actions.lua`), readFile(`${ROOT}/rex/workspace_actions.lua`), 'module')
  assertEqual(readFile(`${folder}/workspaces.lua`), readFile(`${ROOT}/rex/workspaces.example.lua`), 'workspaces')
  assertEqual(readFile(`${folder}/init.lua`), REQUIRE_BLOCK, 'init.lua')
  assertEqual(calls(rex).pop(), ['config', 'reload'], 'reload')
})

test('keeps an existing configuration and adds the require only once', () => {
  const rex = makeRex()
  const folder = configFolder(rex)
  shell(`mkdir -p ${quote(folder)}`)
  write(`${folder}/init.lua`, 'rex.bind("cmd+d", "pane.split")')
  write(`${folder}/workspaces.lua`, 'return {}\n')

  ;[1, 2].forEach(() => assertSucceeded(runSetup(rex)))

  assertEqual(readFile(`${folder}/workspaces.lua`), 'return {}\n', 'workspaces')
  assertEqual(readFile(`${folder}/init.lua`), `rex.bind("cmd+d", "pane.split")\n\n${REQUIRE_BLOCK}`, 'init.lua')
})

test('keeps a symlinked init.lua a symlink', () => {
  const rex = makeRex()
  const folder = configFolder(rex)
  shell(`mkdir -p ${quote(folder)}`)
  write(`${rex}/dotfiles-init.lua`, '-- tracked elsewhere\n')
  shell(`ln -s ${quote(`${rex}/dotfiles-init.lua`)} ${quote(`${folder}/init.lua`)}`)

  assertSucceeded(runSetup(rex))
  assertEqual(shell(`test -L ${quote(`${folder}/init.lua`)}`).status, 0, 'still a symlink')
  assertEqual(readFile(`${rex}/dotfiles-init.lua`), `-- tracked elsewhere\n\n${REQUIRE_BLOCK}`, 'target')
})

test('reports a configuration Rex could not reload', () => {
  const rex = makeRex({ reload: { err: 'Error: init.lua:3: unexpected symbol', status: 1 } })
  const outcome = runSetup(rex)

  assertFailed(outcome, 'init.lua:3: unexpected symbol')
  assertEqual(outcome.error_title, 'Couldn’t set up Rex Workspaces', 'title')
})

console.log('workflow')

const readPlist = () => {
  // plutil ends without a newline, which would join its last line to shell's status marker.
  const converted = shell(`plutil -convert json -o - ${quote(`${ROOT}/info.plist`)} && echo`)
  if (converted.status !== 0) throw new Error(`info.plist did not convert: ${converted.output}`)
  return JSON.parse(converted.output)
}

test('every Alfred UI it shows has a ui.json that parses', () => {
  const paths = readPlist().objects.filter(object => object.type === 'alfred.workflow.userinterface.alfredui').map(object => object.config.path)
  assertEqual(paths.length, 2, 'Alfred UI count')
  paths.forEach(path => {
    const contents = readFile(`${ROOT}/${path}/ui.json`)
    if (!contents) throw new Error(`${path}/ui.json is missing`)
    JSON.parse(contents)
  })
})

test('packages every file the workflow refers to', () => {
  // Built into a fixture folder, so the tests never replace a build in dist.
  const directory = shell('mktemp -d').output
  fixtures.push(directory)
  const output = `${directory}/workflow.alfredworkflow`
  const built = shell(`cd ${quote(ROOT)} && output=${quote(output)} ./build.sh >/dev/null && unzip -Z1 ${quote(output)}`)
  assertEqual(built.status, 0, `build (${built.output})`)

  const packaged = built.output.split('\n')
  const plist = readPlist()
  const scripts = plist.objects.map(object => object.config.scriptfile).filter(Boolean)
  const uis = plist.objects.filter(object => object.config.path).map(object => `${object.config.path}/ui.json`)
  ;[...scripts, ...uis].forEach(file => assertEqual(packaged.includes(file), true, `${file} packaged`))
})

removeFixtures()

console.log(`\n${passed} passed, ${failed} failed`)
$.exit(failed > 0 ? 1 : 0)
