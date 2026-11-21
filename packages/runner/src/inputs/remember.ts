import type { RememberedAnswer, Store } from "../storage.ts";

export function rememberStore(store: Store) {
  return {
    save: (row: RememberedAnswer) => store.putRemembered(row),
    read: (flowId: string) => store.listRemembered(flowId),
    delete: (flowId: string, kind: RememberedAnswer["kind"], inputId: string) =>
      store.deleteRemembered(flowId, kind, inputId),
  };
}
