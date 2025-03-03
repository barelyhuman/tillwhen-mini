import { watch } from 'chokidar'
import { build, context } from 'esbuild'
import { nodeExternalsPlugin } from 'esbuild-node-externals'
import mri from 'mri'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path, { dirname, join, resolve } from 'node:path'
import glob from 'tiny-glob'

/**
 * @param {object} options
 * @param {Array<string|{file:string,executable:boolean}>} options.entries
 * @param {Array<[Reg, {contents:string,loader:string}| Promise<{contents:string,loader:string}> ]>} options.loaders
 * @param {Array<{src:string,dist:string,pattern:string, process:boolean} & import("esbuild").BuildOptions>} options.assets
 */
export async function soul({ entries = [], loaders = [], assets = [] } = {}) {
  return _soulInternal({ entries, loaders, assets }).catch(err => {
    console.error(err)
  })
}

async function _soulInternal({ entries = [], loaders = [], assets = [] } = {}) {
  const flags = mri(process.argv.slice(2))
  const executables = []
  const entryPoints = []
  const watchMode = flags.watch ?? flags.w

  for (let d of entries) {
    if (typeof d === 'object') {
      if (d.executable !== false) {
        executables.push(d.file)
      }
      entryPoints.push(d.file)
      continue
    }

    if (typeof d === 'string') {
      executables.push(d)
      entryPoints.push(d)
    }
  }

  const ctx = await context({
    entryPoints: entryPoints,
    outdir: 'dist',
    bundle: true,
    metafile: true,
    splitting: true,
    minify: true,
    outExtension: {
      '.js': '.mjs',
    },
    platform: 'node',
    target: 'node20',
    format: 'esm',
    plugins: [...loaders.map(createPluginFromLoader), nodeExternalsPlugin()],
  })

  const buildResult = await ctx.rebuild()
  const assetContexts = await Promise.all(
    assets.map(async d => {
      const { src, dist, pattern, process: shouldProcess, ...rest } = d
      const files = await glob(pattern, {
        cwd: src,
      }).then(d =>
        d.map(x => ({
          srcFile: join(src, x),
          distFile: join(dist, x),
        }))
      )

      if (!shouldProcess) {
        const files = await glob(pattern, {
          cwd: src,
          filesOnly: true,
        }).then(d =>
          d.map(x => ({
            srcFile: join(src, x),
            distFile: join(dist, x),
          }))
        )

        return () =>
          Promise.all(
            files.map(async fileMeta => {
              await fs.mkdir(dirname(fileMeta.distFile), { recursive: true })
              if (await exists(fileMeta.distFile)) {
                await fs.rm(fileMeta.distFile, { recursive: true, force: true })
              }
              await fs.copyFile(
                fileMeta.srcFile,
                fileMeta.distFile,
                fs.constants.COPYFILE_EXCL
              )
            })
          )
      }

      return () =>
        build({
          entryPoints: files.map(fileMeta => fileMeta.srcFile),
          outdir: dist,
          entryNames: '[dir]/[name]',
          ...rest,
        })
    })
  )

  await Promise.all(assetContexts.map(d => d()))
  if (!watchMode) {
    await ctx.dispose()
    return
  }

  let spawns = execute(executables, buildResult)

  const commonRoot = entryPoints.reduce((acc, item) => {
    const items = join(item).split(path.sep)
    const accItems = acc.split(path.sep)
    const result = []
    for (let i in items) {
      for (let j in accItems) {
        if (items[i] !== accItems[j]) {
          return result.join(path.sep)
        } else {
          result.push(items[i])
        }
      }
    }
  }, '')

  const watcher = watch(commonRoot, {
    ignoreInitial: true,
    ignored: file => {
      return file.startsWith('node_modules/') || file.startsWith('dist/')
    },
    depth: 100,
  })

  let rebuilding = false
  const throttledRebuild = throttle(async function () {
    if (rebuilding) return
    try {
      rebuilding = true
      const result = await ctx.rebuild()
      await Promise.all(assetContexts.map(d => d()))
      spawns = execute(executables, result, spawns)
    } finally {
      rebuilding = false
    }
  }, 500)

  watcher.on('all', async () => {
    await throttledRebuild()
  })
  return
}

let loaderId = 0
/**
 * @param {*} loader
 * @returns {import("esbuild").Plugin}
 */
function createPluginFromLoader(loader) {
  const [ext, fn] = loader
  return {
    name: `loader-${fn.name ?? 'unnamed-' + loaderId++}`,
    setup(builder) {
      builder.onResolve({ filter: ext }, args => ({
        path: resolve(dirname(args.importer), args.path),
      }))
      builder.onLoad({ filter: ext }, args => fn(args))
    },
  }
}

function execute(executables, buildResult, kills = []) {
  if (kills) {
    for (const d of kills) {
      if (d.pid == null) {
        continue
      }
      try {
        process.kill(d.pid)
      } catch (err) {
        if (String(err).includes('kill ESRCH')) {
          continue
        }
        throw err
      }
    }
  }
  return createSpawns()

  function createSpawns() {
    let execIndex = -1
    for (let execFile of executables) {
      execIndex += 1
      for (let outputPath in buildResult.metafile.outputs) {
        const fileOut = buildResult.metafile.outputs[outputPath]
        if (fileOut.entryPoint === join(execFile)) {
          executables[execIndex] = outputPath
        }
      }
    }

    const spawns = []
    for (let execFile of executables) {
      const proc$ = spawn(process.execPath, [execFile], {
        stdio: 'pipe',
      })
      proc$.stdout.on('data', d => process.stdout.write(d))
      proc$.stderr.on('data', d => process.stdout.write(d))
      spawns.push(proc$)
    }
    return spawns
  }
}

function throttle(fn, delay) {
  let lastRun
  return function (...args) {
    if (lastRun) {
      if (Date.now() - lastRun < delay) {
        return
      }
    }
    lastRun = Date.now()
    return fn(...args)
  }
}

function exists(path) {
  return fs
    .access(path)
    .then(() => true)
    .catch(() => false)
}
