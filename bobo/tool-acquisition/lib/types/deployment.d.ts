/**
 * Locates the BoBo deployment this plugin drives: the project root owning
 * `dsh/`, `scripts/`, and `.venv`, the Python interpreter, the directory of
 * capture scripts, and the directory crawl artifacts land in.
 * @module bobo-crawl-tool/deployment
 */
/**
 * Find the BoBo project root above `start`: the first directory holding a
 * `dsh` child. Locating it from the plugin's own file position keeps the
 * deployment independent of the launch working directory and of any
 * environment variable, so the same build works at any install path.
 *
 * @param start - directory to begin the walk at.
 * @returns the project root, or undefined when no ancestor holds `dsh`.
 */
export declare function findProjectRoot(start: string): string | undefined;
/** Paths a composition may pin; each absent or blank value is derived from the plugin's own location. */
export interface DeploymentPaths {
    /** Interpreter path; blank or absent means the project root's `.venv`. */
    readonly pythonBin?: string | undefined;
    /** Capture-script directory; blank or absent means `<project root>/scripts`. */
    readonly scriptsDir?: string | undefined;
    /** Capture directory; blank or absent means "resolve per call from the session workspace". */
    readonly dataDir?: string | undefined;
}
/** Paths every capture in one plugin instance runs against. */
export interface Deployment {
    /** BoBo project root, when this build sits inside one. */
    readonly root: string | undefined;
    /** Interpreter that runs `browser_server.py`, `run_camoufox.py`, and `proxy_pool.py`. */
    readonly pythonBin: string;
    /** Directory holding those scripts. */
    readonly scriptsDir: string;
    /** Pinned capture directory; the empty string means "resolve per call". */
    readonly dataDir: string;
}
/**
 * Resolve the deployment paths for one plugin instance.
 *
 * @param paths - configured paths; a blank value is treated as unset, so a
 *   composition may leave `pythonBin` and `scriptsDir` empty and let the
 *   plugin's own position decide.
 * @returns the resolved interpreter, scripts directory, capture directory, and
 *   project root.
 */
export declare function resolveDeployment(paths: DeploymentPaths): Deployment;
/**
 * Resolve the directory one capture writes into, most specific source first:
 * the call's own `saveDir`, a pinned deployment `dataDir`, the calling
 * session's workspace `data`, the project root's `data`, then a relative
 * `data`.
 *
 * @param deployment - resolved deployment paths.
 * @param saveDir - the call's explicit target directory, when it named one.
 * @param sessionCwd - the calling session's working directory, when it has one.
 * @returns the directory the capture scripts write their artifacts into.
 */
export declare function captureDir(deployment: Deployment, saveDir: string | undefined, sessionCwd: string | undefined): string;
//# sourceMappingURL=deployment.d.ts.map