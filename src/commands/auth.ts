import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command, InvalidArgumentError, Option } from 'commander';
import { AuthRequiredError, CliError, getErrorMessage } from '../errors.js';
import { executeCommand } from '../execution.js';
import {
  type BrowserCliCommand,
  type CliCommand,
  type CommandArgs,
  type InternalCliCommand,
  fullName,
  getRegistry,
} from '../registry.js';
import { render as renderOutput } from '../output.js';

type AuthStatus = 'logged_in' | 'not_logged_in' | 'unknown' | 'error';
type AuthStatusMode = 'quick' | 'full';
type AuthRefreshStatus = 'refreshed' | 'touched' | 'not_logged_in' | 'skipped' | 'unsupported' | 'error';
type AppAuthRefreshStatus = 'pending' | 'touched' | 'refreshed' | 'not_logged_in' | 'error' | 'unsupported';

const AUTH_REFRESH_STATE_VERSION = 1;
const AUTH_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const APP_AUTH_REFRESH_SCHEMA_VERSION = 1;
const APP_AUTH_REFRESH_FAILURE_LIMIT = 3;
const APP_AUTH_REFRESH_DEFAULT_JITTER_MINUTES = 120;

export interface AuthStatusRow {
  site: string;
  status: AuthStatus;
  logged_in: boolean | '';
  identity: string;
  checked: AuthStatusMode | 'skipped';
  error: string;
}

interface AuthStatusOptions {
  sites?: string;
  only?: string;
  full?: boolean;
  concurrency?: string | number;
  timeout?: string | number;
  profile?: string;
}

export interface AuthRefreshRow {
  site: string;
  status: AuthRefreshStatus;
  last_touched_at: string;
  next_refresh_at: string;
  error: string;
}

interface AuthRefreshOptions {
  sites?: string;
  all?: boolean;
  concurrency?: string | number;
  timeout?: string | number;
  profile?: string;
  statePath?: string;
  now?: Date;
}

interface AuthRefreshScheduledOptions {
  sites?: string;
  all?: boolean;
  timeout?: string | number;
  profile?: string;
  configPath?: string;
  runStatePath?: string;
  now?: Date;
  jitterMinutes?: string | number;
}

interface AuthRefreshSiteState {
  last_touched_at?: string;
  last_attempt_at?: string;
  last_status?: AuthRefreshStatus;
}

interface AuthRefreshState {
  version: number;
  sites: Record<string, AuthRefreshSiteState>;
}

interface AppAuthRefreshConfig {
  schemaVersion?: number;
  enabled?: boolean;
  scheduleTime?: string;
  perSiteEnabled?: Record<string, boolean>;
}

interface AppAuthRefreshSiteEntry {
  lastAttempt?: string;
  lastTouched?: string;
  status?: AppAuthRefreshStatus;
  message?: string;
  consecutiveFailures?: number;
}

interface AppAuthRefreshRunState {
  schemaVersion?: number;
  lastFullRun?: string;
  lastFullRunSummary?: string;
  perSite?: Record<string, AppAuthRefreshSiteEntry>;
}

export interface AppAuthRefreshScheduledRow {
  site: string;
  status: AppAuthRefreshStatus | 'skipped';
  lastAttempt: string;
  lastTouched: string;
  message: string;
}

function parsePositiveInt(raw: string | number | undefined, label: string, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`${label} must be a positive integer. Received: "${String(raw)}"`);
  }
  return parsed;
}

function parseNonNegativeInt(raw: string | number | undefined, label: string, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError(`${label} must be a non-negative integer. Received: "${String(raw)}"`);
  }
  return parsed;
}

function parseSiteFilter(raw: string | undefined): Set<string> | null {
  if (!raw || !raw.trim()) return null;
  const sites = raw.split(',').map(site => site.trim()).filter(Boolean);
  return sites.length > 0 ? new Set(sites) : null;
}

function defaultAuthRefreshStatePath(): string {
  return join(homedir(), '.opencli', 'auth-refresh.json');
}

function openCliAppSupportDir(): string {
  return join(homedir(), 'Library', 'Application Support', 'OpenCLI App');
}

function defaultAppAuthRefreshConfigPath(): string {
  return join(openCliAppSupportDir(), 'auth-refresh-config.json');
}

function defaultAppAuthRefreshRunStatePath(): string {
  return join(openCliAppSupportDir(), 'auth-refresh-state.json');
}

function emptyAuthRefreshState(): AuthRefreshState {
  return { version: AUTH_REFRESH_STATE_VERSION, sites: {} };
}

async function loadAuthRefreshState(statePath: string): Promise<AuthRefreshState> {
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as Partial<AuthRefreshState>;
    if (parsed && parsed.version === AUTH_REFRESH_STATE_VERSION && parsed.sites && typeof parsed.sites === 'object') {
      return { version: AUTH_REFRESH_STATE_VERSION, sites: parsed.sites as Record<string, AuthRefreshSiteState> };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return emptyAuthRefreshState();
}

async function saveAuthRefreshState(statePath: string, state: AuthRefreshState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function loadAppAuthRefreshConfig(configPath: string): Promise<AppAuthRefreshConfig> {
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as Partial<AppAuthRefreshConfig>;
    return {
      schemaVersion: APP_AUTH_REFRESH_SCHEMA_VERSION,
      enabled: parsed.enabled === true,
      scheduleTime: typeof parsed.scheduleTime === 'string' ? parsed.scheduleTime : '03:00',
      perSiteEnabled: parsed.perSiteEnabled && typeof parsed.perSiteEnabled === 'object'
        ? parsed.perSiteEnabled as Record<string, boolean>
        : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { schemaVersion: APP_AUTH_REFRESH_SCHEMA_VERSION, enabled: false, scheduleTime: '03:00', perSiteEnabled: {} };
}

async function loadAppAuthRefreshRunState(runStatePath: string): Promise<AppAuthRefreshRunState> {
  try {
    const parsed = JSON.parse(await readFile(runStatePath, 'utf8')) as Partial<AppAuthRefreshRunState>;
    return {
      schemaVersion: APP_AUTH_REFRESH_SCHEMA_VERSION,
      lastFullRun: typeof parsed.lastFullRun === 'string' ? parsed.lastFullRun : undefined,
      lastFullRunSummary: typeof parsed.lastFullRunSummary === 'string' ? parsed.lastFullRunSummary : undefined,
      perSite: parsed.perSite && typeof parsed.perSite === 'object'
        ? parsed.perSite as Record<string, AppAuthRefreshSiteEntry>
        : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { schemaVersion: APP_AUTH_REFRESH_SCHEMA_VERSION, perSite: {} };
}

async function saveAppAuthRefreshRunState(runStatePath: string, state: AppAuthRefreshRunState): Promise<void> {
  await mkdir(dirname(runStatePath), { recursive: true });
  await writeFile(runStatePath, `${JSON.stringify({
    schemaVersion: APP_AUTH_REFRESH_SCHEMA_VERSION,
    lastFullRun: state.lastFullRun,
    lastFullRunSummary: state.lastFullRunSummary,
    perSite: state.perSite ?? {},
  }, null, 2)}\n`, 'utf8');
}

function lastTouchedMs(entry: AuthRefreshSiteState | undefined): number | null {
  if (!entry?.last_touched_at) return null;
  const parsed = Date.parse(entry.last_touched_at);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAppTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  if (value.startsWith('@')) {
    const parsed = Number(value.slice(1));
    return Number.isFinite(parsed) ? parsed * 1000 : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAppTimestamp(date: Date): string {
  return `@${Math.floor(date.getTime() / 1000)}`;
}

function isRefreshThrottled(entry: AuthRefreshSiteState | undefined, now: Date): boolean {
  const touched = lastTouchedMs(entry);
  return touched !== null && now.getTime() - touched < AUTH_REFRESH_INTERVAL_MS;
}

function nextRefreshAt(entry: AuthRefreshSiteState | undefined): string {
  const touched = lastTouchedMs(entry);
  return touched === null ? '' : new Date(touched + AUTH_REFRESH_INTERVAL_MS).toISOString();
}

function parseScheduleTime(raw: string | undefined): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(raw ?? '03:00');
  if (!match) return { hour: 3, minute: 0 };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: 3, minute: 0 };
  }
  return { hour, minute };
}

function stableSiteJitterMs(site: string, maxMinutes: number): number {
  if (maxMinutes <= 0) return 0;
  let hash = 2166136261;
  for (const char of site) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const minutes = Math.abs(hash >>> 0) % (maxMinutes + 1);
  return minutes * 60 * 1000;
}

function scheduledDueAt(site: string, scheduleTime: string | undefined, now: Date, jitterMinutes: number): number {
  const { hour, minute } = parseScheduleTime(scheduleTime);
  const candidate = new Date(now);
  candidate.setHours(hour, minute, 0, 0);
  candidate.setTime(candidate.getTime() + stableSiteJitterMs(site, jitterMinutes));
  if (candidate.getTime() > now.getTime()) {
    candidate.setDate(candidate.getDate() - 1);
  }
  return candidate.getTime();
}

function appSiteEnabled(config: AppAuthRefreshConfig, site: string): boolean {
  const override = config.perSiteEnabled?.[site];
  return typeof override === 'boolean' ? override : config.enabled === true;
}

function appEntryToRefreshState(entry: AppAuthRefreshSiteEntry | undefined): AuthRefreshSiteState | undefined {
  if (!entry) return undefined;
  const lastTouched = parseAppTimestamp(entry.lastTouched);
  const lastAttempt = parseAppTimestamp(entry.lastAttempt);
  return {
    ...(lastTouched !== null ? { last_touched_at: new Date(lastTouched).toISOString() } : {}),
    ...(lastAttempt !== null ? { last_attempt_at: new Date(lastAttempt).toISOString() } : {}),
    ...(entry.status ? { last_status: entry.status === 'pending' ? undefined : entry.status } : {}),
  };
}

function shouldRunScheduledSite(
  site: string,
  entry: AppAuthRefreshSiteEntry | undefined,
  config: AppAuthRefreshConfig,
  now: Date,
  jitterMinutes: number,
  force: boolean,
): boolean {
  if (force) return true;
  if (entry?.status === 'unsupported') return false;
  if ((entry?.consecutiveFailures ?? 0) >= APP_AUTH_REFRESH_FAILURE_LIMIT) return false;
  const lastAttempt = parseAppTimestamp(entry?.lastAttempt);
  if (lastAttempt === null) return true;
  return lastAttempt < scheduledDueAt(site, config.scheduleTime, now, jitterMinutes);
}

function updateAppRunStateFromRefreshRow(
  runState: AppAuthRefreshRunState,
  row: AuthRefreshRow,
  now: Date,
): AppAuthRefreshSiteEntry {
  const previous = runState.perSite?.[row.site] ?? {};
  const lastAttempt = formatAppTimestamp(now);
  const success = row.status === 'touched' || row.status === 'refreshed';
  const status: AppAuthRefreshStatus = row.status === 'skipped' ? 'pending' : row.status;
  const next: AppAuthRefreshSiteEntry = {
    ...previous,
    lastAttempt,
    status,
    message: row.error || undefined,
    consecutiveFailures: row.status === 'error' ? (previous.consecutiveFailures ?? 0) + 1 : 0,
  };
  if (success) {
    next.lastTouched = lastAttempt;
  }
  if (row.status === 'not_logged_in' || row.status === 'unsupported') {
    next.consecutiveFailures = 0;
  }
  runState.perSite = { ...(runState.perSite ?? {}), [row.site]: next };
  return next;
}

function scheduledSummary(rows: AppAuthRefreshScheduledRow[]): string {
  if (rows.length === 0) return 'No due sites';
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, count]) => `${count} ${status}`).join(', ');
}

function authWhoamiCommands(): CliCommand[] {
  const seen = new Set<CliCommand>();
  return [...getRegistry().values()]
    .filter((cmd) => {
      if (seen.has(cmd)) return false;
      seen.add(cmd);
      return cmd.name === 'whoami' && cmd.browser === true && cmd.access === 'read';
    })
    .sort((a, b) => a.site.localeCompare(b.site));
}

async function loadLazyCommand(cmd: CliCommand): Promise<CliCommand> {
  const internal = cmd as InternalCliCommand;
  if (!internal._lazy || !internal._modulePath) return cmd;
  await import(pathToFileURL(internal._modulePath).href);
  return getRegistry().get(fullName(cmd)) ?? cmd;
}

function withTimeoutArg(cmd: CliCommand, timeoutSeconds: number): CliCommand {
  const hasTimeout = cmd.args.some(arg => arg.name === 'timeout');
  return {
    ...cmd,
    args: hasTimeout
      ? cmd.args
      : [...cmd.args, { name: 'timeout', type: 'int', default: timeoutSeconds, help: 'Per-site auth command timeout in seconds' }],
  };
}

function quickCheckCommand(cmd: CliCommand, timeoutSeconds: number): BrowserCliCommand | null {
  if (cmd.browser !== true || typeof cmd.authStatus?.quickCheck !== 'function') return null;
  return withTimeoutArg({
    ...cmd,
    func: cmd.authStatus.quickCheck,
    navigateBefore: false,
    siteSession: 'ephemeral',
    defaultWindowMode: 'background',
  }, timeoutSeconds) as BrowserCliCommand;
}

function normalizeQuickResult(result: unknown): boolean | null {
  if (typeof result === 'boolean') return result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const value = (result as Record<string, unknown>).logged_in;
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function safeIdentityValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function identitySummary(result: unknown): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  const row = result as Record<string, unknown>;
  const blocked = /(?:email|phone|real.?name|first.?name|last.?name|cookie|token|session|secret|password|csrf|jwt|bearer|wt2)/i;
  for (const key of ['username', 'handle', 'user_id', 'id', 'name', 'nickname', 'user_type', 'url']) {
    if (blocked.test(key)) continue;
    const value = safeIdentityValue(row[key]);
    if (value) return value;
  }
  for (const [key, raw] of Object.entries(row)) {
    if (key === 'site' || key === 'logged_in' || blocked.test(key)) continue;
    const value = safeIdentityValue(raw);
    if (value) return value;
  }
  return '';
}

function rowForError(site: string, checked: AuthStatusMode, error: unknown): AuthStatusRow {
  if (error instanceof AuthRequiredError) {
    return { site, status: 'not_logged_in', logged_in: false, identity: '', checked, error: '' };
  }
  const code = error instanceof CliError ? error.code : '';
  const message = getErrorMessage(error);
  return {
    site,
    status: 'error',
    logged_in: '',
    identity: '',
    checked,
    error: code ? `${code}: ${message}` : message,
  };
}

function refreshCommand(cmd: CliCommand, timeoutSeconds: number): BrowserCliCommand | null {
  if (cmd.browser !== true) return null;
  let refreshFunc = cmd.authStatus?.refresh;
  if (typeof refreshFunc !== 'function') {
    const quickCheck = cmd.authStatus?.quickCheck;
    if (typeof quickCheck !== 'function' || !cmd.domain) return null;
    const refreshUrl = cmd.domain.startsWith('http://') || cmd.domain.startsWith('https://')
      ? cmd.domain
      : `https://${cmd.domain}`;
    refreshFunc = async (page, kwargs, debug) => {
      await page.goto(refreshUrl);
      await page.wait(1);
      const loggedIn = normalizeQuickResult(await quickCheck(page, kwargs, debug));
      if (loggedIn !== true) {
        throw new AuthRequiredError(cmd.domain ?? cmd.site, `Auth refresh quickCheck failed for ${cmd.site}`);
      }
      return { status: 'touched' };
    };
  }
  return withTimeoutArg({
    ...cmd,
    func: refreshFunc,
    navigateBefore: false,
    siteSession: 'persistent',
    defaultWindowMode: 'background',
  }, timeoutSeconds) as BrowserCliCommand;
}

function normalizeRefreshStatus(result: unknown): 'refreshed' | 'touched' {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const row = result as Record<string, unknown>;
    if (row.status === 'refreshed' || row.refreshed === true) return 'refreshed';
  }
  return 'touched';
}

function refreshRowForError(site: string, entry: AuthRefreshSiteState | undefined, error: unknown): AuthRefreshRow {
  if (error instanceof AuthRequiredError) {
    return {
      site,
      status: 'not_logged_in',
      last_touched_at: entry?.last_touched_at ?? '',
      next_refresh_at: nextRefreshAt(entry),
      error: '',
    };
  }
  const code = error instanceof CliError ? error.code : '';
  const message = getErrorMessage(error);
  return {
    site,
    status: 'error',
    last_touched_at: entry?.last_touched_at ?? '',
    next_refresh_at: nextRefreshAt(entry),
    error: code ? `${code}: ${message}` : message,
  };
}

async function runQuick(cmd: CliCommand, opts: { timeoutSeconds: number; profile?: string }): Promise<AuthStatusRow> {
  const loaded = await loadLazyCommand(cmd);
  const quickCmd = quickCheckCommand(loaded, opts.timeoutSeconds);
  if (!quickCmd) {
    return {
      site: cmd.site,
      status: 'unknown',
      logged_in: '',
      identity: '',
      checked: 'skipped',
      error: 'quickCheck not implemented; use --full to run whoami',
    };
  }

  try {
    const result = await executeCommand(quickCmd, { timeout: opts.timeoutSeconds } as CommandArgs, false, {
      siteSession: 'ephemeral',
      keepTab: 'false',
      windowMode: 'background',
      ...(opts.profile ? { profile: opts.profile } : {}),
    });
    const loggedIn = normalizeQuickResult(result);
    if (loggedIn === true) {
      return { site: cmd.site, status: 'logged_in', logged_in: true, identity: '', checked: 'quick', error: '' };
    }
    if (loggedIn === false) {
      return { site: cmd.site, status: 'not_logged_in', logged_in: false, identity: '', checked: 'quick', error: '' };
    }
    return {
      site: cmd.site,
      status: 'unknown',
      logged_in: '',
      identity: '',
      checked: 'quick',
      error: 'quickCheck returned no boolean logged_in signal',
    };
  } catch (error) {
    return rowForError(cmd.site, 'quick', error);
  }
}

async function runFull(cmd: CliCommand, opts: { timeoutSeconds: number; profile?: string }): Promise<AuthStatusRow> {
  const loaded = await loadLazyCommand(cmd);
  const fullCmd = withTimeoutArg(loaded, opts.timeoutSeconds);
  try {
    const result = await executeCommand(fullCmd, { timeout: opts.timeoutSeconds } as CommandArgs, false, {
      siteSession: 'ephemeral',
      keepTab: 'false',
      windowMode: 'background',
      ...(opts.profile ? { profile: opts.profile } : {}),
    });
    return {
      site: cmd.site,
      status: 'logged_in',
      logged_in: true,
      identity: identitySummary(result),
      checked: 'full',
      error: '',
    };
  } catch (error) {
    return rowForError(cmd.site, 'full', error);
  }
}

async function runRefresh(cmd: CliCommand, opts: {
  timeoutSeconds: number;
  profile?: string;
  now: Date;
  state: AuthRefreshState;
  force: boolean;
}): Promise<AuthRefreshRow> {
  const existing = opts.state.sites[cmd.site];
  if (!opts.force && isRefreshThrottled(existing, opts.now)) {
    return {
      site: cmd.site,
      status: 'skipped',
      last_touched_at: existing?.last_touched_at ?? '',
      next_refresh_at: nextRefreshAt(existing),
      error: '',
    };
  }

  const attemptAt = opts.now.toISOString();
  const loaded = await loadLazyCommand(cmd);
  const refreshCmd = refreshCommand(loaded, opts.timeoutSeconds);
  if (!refreshCmd) {
    opts.state.sites[cmd.site] = { ...existing, last_attempt_at: attemptAt, last_status: 'unsupported' };
    return {
      site: cmd.site,
      status: 'unsupported',
      last_touched_at: existing?.last_touched_at ?? '',
      next_refresh_at: nextRefreshAt(existing),
      error: 'refresh probe is not available for this site',
    };
  }

  try {
    const result = await executeCommand(refreshCmd, { timeout: opts.timeoutSeconds } as CommandArgs, false, {
      siteSession: 'persistent',
      keepTab: 'true',
      windowMode: 'background',
      ...(opts.profile ? { profile: opts.profile } : {}),
    });
    const status = normalizeRefreshStatus(result);
    opts.state.sites[cmd.site] = {
      ...existing,
      last_attempt_at: attemptAt,
      last_touched_at: attemptAt,
      last_status: status,
    };
    return {
      site: cmd.site,
      status,
      last_touched_at: attemptAt,
      next_refresh_at: new Date(opts.now.getTime() + AUTH_REFRESH_INTERVAL_MS).toISOString(),
      error: '',
    };
  } catch (error) {
    const status: AuthRefreshStatus = error instanceof AuthRequiredError ? 'not_logged_in' : 'error';
    opts.state.sites[cmd.site] = { ...existing, last_attempt_at: attemptAt, last_status: status };
    return refreshRowForError(cmd.site, existing, error);
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function collectAuthStatus(options: AuthStatusOptions): Promise<AuthStatusRow[]> {
  const selectedSites = parseSiteFilter(options.sites);
  const mode: AuthStatusMode = options.full ? 'full' : 'quick';
  const concurrency = parsePositiveInt(options.concurrency, '--concurrency', mode === 'full' ? 3 : 8);
  const timeoutSeconds = parsePositiveInt(options.timeout, '--timeout', mode === 'full' ? 20 : 8);
  const only = String(options.only ?? 'all');
  if (!['all', 'logged-in', 'not-logged-in', 'unknown', 'error'].includes(only)) {
    throw new InvalidArgumentError('--only must be one of: all, logged-in, not-logged-in, unknown, error');
  }

  const commands = authWhoamiCommands().filter(cmd => !selectedSites || selectedSites.has(cmd.site));
  const rows = await mapConcurrent(commands, concurrency, cmd => (
    mode === 'full'
      ? runFull(cmd, { timeoutSeconds, profile: options.profile })
      : runQuick(cmd, { timeoutSeconds, profile: options.profile })
  ));

  const normalizedOnly = only.replace(/-/g, '_');
  return normalizedOnly === 'all'
    ? rows
    : rows.filter(row => row.status === normalizedOnly);
}

export async function collectAuthRefresh(options: AuthRefreshOptions): Promise<AuthRefreshRow[]> {
  const selectedSites = parseSiteFilter(options.sites);
  const concurrency = parsePositiveInt(options.concurrency, '--concurrency', 3);
  const timeoutSeconds = parsePositiveInt(options.timeout, '--timeout', 20);
  const statePath = options.statePath ?? defaultAuthRefreshStatePath();
  const now = options.now ?? new Date();
  const state = await loadAuthRefreshState(statePath);

  const commands = authWhoamiCommands().filter(cmd => !selectedSites || selectedSites.has(cmd.site));
  const rows = await mapConcurrent(commands, concurrency, cmd => runRefresh(cmd, {
    timeoutSeconds,
    profile: options.profile,
    now,
    state,
    force: options.all === true,
  }));
  await saveAuthRefreshState(statePath, state);
  return rows;
}

export async function collectAuthRefreshScheduled(options: AuthRefreshScheduledOptions): Promise<AppAuthRefreshScheduledRow[]> {
  const selectedSites = parseSiteFilter(options.sites);
  const timeoutSeconds = parsePositiveInt(options.timeout, '--timeout', 20);
  const jitterMinutes = parseNonNegativeInt(options.jitterMinutes, '--jitter-minutes', APP_AUTH_REFRESH_DEFAULT_JITTER_MINUTES);
  const now = options.now ?? new Date();
  const configPath = options.configPath ?? defaultAppAuthRefreshConfigPath();
  const runStatePath = options.runStatePath ?? defaultAppAuthRefreshRunStatePath();
  const config = await loadAppAuthRefreshConfig(configPath);
  const runState = await loadAppAuthRefreshRunState(runStatePath);
  runState.perSite = runState.perSite ?? {};

  const dueCommands = authWhoamiCommands()
    .filter(cmd => !selectedSites || selectedSites.has(cmd.site))
    .filter(cmd => appSiteEnabled(config, cmd.site))
    .filter(cmd => shouldRunScheduledSite(
      cmd.site,
      runState.perSite?.[cmd.site],
      config,
      now,
      jitterMinutes,
      options.all === true,
    ));

  const rows: AppAuthRefreshScheduledRow[] = [];
  const refreshState: AuthRefreshState = {
    version: AUTH_REFRESH_STATE_VERSION,
    sites: Object.fromEntries(
      Object.entries(runState.perSite ?? {}).flatMap(([site, entry]) => {
        const state = appEntryToRefreshState(entry);
        return state ? [[site, state]] : [];
      }),
    ),
  };

  for (const cmd of dueCommands) {
    const [row] = await mapConcurrent([cmd], 1, item => runRefresh(item, {
      timeoutSeconds,
      profile: options.profile,
      now,
      state: refreshState,
      force: true,
    }));
    const next = updateAppRunStateFromRefreshRow(runState, row, now);
    rows.push({
      site: row.site,
      status: next.status ?? 'pending',
      lastAttempt: next.lastAttempt ?? '',
      lastTouched: next.lastTouched ?? '',
      message: next.message ?? '',
    });
  }

  runState.lastFullRun = formatAppTimestamp(now);
  runState.lastFullRunSummary = scheduledSummary(rows);
  await saveAppAuthRefreshRunState(runStatePath, runState);
  return rows;
}

export function registerAuthCommands(program: Command): Command {
  const auth = program
    .command('auth')
    .description('Inspect website login status');

  const status = auth
    .command('status')
    .description('Show login status for sites with auth adapters')
    .option('--site <sites>', 'Comma-separated site names to check, e.g. github,chatgpt')
    .option('--full', 'Run full per-site whoami probes instead of quick no-navigation checks', false)
    .option('--concurrency <n>', 'Maximum sites to check at once')
    .option('--timeout <seconds>', 'Per-site timeout in seconds')
    .addOption(new Option('--only <status>', 'Filter rows by status').choices(['all', 'logged-in', 'not-logged-in', 'unknown', 'error']).default('all'))
    .option('-f, --format <fmt>', 'Output format: table, plain, json, yaml, md, csv', 'table')
    .action(async (opts) => {
      const globals = typeof status.optsWithGlobals === 'function' ? status.optsWithGlobals() as Record<string, unknown> : {};
      const rows = await collectAuthStatus({
        sites: opts.site,
        full: opts.full === true,
        concurrency: opts.concurrency,
        timeout: opts.timeout,
        only: opts.only,
        profile: typeof globals.profile === 'string' && globals.profile.trim() ? globals.profile.trim() : undefined,
      });
      const fmt = typeof opts.format === 'string' ? opts.format : 'table';
      renderOutput(rows, {
        fmt,
        fmtExplicit: status.getOptionValueSource('format') === 'cli',
        columns: ['site', 'status', 'identity', 'checked', 'error'],
        title: 'opencli/auth status',
        source: opts.full ? 'full whoami probe' : 'quick auth check',
      });
    });

  const refresh = auth
    .command('refresh')
    .description('Touch logged-in site sessions to keep browser auth fresh')
    .option('--site <sites>', 'Comma-separated site names to refresh, e.g. github,claude')
    .option('--all', 'Ignore the 24h refresh throttle and force every selected site', false)
    .option('--concurrency <n>', 'Maximum sites to refresh at once')
    .option('--timeout <seconds>', 'Per-site timeout in seconds')
    .option('-f, --format <fmt>', 'Output format: table, plain, json, yaml, md, csv', 'table')
    .action(async (opts) => {
      const globals = typeof refresh.optsWithGlobals === 'function' ? refresh.optsWithGlobals() as Record<string, unknown> : {};
      const rows = await collectAuthRefresh({
        sites: opts.site,
        all: opts.all === true,
        concurrency: opts.concurrency,
        timeout: opts.timeout,
        profile: typeof globals.profile === 'string' && globals.profile.trim() ? globals.profile.trim() : undefined,
      });
      const fmt = typeof opts.format === 'string' ? opts.format : 'table';
      renderOutput(rows, {
        fmt,
        fmtExplicit: refresh.getOptionValueSource('format') === 'cli',
        columns: ['site', 'status', 'last_touched_at', 'next_refresh_at', 'error'],
        title: 'opencli/auth refresh',
        source: opts.all ? 'forced persistent touch' : 'persistent touch with 24h throttle',
      });
    });

  const refreshScheduled = auth
    .command('refresh-scheduled')
    .description('Run due App-scheduled auth refresh jobs')
    .option('--site <sites>', 'Comma-separated site names to consider')
    .option('--all', 'Ignore schedule/backoff and run every enabled selected site', false)
    .option('--timeout <seconds>', 'Per-site timeout in seconds')
    .option('--config-path <path>', 'Path to OpenCLI App auth-refresh-config.json')
    .option('--run-state-path <path>', 'Path to OpenCLI App auth-refresh-state.json')
    .option('--jitter-minutes <minutes>', 'Maximum stable per-site schedule jitter in minutes')
    .option('-f, --format <fmt>', 'Output format: table, plain, json, yaml, md, csv', 'table')
    .action(async (opts) => {
      const globals = typeof refreshScheduled.optsWithGlobals === 'function' ? refreshScheduled.optsWithGlobals() as Record<string, unknown> : {};
      const rows = await collectAuthRefreshScheduled({
        sites: opts.site,
        all: opts.all === true,
        timeout: opts.timeout,
        configPath: typeof opts.configPath === 'string' ? opts.configPath : undefined,
        runStatePath: typeof opts.runStatePath === 'string' ? opts.runStatePath : undefined,
        jitterMinutes: opts.jitterMinutes,
        profile: typeof globals.profile === 'string' && globals.profile.trim() ? globals.profile.trim() : undefined,
      });
      const fmt = typeof opts.format === 'string' ? opts.format : 'table';
      renderOutput(rows, {
        fmt,
        fmtExplicit: refreshScheduled.getOptionValueSource('format') === 'cli',
        columns: ['site', 'status', 'lastAttempt', 'lastTouched', 'message'],
        title: 'opencli/auth refresh-scheduled',
        source: opts.all ? 'forced app scheduler' : 'app scheduler due sites',
      });
    });

  return auth;
}
