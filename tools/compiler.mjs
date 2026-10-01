import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, posix, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const artifacts = new Map();
const maxWorkspaceBytes = 500_000;
const maxTerminalBytes = 100_000;
const artifactTtlMs = 15 * 60 * 1000;

function sandboxArgs(directory) {
  return [
    '--die-with-parent', '--new-session', '--unshare-pid', '--clearenv',
    '--setenv', 'PATH', '/usr/bin:/bin',
    '--setenv', 'HOME', '/tmp',
    '--setenv', 'TMPDIR', '/tmp',
    '--setenv', 'LC_ALL', 'C',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/etc', '/etc',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--dir', '/work', '--bind', directory, '/work', '--chdir', '/work'
  ];
}

function runSandbox(command, args, { directory, input = '', timeoutMs = 10_000, outputLimit = maxTerminalBytes } = {}) {
  return new Promise(resolvePromise => {
    const bwrapArgs = [...sandboxArgs(directory), 'prlimit',
      `--cpu=${command === 'gcc' ? 10 : 3}`,
      `--as=${command === 'gcc' ? 536870912 : 268435456}`,
      '--nproc=64', '--nofile=128', '--fsize=10485760', '--', command, ...args];
    const child = spawn('bwrap', bwrapArgs, {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin' }
    });
    let stdout = '';
    let stderr = '';
    let outputSize = 0;
    let timedOut = false;
    let tooMuchOutput = false;
    const collect = target => chunk => {
      outputSize += chunk.length;
      if (outputSize > outputLimit) {
        tooMuchOutput = true;
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
        return;
      }
      if (target === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, timeoutMs);
    child.on('error', error => {
      clearTimeout(timer);
      resolvePromise({ exitCode: 127, stdout, stderr: error.message, timedOut: false, tooMuchOutput: false });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code ?? 1, stdout, stderr, timedOut, tooMuchOutput });
    });
    child.stdin.end(input);
  });
}

function validateFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 64)
    throw new Error('Add between 1 and 64 C source/header files before compiling.');
  let totalBytes = 0;
  const paths = new Set();
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.source !== 'string')
      throw new Error('Each workspace file must have a path and source text.');
    const normalized = posix.normalize(file.path);
    if (normalized !== file.path || file.path.startsWith('/') || file.path.split('/').some(part => !part || part === '.' || part === '..') || !/^[A-Za-z0-9_.\-/]+$/.test(file.path))
      throw new Error(`Invalid workspace path '${file.path}'.`);
    if (!['.c', '.h'].includes(extname(file.path).toLowerCase()))
      throw new Error(`'${file.path}' is not a .c or .h file.`);
    if (paths.has(file.path)) throw new Error(`Duplicate workspace path '${file.path}'.`);
    paths.add(file.path);
    totalBytes += Buffer.byteLength(file.source, 'utf8');
  }
  if (totalBytes > maxWorkspaceBytes) throw new Error('Workspace source files exceed the 500 KB compile limit.');
  if (![...paths].some(path => path.toLowerCase().endsWith('.c')))
    throw new Error('Add at least one .c source file before compiling.');
}

export async function compileWorkspace(files, { outputName = 'program', sourcePaths = null, flags = ['-std=c11', '-Wall', '-Wextra', '-pedantic', '-O0', '-g'] } = {}) {
  validateFiles(files);
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(outputName)) throw new Error('Output name must contain only letters, numbers, _ or -.');
  const allowedFlags = new Set(['-std=c11', '-std=c17', '-std=gnu11', '-Wall', '-Wextra', '-pedantic', '-O0', '-O1', '-O2', '-g', '-lm']);
  if (!Array.isArray(flags) || flags.some(flag => !allowedFlags.has(flag))) throw new Error('Unsupported compiler flag. Allowed flags: -std=c11, -std=c17, -std=gnu11, -Wall, -Wextra, -pedantic, -O0, -O1, -O2, -g, -lm.');
  const directory = await mkdtemp(join(tmpdir(), 'cmv-build-'));
  try {
    const sourceRoot = join(directory, 'src');
    await mkdir(sourceRoot, { recursive: true });
    for (const file of files) {
      const destination = resolve(sourceRoot, file.path);
      if (!destination.startsWith(sourceRoot + '/')) throw new Error(`Invalid workspace path '${file.path}'.`);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.source, { encoding: 'utf8', mode: 0o600 });
    }
    const selectedSources = sourcePaths || files.filter(file => extname(file.path).toLowerCase() === '.c').map(file => file.path);
    if (!selectedSources.length || selectedSources.some(path => !files.some(file => file.path === path && extname(path).toLowerCase() === '.c'))) throw new Error('Compile command must name one or more .c files from this workspace.');
    const sources = selectedSources.map(path => `/work/src/${path}`);
    const outputPath = `/work/${outputName}`;
    const result = await runSandbox('gcc', [...flags, '-I/work/src', ...sources, '-o', outputPath], { directory, timeoutMs: 15_000, outputLimit: maxTerminalBytes });
    if (result.timedOut) throw new Error('Compilation exceeded the 15 second time limit.');
    if (result.tooMuchOutput) throw new Error('Compiler output exceeded the 100 KB limit.');
    if (result.exitCode !== 0) {
      await rm(directory, { recursive: true, force: true });
      return { success: false, diagnostics: result.stderr || result.stdout || `Compiler exited with code ${result.exitCode}.` };
    }
    const id = randomUUID();
    artifacts.set(id, { directory, outputName, createdAt: Date.now() });
    cleanArtifacts();
    return { success: true, compilationId: id, diagnostics: result.stderr };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function runCompiled(compilationId, stdin = '', executableName = null) {
  const artifact = artifacts.get(compilationId);
  if (!artifact || Date.now() - artifact.createdAt > artifactTtlMs) {
    if (artifact) {
      artifacts.delete(compilationId);
      await rm(artifact.directory, { recursive: true, force: true });
    }
    throw new Error('Compiled program expired. Compile the workspace again.');
  }
  if (typeof stdin !== 'string' || Buffer.byteLength(stdin, 'utf8') > 10_000)
    throw new Error('Program input must be 10 KB or less.');
  if (executableName && executableName !== artifact.outputName) throw new Error(`No compiled executable named '${executableName}'. Compile it first with gcc -o ${executableName}.`);
  const result = await runSandbox(`/work/${artifact.outputName}`, [], {
    directory: artifact.directory, input: stdin, timeoutMs: 5_000, outputLimit: maxTerminalBytes
  });
  let message = '';
  if (result.timedOut) message = 'Program stopped after reaching the 5 second time limit.';
  if (result.tooMuchOutput) message = 'Program stopped after exceeding the 100 KB output limit.';
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, message };
}

function cleanArtifacts() {
  const now = Date.now();
  for (const [id, artifact] of artifacts) {
    if (now - artifact.createdAt > artifactTtlMs) {
      artifacts.delete(id);
      rm(artifact.directory, { recursive: true, force: true }).catch(() => {});
    }
  }
  while (artifacts.size > 10) {
    const [oldestId, oldest] = artifacts.entries().next().value;
    artifacts.delete(oldestId);
    rm(oldest.directory, { recursive: true, force: true }).catch(() => {});
  }
}


export async function runTerminalCommand(command, files, compilationId = '', stdin = '') {
  if (typeof command !== 'string' || command.length > 1000) throw new Error('Enter one compiler or executable command.');
  // Tokenize a small command-line grammar. No shell is invoked, and shell operators are rejected.
  if (/[;&|<>`$\n\r]/.test(command)) throw new Error('Enter one command at a time. Shell operators and scripts are not supported.');
  const tokens = command.match(/"[^"\n]*"|'[^'\n]*'|\S+/g)?.map(token => token.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted)) || [];
  if (!tokens.length) throw new Error('Enter a command.');
  if (tokens[0] === 'gcc' || tokens[0] === 'cc') {
    let outputName = 'a.out'; const sourcePaths = []; const flags = [];
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === '-o') { if (!tokens[i + 1]) throw new Error('gcc: missing filename after -o.'); outputName = tokens[++i].replace(/^\.\//, ''); }
      else if (token.startsWith('-')) flags.push(token);
      else sourcePaths.push(token.replace(/^\.\//, ''));
    }
    const result = await compileWorkspace(files, { outputName, sourcePaths, flags: [...new Set(['-std=c11', '-Wall', '-Wextra', '-pedantic', ...flags])] });
    return { ...result, command: `gcc ${sourcePaths.join(' ')} -o ${outputName}` };
  }
  if (tokens.length === 1 && tokens[0].startsWith('./')) {
    const executable = tokens[0].slice(2);
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(executable)) throw new Error('Executable path must be ./name.');
    if (!compilationId) throw new Error(`Compile first, for example: gcc main.c -o ${executable}`);
    return { ...(await runCompiled(compilationId, stdin, executable)), command: tokens[0] };
  }
  throw new Error(`Command not available: ${tokens[0]}. Use gcc source.c -o program, then ./program.`);
}
