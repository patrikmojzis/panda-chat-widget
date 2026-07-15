import assert from 'node:assert/strict';
import test from 'node:test';

const { createWidgetInstance, getLeaseOwner } = await import('../../../.cache/loader-test-core/core-harness.js');

function createDocument(origin = 'https://host.example') {
  return { location: { origin } };
}

function createDeferredDrivers() {
  const records = [];

  function factory() {
    const record = {
      callbacks: null,
      destroyCount: 0,
      mountCount: 0,
      visibility: [],
      mount(doc, publicKey, baseUrl, launcher, callbacks) {
        record.mountCount++;
        record.doc = doc;
        record.publicKey = publicKey;
        record.baseUrl = baseUrl;
        record.launcher = launcher;
        record.callbacks = callbacks;
      },
      setVisibility(open) { record.visibility.push(open); },
      destroy() { record.destroyCount++; },
      ready() { record.callbacks?.onReady(); },
      error() { record.callbacks?.onError(); },
      intent(open) { record.callbacks?.onVisibilityIntent(open); },
    };
    records.push(record);
    return record;
  }

  return { factory, records };
}

function createHarness() {
  const document = createDocument();
  const drivers = createDeferredDrivers();
  const widget = createWidgetInstance(drivers.factory, () => document);
  return { document, drivers: drivers.records, widget };
}

function rejection(promise) {
  return promise.then(
    () => assert.fail('expected rejection'),
    (error) => error,
  );
}

test('two subscribers observe ready then nested destroy and re-init in FIFO order', async () => {
  const { drivers, widget } = createHarness();
  const observerTrace = [];
  const synchronousReads = [];
  let secondPromise;
  let reentered = false;

  widget.subscribe((snapshot) => {
    if (snapshot.lifecycle === 'ready' && !reentered) {
      reentered = true;
      widget.destroy();
      synchronousReads.push(widget.getState().lifecycle);
      secondPromise = widget.init({ publicKey: 'second' });
      synchronousReads.push(widget.getState().lifecycle);
    }
  });
  widget.subscribe((snapshot) => {
    observerTrace.push(snapshot.lifecycle);
  });

  const firstPromise = widget.init({ publicKey: 'first' });
  drivers[0].ready();
  assert.equal((await firstPromise).lifecycle, 'ready');
  assert.deepEqual(observerTrace, ['idle', 'initializing', 'ready', 'destroyed', 'initializing']);
  assert.deepEqual(synchronousReads, ['destroyed', 'initializing']);

  drivers[1].ready();
  assert.equal((await secondPromise).lifecycle, 'ready');
  assert.deepEqual(observerTrace, ['idle', 'initializing', 'ready', 'destroyed', 'initializing', 'ready']);
  widget.destroy();
});

test('two subscribers observe error then nested retry in FIFO order', async () => {
  const { drivers, widget } = createHarness();
  const observerTrace = [];
  const synchronousReads = [];
  let secondPromise;

  widget.subscribe((snapshot) => {
    if (snapshot.lifecycle === 'error' && !secondPromise) {
      secondPromise = widget.init({ publicKey: 'second' });
      synchronousReads.push(widget.getState().lifecycle);
    }
  });
  widget.subscribe((snapshot) => {
    observerTrace.push(`${snapshot.lifecycle}:${snapshot.error?.code ?? 'none'}`);
  });

  const firstPromise = widget.init({ publicKey: 'first' });
  const firstResult = rejection(firstPromise);
  drivers[0].error();
  assert.equal((await firstResult).code, 'IFRAME_LOAD_FAILED');
  assert.deepEqual(observerTrace, [
    'idle:none',
    'initializing:none',
    'error:IFRAME_LOAD_FAILED',
    'initializing:none',
  ]);
  assert.deepEqual(synchronousReads, ['initializing']);

  drivers[1].ready();
  assert.equal((await secondPromise).lifecycle, 'ready');
  assert.deepEqual(observerTrace, [
    'idle:none',
    'initializing:none',
    'error:IFRAME_LOAD_FAILED',
    'initializing:none',
    'ready:none',
  ]);
  widget.destroy();
});

test('two subscribers observe initializing before nested destroy and re-init', async () => {
  const { drivers, widget } = createHarness();
  const observerTrace = [];
  const synchronousReads = [];
  let secondPromise;
  let reentered = false;

  widget.subscribe((snapshot) => {
    if (snapshot.lifecycle === 'initializing' && !reentered) {
      reentered = true;
      widget.destroy();
      synchronousReads.push(widget.getState().lifecycle);
      secondPromise = widget.init({ publicKey: 'second' });
      synchronousReads.push(widget.getState().lifecycle);
    }
  });
  widget.subscribe((snapshot) => {
    observerTrace.push(snapshot.lifecycle);
  });

  const firstPromise = widget.init({ publicKey: 'first' });
  assert.equal((await rejection(firstPromise)).code, 'DESTROYED');
  assert.deepEqual(observerTrace, ['idle', 'initializing', 'destroyed', 'initializing']);
  assert.deepEqual(synchronousReads, ['destroyed', 'initializing']);
  assert.equal(drivers.length, 1, 'the destroyed outer generation never mounts');

  drivers[0].ready();
  assert.equal((await secondPromise).lifecycle, 'ready');
  assert.deepEqual(observerTrace, ['idle', 'initializing', 'destroyed', 'initializing', 'ready']);
  widget.destroy();
});

test('synchronous open exposes committed visibility while publications remain FIFO', async () => {
  const { drivers, widget } = createHarness();
  const observerTrace = [];
  const synchronousReads = [];
  let opened = false;

  widget.subscribe((snapshot) => {
    if (snapshot.lifecycle === 'ready' && !opened) {
      opened = true;
      widget.open();
      synchronousReads.push(widget.getState().visibility);
    }
  });
  widget.subscribe((snapshot) => {
    observerTrace.push(`${snapshot.lifecycle}:${snapshot.visibility}`);
  });

  const promise = widget.init({ publicKey: 'key' });
  drivers[0].ready();
  await promise;
  assert.deepEqual(synchronousReads, ['open']);
  assert.deepEqual(observerTrace, [
    'idle:closed',
    'initializing:closed',
    'ready:closed',
    'ready:open',
  ]);
  widget.destroy();
});

test('listener added during ordinary delivery initializes once from committed state', async () => {
  const { widget } = createHarness();
  const lateTrace = [];
  let added = false;

  widget.subscribe((snapshot) => {
    if (snapshot.lifecycle === 'initializing' && !added) {
      added = true;
      widget.subscribe((lateSnapshot) => lateTrace.push(lateSnapshot.lifecycle));
    }
  });

  const promise = widget.init({ publicKey: 'key' });
  assert.deepEqual(lateTrace, ['initializing']);
  widget.destroy();
  await rejection(promise);
  assert.deepEqual(lateTrace, ['initializing', 'destroyed']);
});

test('listener added after nested queued publications skips those older snapshots', async () => {
  const { drivers, widget } = createHarness();
  const lateTrace = [];
  let secondPromise;
  let added = false;

  widget.subscribe((snapshot) => {
    if (snapshot.lifecycle === 'ready' && !added) {
      added = true;
      widget.destroy();
      secondPromise = widget.init({ publicKey: 'second' });
      widget.subscribe((lateSnapshot) => lateTrace.push(lateSnapshot.lifecycle));
    }
  });

  const firstPromise = widget.init({ publicKey: 'first' });
  drivers[0].ready();
  await firstPromise;
  assert.deepEqual(lateTrace, ['initializing']);

  drivers[1].ready();
  await secondPromise;
  assert.deepEqual(lateTrace, ['initializing', 'ready']);
  widget.destroy();
  assert.deepEqual(lateTrace, ['initializing', 'ready', 'destroyed']);
});

test('unsubscribe and resubscribe of the same callback cannot revive an older publication', async () => {
  const { drivers, widget } = createHarness();
  const callbackTrace = [];
  const callback = (snapshot) => callbackTrace.push(snapshot.lifecycle);
  let oldUnsubscribe;
  let newUnsubscribe;
  let secondPromise;
  let reentered = false;

  widget.subscribe((snapshot) => {
    if (snapshot.lifecycle === 'ready' && !reentered) {
      reentered = true;
      oldUnsubscribe();
      widget.destroy();
      newUnsubscribe = widget.subscribe(callback);
      secondPromise = widget.init({ publicKey: 'second' });
    }
  });
  oldUnsubscribe = widget.subscribe(callback);

  const firstPromise = widget.init({ publicKey: 'first' });
  callbackTrace.length = 0;
  drivers[0].ready();
  assert.equal((await firstPromise).lifecycle, 'ready');
  assert.notEqual(newUnsubscribe, oldUnsubscribe);
  assert.deepEqual(callbackTrace, ['destroyed', 'initializing']);

  drivers[1].ready();
  assert.equal((await secondPromise).lifecycle, 'ready');
  assert.deepEqual(callbackTrace, ['destroyed', 'initializing', 'ready']);

  oldUnsubscribe();
  widget.open();
  assert.deepEqual(callbackTrace, ['destroyed', 'initializing', 'ready', 'ready']);
  newUnsubscribe();
  widget.destroy();
  assert.deepEqual(callbackTrace, ['destroyed', 'initializing', 'ready', 'ready']);
});

test('error subscriber retry settles only its captured generation', async () => {
  const { document, drivers, widget } = createHarness();
  const trace = [];
  let secondPromise;

  widget.subscribe((state) => {
    trace.push(`${state.lifecycle}:${state.error?.code ?? 'none'}`);
    if (state.lifecycle === 'error' && state.error?.code === 'IFRAME_LOAD_FAILED' && !secondPromise) {
      secondPromise = widget.init({ publicKey: 'second' });
    }
  });

  const firstPromise = widget.init({ publicKey: 'first' });
  const firstResult = rejection(firstPromise);
  drivers[0].error();

  assert.equal((await firstResult).code, 'IFRAME_LOAD_FAILED');
  assert.equal(widget.getState().lifecycle, 'initializing');
  assert.equal(drivers.length, 2);
  assert.equal(drivers[0].destroyCount, 1);
  assert.equal(drivers[1].mountCount, 1);
  assert.equal(getLeaseOwner(document), widget);

  drivers[1].ready();
  const ready = await secondPromise;
  assert.equal(ready, widget.getState());
  assert.equal(ready.lifecycle, 'ready');
  assert.deepEqual(trace, [
    'idle:none',
    'initializing:none',
    'error:IFRAME_LOAD_FAILED',
    'initializing:none',
    'ready:none',
  ]);
  widget.destroy();
  assert.equal(getLeaseOwner(document), null);
});

test('ready subscriber destroy and re-init preserves the first ready result', async () => {
  const { document, drivers, widget } = createHarness();
  let firstReadySnapshot;
  let secondPromise;
  let reentered = false;

  widget.subscribe((state) => {
    if (state.lifecycle === 'ready' && !reentered) {
      reentered = true;
      firstReadySnapshot = state;
      widget.destroy();
      secondPromise = widget.init({ publicKey: 'second' });
    }
  });

  const firstPromise = widget.init({ publicKey: 'first' });
  drivers[0].ready();

  assert.equal(await firstPromise, firstReadySnapshot);
  assert.equal(widget.getState().lifecycle, 'initializing');
  assert.equal(drivers[0].destroyCount, 1);
  assert.equal(drivers[1].mountCount, 1);
  assert.equal(getLeaseOwner(document), widget);

  drivers[1].ready();
  assert.equal((await secondPromise).lifecycle, 'ready');
  widget.destroy();
  assert.equal(getLeaseOwner(document), null);
});

test('initializing subscriber destroy and re-init prevents the old mount', async () => {
  const { drivers, widget } = createHarness();
  let secondPromise;
  let reentered = false;

  widget.subscribe((state) => {
    if (state.lifecycle === 'initializing' && !reentered) {
      reentered = true;
      widget.destroy();
      secondPromise = widget.init({ publicKey: 'second' });
    }
  });

  const firstPromise = widget.init({ publicKey: 'first' });
  assert.equal((await rejection(firstPromise)).code, 'DESTROYED');
  assert.equal(drivers.length, 1, 'only the nested generation creates a driver');
  assert.equal(drivers[0].publicKey, 'second');
  assert.equal(drivers[0].mountCount, 1);

  drivers[0].ready();
  assert.equal((await secondPromise).lifecycle, 'ready');
  widget.destroy();
});

test('duplicate and stale terminal callbacks cannot affect a newer generation', async () => {
  const { drivers, widget } = createHarness();
  const firstPromise = widget.init({ publicKey: 'first' });
  const firstResult = rejection(firstPromise);
  drivers[0].error();
  await firstResult;

  const secondPromise = widget.init({ publicKey: 'second' });
  drivers[0].ready();
  drivers[0].error();
  assert.equal(widget.getState().lifecycle, 'initializing');

  drivers[1].ready();
  const secondReady = await secondPromise;
  drivers[1].error();
  assert.equal(widget.getState(), secondReady);

  widget.destroy();
  const thirdPromise = widget.init({ publicKey: 'third' });
  drivers[1].ready();
  drivers[1].error();
  assert.equal(widget.getState().lifecycle, 'initializing');
  drivers[2].ready();
  await thirdPromise;
  widget.destroy();
  assert.deepEqual(drivers.map((driver) => driver.destroyCount), [1, 1, 1]);
});

test('manual initializing conflicts reject only the conflicting calls', async () => {
  const { document, drivers, widget } = createHarness();
  const notifications = [];
  widget.subscribe((state) => notifications.push(state));

  const firstPromise = widget.init({ publicKey: 'first' });
  const activeSnapshot = widget.getState();
  const notificationCount = notifications.length;
  const different = rejection(widget.init({ publicKey: 'second' }));
  const malformed = rejection(widget.init({ publicKey: '' }));

  assert.equal((await different).code, 'INIT_OPTIONS_CONFLICT');
  assert.equal((await malformed).code, 'INIT_OPTIONS_CONFLICT');
  assert.equal(widget.getState(), activeSnapshot);
  assert.equal(notifications.length, notificationCount);
  assert.equal(widget.init({ publicKey: ' first ' }), firstPromise);
  assert.equal(drivers[0].mountCount, 1);
  assert.equal(drivers[0].destroyCount, 0);
  assert.equal(getLeaseOwner(document), widget);

  drivers[0].ready();
  await firstPromise;
  widget.destroy();
});

test('manual ready conflicts reject without replacing or publishing state', async () => {
  const { document, drivers, widget } = createHarness();
  const notifications = [];
  widget.subscribe((state) => notifications.push(state));

  const firstPromise = widget.init({ publicKey: 'first' });
  drivers[0].ready();
  const ready = await firstPromise;
  const notificationCount = notifications.length;

  assert.equal((await rejection(widget.init({ publicKey: 'second' }))).code, 'ALREADY_INITIALIZED');
  assert.equal((await rejection(widget.init({ publicKey: '' }))).code, 'ALREADY_INITIALIZED');
  assert.equal(widget.getState(), ready);
  assert.equal(notifications.length, notificationCount);
  assert.equal(widget.init({ publicKey: ' first ' }), firstPromise);
  assert.equal(drivers[0].destroyCount, 0);
  assert.equal(getLeaseOwner(document), widget);

  widget.destroy();
});

test('teardown releases the document captured by its generation', async () => {
  const firstDocument = createDocument('https://first.example');
  const secondDocument = createDocument('https://second.example');
  let activeDocument = firstDocument;
  const deferred = createDeferredDrivers();
  const widget = createWidgetInstance(deferred.factory, () => activeDocument);

  const firstPromise = widget.init({ publicKey: 'first' });
  const firstResult = rejection(firstPromise);
  activeDocument = secondDocument;
  deferred.records[0].error();
  await firstResult;
  assert.equal(getLeaseOwner(firstDocument), null);

  const secondPromise = widget.init({ publicKey: 'second' });
  assert.equal(getLeaseOwner(secondDocument), widget);
  deferred.records[1].ready();
  await secondPromise;
  widget.destroy();
  assert.equal(getLeaseOwner(secondDocument), null);
});

test('visibility and driver intents remain generation-owned', async () => {
  const { drivers, widget } = createHarness();
  const promise = widget.init({ publicKey: 'key' });
  widget.open();
  assert.equal(widget.getState().visibility, 'open');
  drivers[0].ready();
  const ready = await promise;
  assert.equal(ready.visibility, 'open');
  assert.deepEqual(drivers[0].visibility, [true]);

  drivers[0].intent(false);
  assert.equal(widget.getState().visibility, 'closed');
  assert.deepEqual(drivers[0].visibility, [true, false]);
  widget.destroy();
  drivers[0].intent(true);
  assert.equal(widget.getState().lifecycle, 'destroyed');
});

test('snapshots omit absent errors and destroy releases pending resources once', async () => {
  const { document, drivers, widget } = createHarness();
  assert.deepEqual(Object.keys(widget.getState()).sort(), ['auth', 'lifecycle', 'visibility']);
  const promise = widget.init({ publicKey: 'key' });
  const result = rejection(promise);
  assert.deepEqual(Object.keys(widget.getState()).sort(), ['auth', 'lifecycle', 'visibility']);
  widget.destroy();
  assert.equal((await result).code, 'DESTROYED');
  assert.deepEqual(Object.keys(widget.getState()).sort(), ['auth', 'lifecycle', 'visibility']);
  assert.equal(drivers[0].destroyCount, 1);
  assert.equal(getLeaseOwner(document), null);
  widget.destroy();
  assert.equal(drivers[0].destroyCount, 1);
});
