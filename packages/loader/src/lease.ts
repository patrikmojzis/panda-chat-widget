/**
 * Realm-shared, document-keyed widget lease.
 * At most one widget generation may mount per Document.
 * Shared across ESM and classic artifacts in the same realm via a global Symbol registry key.
 */

const LEASE_KEY = Symbol.for('__panda_chat_widget_lease__');

interface LeaseRegistry {
  owners: WeakMap<Document, { instance: object; generation: number }>;
}

function getRegistry(): LeaseRegistry {
  const g = globalThis as Record<symbol, LeaseRegistry | undefined>;
  let registry = g[LEASE_KEY];

  if (!registry) {
    registry = { owners: new WeakMap() };
    g[LEASE_KEY] = registry;
  }

  return registry;
}

export function acquireLease(doc: Document, instance: object, generation: number): boolean {
  const registry = getRegistry();
  const current = registry.owners.get(doc);

  if (current && current.instance !== instance) {
    return false;
  }

  registry.owners.set(doc, { instance, generation });

  return true;
}

export function releaseLease(doc: Document, instance: object, generation: number): void {
  const registry = getRegistry();
  const current = registry.owners.get(doc);

  if (current && current.instance === instance && current.generation === generation) {
    registry.owners.delete(doc);
  }
}

export function getLeaseOwner(doc: Document): object | null {
  const registry = getRegistry();
  const current = registry.owners.get(doc);

  return current ? current.instance : null;
}
