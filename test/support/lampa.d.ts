// Contracts of the JavaScript test harness and collection fixtures.
export interface MockItem {
  id: string | number;
  title: string;
  type?: string;
  year?: number;
  watchers?: number | string;
  count?: number | string;
  views?: number | string;
  posters?: { big?: string; medium?: string; small?: string };
  videos?: object[];
}
export interface MockRoute {
  [key: string]: string | number | undefined;
}
export interface MockReply {
  categories?: { id: string; title: string; items: MockItem[] }[];
  defer?: boolean;
  items?: MockItem[];
  item?: MockItem;
  collection?: MockItem;
  pagination?: { total: number };
  failure?: boolean;
  xhr?: { status: number; responseText: string };
}

export interface MockRequest {
  success(reply: MockReply): void;
  url: string;
  body: string | null;
  headers: Record<string, string>;
}
export interface MockNode {
  value: string;
  input: string;
  attributes?: Record<string, string>;
  children: MockNode[];
  handlers: Record<string, () => void>;
}
export interface Harness {
  Lampa: { Activity: { push(route: MockRoute): void; backward(): void } };
  menuButton: { run(): void };
  routes: MockRoute[];
  requests: MockRequest[];
  callbacks: MockRequest[];
  action(name: string): void;
  nodes: MockNode[];
  plays: unknown[];
  scrolls: { onEnd(): void }[];
  respond(request: MockRequest): MockReply;
  pageCards(): MockNode[];
  pageActions(): MockNode[];
  pageAction(title: string): void;
  openCard(index: number): void;
}
export function harness(options: {
  native?: boolean;
  root?: { document?: { currentScript?: { src: string } | null } };
  catalogMenu?: boolean;
  respond?: (request: MockRequest) => MockReply;
}): Harness;
export function video(overrides?: object): object;
