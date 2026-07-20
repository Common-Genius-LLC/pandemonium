// A ReactiveController that any component can attach (`new StoreController(this)`
// in the constructor, no decorators) to get the shared PandemoniumStore
// delivered through Lit Context and to have `requestUpdate()` called
// automatically whenever the store changes. Components read `controller.project`
// / `controller.ui` in render() and call `controller.store.someAction(...)`
// to mutate; they never hold their own copy of app state.
//
// Do not use this on pandemonium-app itself: @lit/context's ContextProvider
// deliberately refuses to satisfy a context-request dispatched by its own
// host element (it exists to prevent a provider from self-registering as
// its own consumer), so a StoreController on the same element that hosts
// the ContextProvider silently never resolves. pandemonium-app already
// holds the store instance directly (it created it) and should read/listen
// to that directly instead.
'use strict';

import { ContextConsumer } from '@lit/context';
import { storeContext } from './context.js';

export class StoreController {
  #host;
  #consumer;
  #boundOnChange;

  constructor(host) {
    this.#host = host;
    this.#boundOnChange = () => host.requestUpdate();
    this.#consumer = new ContextConsumer(host, {
      context: storeContext,
      subscribe: true,
      callback: (store, unsubscribe) => this.#onStore(store, unsubscribe),
    });
    host.addController(this);
  }

  #currentStore = null;

  #onStore(store, unsubscribe) {
    if (this.#currentStore === store) return;
    if (this.#currentStore) this.#currentStore.removeEventListener('change', this.#boundOnChange);
    this.#currentStore = store;
    if (store) store.addEventListener('change', this.#boundOnChange);
    this.#host.requestUpdate();
  }

  hostDisconnected() {
    if (this.#currentStore) this.#currentStore.removeEventListener('change', this.#boundOnChange);
  }

  get store() { return this.#consumer.value; }
  get project() { return this.store ? this.store.project : null; }
  get ui() { return this.store ? this.store.ui : null; }
}
