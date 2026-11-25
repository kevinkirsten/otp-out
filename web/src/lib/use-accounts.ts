import * as React from "react";
import { addBatch, type Collection, emptyCollection, missingParts } from "./collect";
import type { MigrationBatch, OtpAccount } from "./migration";
import { buildOtpauthUri } from "./otpauth";

export interface AccountView {
  /** Número sequencial, só para a chave do React. Não deriva do segredo. */
  id: number;
  account: OtpAccount;
  uri: string | null;
}

interface State {
  collection: Collection;
  views: AccountView[];
}

let nextId = 1;

function cloneCollection(c: Collection): Collection {
  return {
    accounts: [...c.accounts],
    seen: new Set(c.seen),
    batches: new Map([...c.batches].map(([id, b]) => [id, { size: b.size, indexes: new Set(b.indexes) }])),
  };
}

/** Contas só em memória (estado do React). Nada vai para storage, URL ou log. */
export function useAccounts() {
  const [state, setState] = React.useState<State>(() => ({ collection: emptyCollection(), views: [] }));
  // Cópia síncrona do estado, para saber quantas contas entraram sem esperar o render.
  const latest = React.useRef(state);

  const add = React.useCallback((batches: MigrationBatch[]): number => {
    const collection = cloneCollection(latest.current.collection);
    const before = collection.accounts.length;
    let added = 0;
    for (const batch of batches) added += addBatch(collection, batch);
    const views = [
      ...latest.current.views,
      ...collection.accounts.slice(before).map((account) => ({ id: nextId++, account, uri: buildOtpauthUri(account) })),
    ];
    latest.current = { collection, views };
    setState(latest.current);
    return added;
  }, []);

  const clear = React.useCallback(() => {
    // Zera os bytes dos segredos antes de soltar as referências.
    for (const view of latest.current.views) view.account.secret.fill(0);
    latest.current = { collection: emptyCollection(), views: [] };
    setState(latest.current);
  }, []);

  const missing = React.useMemo(() => missingParts(state.collection), [state.collection]);
  return { accounts: state.views, missing, add, clear, batches: state.collection.batches };
}
