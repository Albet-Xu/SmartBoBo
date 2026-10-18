/**
 * Runs the deployment's Python scripts as one-shot children and reports their
 * exit as a typed failure, so the crawl tool can tell "the browser service is
 * gone" (exit code 2) from every other failure.
 * @module bobo-crawl-tool/python
 */

import { execFile, type ExecFileException, type ExecFileOptionsWithStringEncoding } from 'node:child_process'

/** Completion of one Python invocation. */
export interface PythonRun {
  /** Captured standard output. */
  readonly stdout: string
  /** Captured standard error. */
  readonly stderr: string
}

/** Deadline and cancellation for one Python invocation. */
export interface PythonRunOptions {
  /** Wall-clock budget; the child is killed when it expires. */
  readonly timeoutMs: number
  /** Caller cancellation; the child is killed when this aborts. */
  readonly signal: AbortSignal | undefined
}

/** A Python invocation that exited non-zero, was killed, or could not start. */
export class PythonFailure extends Error {
  /** Exit code when the process exited on its own; undefined for a signal, a deadline, or a spawn failure. */
  readonly code: number | undefined

  /**
   * @param message - captured stderr when the child produced any, otherwise the runner's own diagnosis.
   * @param code - the process exit code, or undefined when no exit code applies.
   */
  constructor(message: string, code: number | undefined) {
    super(message)
    this.name = 'PythonFailure'
    this.code = code
  }
}

/** Model-facing detail of one failed invocation. */
function failureDetail(error: ExecFileException, stderr: string): string {
  const captured = stderr.trim()
  if (captured !== '') return captured
  if (error.signal !== undefined) return `python was killed by ${error.signal}`
  return error.message
}

/** Exit code of a failed invocation, or undefined when it was killed or never started. */
function exitCodeOf(error: ExecFileException): number | undefined {
  return typeof error.code === 'number' ? error.code : undefined
}

/**
 * Run one Python script to completion.
 *
 * @param pythonBin - interpreter to run.
 * @param args - script path and arguments, unquoted: the child is spawned
 *   without a shell, so no argument needs escaping.
 * @param options - deadline and the caller's cancellation signal.
 * @returns the captured stdout and stderr of a successful run.
 * @throws {PythonFailure} when the child cannot start, is killed by the
 *   deadline or the signal, or exits non-zero.
 */
export function runPython(
  pythonBin: string,
  args: readonly string[],
  options: PythonRunOptions,
): Promise<PythonRun> {
  const execOptions: ExecFileOptionsWithStringEncoding = {
    timeout: options.timeoutMs,
    encoding: 'utf-8',
    windowsHide: true,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  return new Promise((resolveRun, rejectRun) => {
    execFile(pythonBin, [...args], execOptions, (error, stdout, stderr) => {
      if (error === null) {
        resolveRun({ stdout, stderr })
        return
      }
      rejectRun(new PythonFailure(failureDetail(error, stderr), exitCodeOf(error)))
    })
  })
}
