/**
 * Minimal type declarations for @nvidia/openshell-sdk v0.1.2.
 * Verified against the real SDK source (sdk/typescript/src/client.ts,
 * transport.ts, oidc.ts) — these cover exactly the surface we use.
 *
 * Once the real package is installed (requires GITHUB_TOKEN with
 * read:packages for npm.pkg.github.com), these are superseded by the
 * package's own .d.ts files and can be deleted.
 */
declare module "@nvidia/openshell-sdk" {
  export interface ConnectOptions {
    gateway: string;
    caCert?: Buffer;
    clientCert?: Buffer;
    clientKey?: Buffer;
    oidcToken?: string;
    oidcTokenProvider?: OidcTokenProvider;
    edgeToken?: string;
    insecureSkipVerify?: boolean;
    allowInsecureAuth?: boolean;
  }

  export interface OidcTokenProvider {
    getToken(signal?: AbortSignal): Promise<string>;
  }

  export interface ClientCredentialsOptions {
    issuer: string;
    clientId: string;
    clientSecret: string | (() => string | Promise<string>);
    scopes?: readonly string[];
    audience?: string;
    timeoutMs?: number;
  }

  export function clientCredentials(options: ClientCredentialsOptions): OidcTokenProvider;

  export type SandboxPhaseName =
    | "unspecified"
    | "provisioning"
    | "ready"
    | "error"
    | "deleting"
    | "unknown"
    | "stopping"
    | "stopped"
    | "starting"
    | "completed";

  export type SandboxRestartPolicyName = "never" | "on-failure" | "always";

  export interface SandboxSpec {
    name?: string;
    workspace?: string;
    image?: string;
    labels?: Record<string, string>;
    environment?: Record<string, string>;
    providers?: string[];
    gpu?: boolean;
    command?: string[];
    tty?: boolean;
    restartPolicy?: SandboxRestartPolicyName;
  }

  export interface SandboxRef {
    id: string;
    name: string;
    workspace: string;
    phase: SandboxPhaseName;
    labels: Record<string, string>;
    resourceVersion: string;
    serviceUrls: Record<string, string>;
  }

  export interface ExecOptions {
    workspace?: string;
    workdir?: string;
    environment?: Record<string, string>;
    timeoutSecs?: number;
    stdin?: Buffer;
    noLoginShell?: boolean;
    signal?: AbortSignal;
  }

  export interface ExecResult {
    exitCode: number;
    stdout: Buffer;
    stderr: Buffer;
  }

  export interface ExecInteractiveOptions {
    workspace?: string;
    workdir?: string;
    environment?: Record<string, string>;
    timeoutSecs?: number;
    tty?: boolean;
    cols?: number;
    rows?: number;
    noLoginShell?: boolean;
    signal?: AbortSignal;
  }

  export interface ExecStreamChunk {
    stream: "stdout" | "stderr";
    data: Buffer;
  }

  export interface ExecExitEvent {
    type: "exit";
    exitCode: number;
  }

  export type ExecStreamEvent = ExecStreamChunk | ExecExitEvent;

  export interface ExecInteractiveSession {
    output: AsyncIterable<ExecStreamEvent>;
    write(data: Buffer): void;
    resize(cols: number, rows: number): void;
    close(): void;
    done: Promise<number>;
  }

  export interface ExecInteractiveSessionControl extends ExecInteractiveSession {
    closeInput(): void;
    cancel(): void;
    readonly exitCode: number | undefined;
  }

  export interface DeleteOptions {
    workspace?: string;
    allowMissing?: boolean;
  }

  export interface DeletionResult {
    outcome: string;
    rawOutcome: number;
    sandboxId?: string;
  }

  export interface ProviderRef {
    id: string;
    name: string;
    type: string;
    labels: Record<string, string>;
    resourceVersion: string;
  }

  export interface ProviderChange {
    sandbox: SandboxRef;
    changed: boolean;
  }

  export interface Health {
    status: string;
    version: string;
  }

  export class SdkError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
  }

  export function errorCode(err: unknown): string | undefined;

  /** The raw gRPC client — every gateway RPC, including uncurated surface. */
  interface RawClient {
    createProvider(request: unknown): Promise<unknown>;
    getProvider(request: unknown): Promise<unknown>;
    listProviders(request: unknown): Promise<unknown>;
    [method: string]: (request: unknown, options?: unknown) => Promise<unknown>;
  }

  export class SandboxClient {
    readonly raw: RawClient;
    readonly transport: unknown;
    static connect(options: ConnectOptions): Promise<SandboxClient>;
    create(spec: SandboxSpec): Promise<SandboxRef>;
    get(name: string, options?: { workspace?: string }): Promise<SandboxRef>;
    delete(name: string, options?: DeleteOptions): Promise<DeletionResult>;
    waitReady(name: string, timeoutSecs: number, options?: { workspace?: string; signal?: AbortSignal }): Promise<SandboxRef>;
    exec(name: string, command: string[], options?: ExecOptions): Promise<ExecResult>;
    execInteractive(name: string, command: string[], options?: ExecInteractiveOptions): Promise<ExecInteractiveSessionControl>;
    attachProvider(name: string, provider: string, options?: { workspace?: string }): Promise<ProviderChange>;
    detachProvider(name: string, provider: string, options?: { workspace?: string }): Promise<ProviderChange>;
    listAllProviders(name: string, options?: { workspace?: string }): Promise<ProviderRef[]>;
  }

  export class OpenShellClient {
    readonly sandbox: SandboxClient;
    readonly raw: RawClient;
    readonly transport: unknown;
    static connect(options: ConnectOptions): Promise<OpenShellClient>;
    health(): Promise<Health>;
  }
}
