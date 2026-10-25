// Helpers shared by list.js and open.js. JXA has no module system, so this file is a
// single expression: each script evaluates it and takes the helpers it returns.

(() => {
  ObjC.import('Foundation')
  ObjC.import('AppKit')

  const HOME = $.NSHomeDirectory().js
  const REX_BUNDLE_ID = 'com.superlogical.rex'
  const manager = $.NSFileManager.defaultManager

  const env = name => {
    const value = $.NSProcessInfo.processInfo.environment.objectForKey(name)
    return value.isNil() ? '' : value.js
  }

  const isExecutable = path => manager.isExecutableFileAtPath(path)

  // The CLI that ships with the running server comes first, since it always matches
  // it. The copy inside the app is the fallback before the server has installed its
  // own. Alfred doesn't run scripts with the shell's PATH, so neither is found there.
  const rexPath = () => {
    const override = env('rex_path')
    if (override) return isExecutable(override) ? override : null

    const candidates = [
      `${HOME}/Library/Application Support/com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS/rex`,
    ]
    const app = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(REX_BUNDLE_ID)
    if (!app.isNil()) candidates.push(`${app.path.js}/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex`)
    return candidates.find(isExecutable) || null
  }

  const readText = path => {
    const contents = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null)
    return contents.isNil() ? '' : contents.js
  }

  // Runs a program directly rather than through a shell, so arguments such as
  // workspace names need no quoting. Output goes to files rather than pipes: reading
  // one pipe to its end while the other fills up would deadlock.
  const execute = (executable, args) => {
    const paths = ['stdout', 'stderr'].map(stream =>
      `${$.NSTemporaryDirectory().js}rex-workspaces-${$.NSUUID.UUID.UUIDString.js}.${stream}`)
    paths.forEach(path => manager.createFileAtPathContentsAttributes(path, $(), $()))

    try {
      const [stdout, stderr] = paths.map(path => $.NSFileHandle.fileHandleForWritingAtPath(path))
      const task = $.NSTask.alloc.init
      task.setExecutableURL($.NSURL.fileURLWithPath(executable))
      task.setArguments($(args))
      task.setStandardOutput(stdout)
      task.setStandardError(stderr)
      if (!task.launchAndReturnError(null)) throw new Error(`Could not run ${executable}`)
      task.waitUntilExit

      return { status: task.terminationStatus, stdout: readText(paths[0]), stderr: readText(paths[1]).trim() }
    } finally {
      paths.forEach(path => manager.removeItemAtPathError(path, null))
    }
  }

  // rex ends its output with the error, after any warnings, as `Error: <reason>`.
  const failureReason = result =>
    result.stderr.split('\n').pop().replace(/^Error: /, '') || `rex exited with status ${result.status}`

  // A run's JSON output, with a readable error when it isn't JSON.
  const parseJSON = result => {
    try {
      return JSON.parse(result.stdout)
    } catch (error) {
      throw new Error(`rex gave an unexpected answer: ${result.stdout.trim().slice(0, 80) || 'nothing'}`)
    }
  }

  // The workspaces Rex knows about, with the file defining them.
  const listWorkspaces = rex => {
    const result = execute(rex, ['do', 'rexws_list', '--json'])
    if (result.status !== 0) throw new Error(failureReason(result))

    const listing = parseJSON(result)
    // An empty Lua table reaches JSON as an object rather than an array.
    const workspaces = Array.isArray(listing.workspaces) ? listing.workspaces : []
    return { file: listing.file, workspaces }
  }

  // Whether Rex is reachable but has no workspace actions, meaning setup hasn't run.
  const actionsMissing = rex => {
    const result = execute(rex, ['actions', '--json'])
    if (result.status !== 0) return false
    return !(parseJSON(result).actions || []).some(action => action.name === 'rexws_list')
  }

  return { REX_BUNDLE_ID, env, rexPath, readText, execute, failureReason, parseJSON, listWorkspaces, actionsMissing }
})()
