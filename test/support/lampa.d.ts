// Contracts of the JavaScript test harness and collection fixtures.
export interface MockItem {
  id: string | number;
  title: string;
  type?: string;
  year?: number;
  watchers?: number;
  views?: number;
  posters?: { big?: string; medium?: string; small?: string };
  videos?: object[];
}
export interface MockRoute {
  [key: string]: string | number | undefined;
}
export interface MockReply {
  items?: MockItem[];
  item?: MockItem;
  collection?: MockItem;
  pagination?: { total: number };
  failure?: boolean;
  xhr?: { status: number; responseText: string };
}

export interface MockRequest {
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
  catalogMenu?: boolean;
  respond?: (request: MockRequest) => MockReply;
}): Harness;
export function video(overrides?: object): object;
