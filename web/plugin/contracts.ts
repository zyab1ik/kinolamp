// Type-only contracts for the subset of KinoPub and legacy Lampa used here.
// Optional runtime feature checks remain necessary on older TV installations.
import type { createClient } from './client.js';
import type { createUi } from './ui.js';
import type { createProgress } from './progress.js';
import type { createDiagnostics } from './diagnostics.js';
import type { createAuthorization } from './authorization.js';
import type { createNativePages } from './pages.js';
import type { createPlayback } from './playback.js';
import type { createCatalog } from './catalog.js';
import type { createPlayerDiagnostics } from './player-diagnostics.js';

export type Id = string | number;
export type Action = () => void;
export type Params = Record<string, string | number | boolean | undefined>;
export type Client = ReturnType<typeof createClient>;
export type Ui = ReturnType<typeof createUi>;
export type Progress = ReturnType<typeof createProgress>;
export type Diagnostics = ReturnType<typeof createDiagnostics>;
export type Authorization = ReturnType<typeof createAuthorization>;
export type Pages = NonNullable<ReturnType<typeof createNativePages>>;
export type Playback = ReturnType<typeof createPlayback>;
export type Catalog = ReturnType<typeof createCatalog>;
export type PlayerDiagnostics = ReturnType<typeof createPlayerDiagnostics>;
export interface PluginError {
  code?: string;
  status?: number;
}
// Lampa supplies data only on success. After checking error, callbacks may use
// a non-null assertion: the transport guarantees an object on its success path.
export type Reply<T> = (error: PluginError | null, data?: T) => void;
export interface Named {
  id?: Id;
  title?: string;
  short_title?: string;
}
export interface Audio {
  index?: number;
  lang?: string;
  type?: Named;
  author?: Named;
  codec?: string;
}
export interface File {
  quality?: Id;
  h?: Id;
  urls?: Record<string, string>;
  url?: Record<string, string>;
}
export interface Subtitle {
  lang?: string;
  url?: string;
}
export interface Video {
  id?: Id;
  media_id?: Id;
  title?: string;
  number?: number;
  duration?: number;
  thumbnail?: string;
  files?: File[];
  audios?: Audio[];
  subtitles?: Subtitle[];
}
export interface Season {
  number?: number;
  title?: string;
  episodes?: Video[];
  poster?: string;
  posters?: Posters;
}
export interface Posters {
  big?: string;
  medium?: string;
  small?: string;
}
export interface Item {
  id: Id;
  title: string;
  type?: string;
  year?: Id;
  imdb?: Id;
  imdb_rating?: Id;
  quality?: Id;
  ac3?: Id;
  count?: Id;
  plot?: string;
  posters?: Posters;
  genres?: Named[];
  countries?: Named[];
  seasons?: Season[];
  videos?: Video[];
}
export interface Movie {
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  year?: Id;
  imdb_id?: Id;
  media_type?: string;
}
export interface ApiResponse extends Video {
  ok?: boolean;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  code?: string;
  user_code?: string;
  verification_uri?: string;
  interval?: number;
  expires_in?: number;
  item?: Item;
  items?: Item[];
  folder?: Item;
  folders?: Item[];
  pagination?: { total?: number };
  url?: string;
}
export type Transport = (
  method: string,
  url: string,
  body: string | null,
  headers: Record<string, string>,
  done: Reply<ApiResponse>
) => void;
export interface Store {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}
export interface Settings {
  access: string;
  refresh: string;
  quality: string | number;
  proxy_enabled: string | boolean;
  proxy_url: string;
  proxy_token: string;
}
export interface ProgressRecord {
  time: number;
  duration: number;
  watched: boolean;
  updated: number;
}
export interface Context {
  kind: string;
  season: number;
  number: number;
}
export interface Stream {
  url: string;
  height: number;
  format: string;
}
export interface PlaybackState {
  key: string;
  time: number;
  context: Context;
  voice: string;
  height?: number;
  mode?: string;
  format?: string;
  preparedAt?: number;
  audios?: Audio[];
  selectedAudio?: Audio;
  accept?: (work: Work, state: PlaybackState) => void;
}
export interface Transition {
  height: number;
  voice: string;
  valid: () => boolean;
  fail: Action;
  accept: (work: Work, state: PlaybackState) => void;
}
export interface PlayOptions {
  automatic?: boolean;
  transition?: Transition;
}
export type OpenVideo = (
  item: Item,
  video: Video,
  back: Action | null,
  context: Context,
  options?: PlayOptions
) => void;
export interface QueueEntry {
  video: Video;
  context: Context;
}
export interface QueueOwner {
  id: number;
  height?: number;
  voice: string;
  current: Work;
  video: Video;
  loading: boolean;
  entries?: Work[];
}
export interface Track {
  language?: string;
  lang?: string;
  extra?: unknown;
  enabled?: boolean;
  selected?: boolean;
}
export interface TrackLabel {
  name: string;
  extra?: unknown;
}
export interface DiagnosticData {
  [key: string]: string | number | boolean | undefined;
  event?: string;
  at?: number;
  mode?: string;
  format?: string;
  requested?: number;
  current?: number;
  readyState?: number;
  width?: number;
  height?: number;
  path?: string;
  nativeHls?: boolean;
  buffer?: number;
  result?: string;
  ms?: number;
  status?: number;
  detail?: string;
  fatal?: boolean;
}
export interface Work {
  [key: string]: unknown;
  title?: string;
  url?: string | ((ready: Action) => void);
  quality?: Record<string, string>;
  season?: number;
  episode?: number;
  subtitles?: { label: string; language: string; url: string }[];
  translate?: { tracks?: (TrackLabel | null)[] };
  _kinolampAudios?: Audio[];
  _kinolampProgress?: { key: string; time: number };
  _kinolampDiagnostic?: DiagnosticData;
  _kinolampQueueId?: number;
  _kinolampLoad?: (ready: Action) => void;
  timeline?: {
    time: number;
    duration: number;
    percent: number;
    handler: (percent: number, time: number, duration: number) => void;
  };
}
export interface PlayerEvent extends Work {
  current?: number;
  duration?: number;
  error?: string;
  fatal?: boolean;
  tracks?: Track[];
}
export interface Listener<T> {
  follow(name: string, callback: (event: T) => void): void;
}
export interface MenuEntry {
  title?: string;
  subtitle?: string;
  run: Action;
}
export interface Route {
  [key: string]: string | number | undefined;
  component?: string;
  title?: string;
  kp_view?: string;
  kp_query?: string;
  kp_id?: Id;
  kp_season?: number;
  kp_section?: string;
  kp_page?: number;
  kp_genre?: Id;
  kp_genre_title?: string;
  kp_quality?: Id;
  kp_quality_title?: string;
  kp_sort?: string;
  kp_folder?: Id;
}
export interface PageRoute {
  [key: string]: string | number | undefined;
  view: string;
  query?: string;
  id?: Id;
  season?: number;
  section?: string;
  page?: number;
  genre?: Id;
  genreTitle?: string;
  quality?: Id;
  qualityTitle?: string;
  sort?: string;
  folder?: Id;
}
export interface Row {
  key?: string;
  title?: string;
  original?: string;
  badges?: string[];
  rating?: string;
  subtitle?: string | (() => string);
  symbol?: string;
  poster?: string;
  menu?: Action;
  next?: PageRoute;
  item?: Item;
  video?: Video;
  context?: Context;
}
export interface PageData {
  title: string;
  rows: Row[];
  actions?: MenuEntry[];
  details?: string;
  description?: string;
  layout?: string;
  hint?: string;
  empty?: string;
  isStale?: () => boolean;
  more?: LoadMore | null;
}
export type PageReply = (error: string | null, data?: PageData) => void;
export type LoadMore = (done: PageReply) => void;
export type PageLoader = (route: Route, done: PageReply) => void;
export interface JQueryNode {
  [index: number]: HTMLElement;
  length: number;
  append(child: JQueryNode): this;
  empty(): this;
  remove(): this;
  hide(): this;
  removeClass(name: string): this;
  attr(name: string, value: unknown): this;
  text(): string;
  text(value: unknown): this;
  on(name: string, callback: (this: HTMLElement) => void): this;
  unbind(name: string): this;
  find(selector: string): JQueryNode;
  first(): JQueryNode;
  not(selector: string): JQueryNode;
  each(callback: (this: HTMLElement) => void): this;
  trigger(event: string): this;
}
export type JQuery = (input: unknown) => JQueryNode;
export interface NativePage {
  activity: {
    loader(show: boolean): void;
    toggle(): void;
    render(): JQueryNode;
  };
  create: Action;
  start: Action;
  render: () => JQueryNode;
  pause: Action;
  stop: Action;
  destroy: Action;
}
export interface Navigator {
  canmove(direction: string): boolean;
  move(direction: string): void;
}
export interface StartButton {
  html: JQueryNode;
  use(module: { onGroupButtons: (this: StartButton) => void }): void;
}
export interface AppEvent {
  type?: string;
  data?: { movie?: Movie };
  object?: { activity?: { render(): JQueryNode } };
  link?: { items?: StartButton[] };
}
export interface Metadata {
  tv_results?: { id?: Id }[];
  seasons?: { season_number?: number; poster_path?: string }[];
}
export interface Lampa {
  Storage: Store;
  Reguest: new () => {
    timeout(ms: number): void;
    silent(
      url: string,
      done: (json: unknown) => void,
      fail: (xhr: { status?: number; responseText?: string }) => void,
      body: string | null | false,
      options: { headers: Record<string, string> }
    ): void;
  };
  Noty: { show(message: string): void };
  Controller: {
    toggle(name: string): void;
    enabled(): { name?: string } | null;
    add(name: string, handlers: Record<string, Action>): void;
    collectionSet(view: JQueryNode): void;
    collectionFocus(element: HTMLElement | false, view: JQueryNode): void;
  };
  Select: {
    show(options: {
      title: string;
      items: MenuEntry[];
      onSelect: (item: MenuEntry) => void;
      onBack: Action;
    }): void;
  };
  Modal: {
    open(options: {
      title: string;
      html: JQueryNode;
      size?: string;
      onBack: Action;
    }): void;
    close(): void;
  };
  Settings: {
    update(): void;
    create(name: string, options?: { onBack: Action }): void;
  };
  SettingsApi: {
    addComponent(component: {
      component: string;
      name: string;
      icon: string;
    }): void;
    addParam(param: SettingParam): void;
  };
  Template: { add(name: string, html: string): void };
  Platform: { get(): string };
  Listener: Listener<AppEvent>;
  Player: {
    listener: Listener<Work>;
    play(work: Work): void;
    playlist(entries: Work[]): void;
    close(): void;
  };
  PlayerVideo: {
    listener: Listener<PlayerEvent>;
    to(time: number): void;
    video(): HTMLVideoElement | null;
  };
  PlayerInfo: { set(name: string, value: string): void };
  PlayerPanel: { setTranslate(value: NonNullable<Work['translate']>): void };
  Component: {
    add(
      name: string,
      component: (this: NativePage, route: Route) => void
    ): void;
  };
  Activity: { push(route: Route): void; backward(): void };
  Scroll: new (options: { mask: boolean; over: boolean }) => {
    append(node: JQueryNode): void;
    render(): JQueryNode;
    update(node: JQueryNode, focus: boolean): void;
    destroy(): void;
    onEnd?: Action;
  };
  Menu: { addButton(icon: string, title: string, run: Action): JQueryNode };
  Input: {
    edit(
      options: {
        title: string;
        value: string;
        free: boolean;
        nosave: boolean;
        nomic: boolean;
      },
      done: (value: string) => void
    ): void;
  };
  Api: {
    sources: {
      tmdb: {
        get(
          path: string,
          params: Params,
          done: (data: Metadata) => void,
          fail: Action,
          cache: { life: number }
        ): void;
      };
    };
  };
  TMDB: { image(path: string): string };
  Manifest: {
    plugins?: {
      type: string;
      name: string;
      version: string;
      description: string;
    };
  };
  Plugins: {
    get(): { url?: string; name?: string; author?: string; descr?: string }[];
    save(): void;
  };
}
export interface SettingParam {
  component: string;
  param: {
    name: string;
    type: string;
    placeholder?: string;
    values?: Record<string, string> | string;
    default?: string | boolean;
  };
  field: { name: string; description?: string };
  onChange: Action;
  onRender?: (item: JQueryNode) => void;
}
export type Setting = (
  key: string,
  type: string,
  name: string,
  description: string,
  values: Record<string, string> | string,
  initial: string | boolean,
  advanced?: string | boolean
) => void;
export type SettingAction = (
  key: string,
  name: string,
  run: Action,
  advanced?: string | boolean
) => void;
export interface Root {
  document?: Document;
  XMLHttpRequest?: typeof XMLHttpRequest;
  Navigator?: Navigator;
  appready?: boolean;
}
export interface PlaybackDependencies {
  client: Client;
  transport: Transport;
  pages: Pages | null;
  progress: Progress;
  diagnostics: Diagnostics;
  recordSource: (url: string) => void;
  authorization: Authorization;
  ui: Ui;
}

export interface DiagnosticsReport {
  schema: number;
  version: string;
  enabled: boolean;
  scope: string;
  events: DiagnosticData[];
}
