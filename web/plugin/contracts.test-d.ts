// Compile-time regression checks only: this file emits no JavaScript.
import type {
  Audio,
  Client,
  Lampa,
  PageRoute,
  Params,
  Reply,
  Transport,
  Work
} from './contracts.js';
type IsAny<T> = 0 extends 1 & T ? true : false;
type ExpectFalse<T extends false> = T;
export type ContractChecks = [
  ExpectFalse<IsAny<Parameters<Transport>[4]>>,
  ExpectFalse<IsAny<Parameters<Reply<Work>>[1]>>,
  ExpectFalse<IsAny<Parameters<Lampa['Player']['play']>[0]>>,
  ExpectFalse<IsAny<ReturnType<Client['get']>>>,
  ExpectFalse<{ index: string } extends Audio ? true : false>,
  ExpectFalse<{ url: number } extends Work ? true : false>,
  ExpectFalse<{ token: { private: string } } extends Params ? true : false>,
  ExpectFalse<{ view: string; id: object } extends PageRoute ? true : false>,
  ExpectFalse<
    'unknown_setting' extends Parameters<Client['get']>[0] ? true : false
  >
];
