// VALO offline-first Supabase transport.
// Keeps GET responses in IndexedDB and queues REST/RPC mutations while offline.
// The queue survives reloads/app restarts and replays in order when connectivity returns.

const DB_NAME = 'valo-offline-first-v4';
const DB_VERSION = 1;
const CACHE_STORE = 'responses';
const QUEUE_STORE = 'queue';
const META_STORE = 'meta';
const NETWORK_TIMEOUT_MS = 9000;

let dbPromise = null;
let installed = false;
let originalFetch = null;
let wrappedFetch = null;
let syncPromise = null;

const now = () => Date.now();

export const isBrowserOffline = () =>
  typeof navigator !== 'undefined' && navigator.onLine === false;

export const isLikelyNetworkError = (error) => {
  if (!error) return false;
  const text = String(
    error?.message ||
    error?.error_description ||
    error ||
    ''
  ).toLowerCase();

  return (
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('network error') ||
    text.includes('internet disconnected') ||
    text.includes('load failed') ||
    text.includes('fetch failed') ||
    text.includes('connection refused') ||
    text.includes('offline') ||
    text.includes('err_internet_disconnected') ||
    text.includes('err_network_changed') ||
    text.includes('timeout')
  );
};

const openDb = () => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(
          QUEUE_STORE,
          { keyPath: 'id', autoIncrement: true }
        );

        store.createIndex(
          'createdAt',
          'createdAt',
          { unique: false }
        );
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(
          META_STORE,
          { keyPath: 'key' }
        );
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(() => null);

  return dbPromise;
};

const txRequest = (store, mode, action) =>
  new Promise(async (resolve, reject) => {
    try {
      const db = await openDb();

      if (!db) {
        return resolve(null);
      }

      const tx = db.transaction(store, mode);
      const objectStore = tx.objectStore(store);
      const request = action(objectStore);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  }).catch(() => null);

const putCache = async (key, value) =>
  txRequest(
    CACHE_STORE,
    'readwrite',
    store => store.put({ key, ...value })
  );

const getCache = async key =>
  txRequest(
    CACHE_STORE,
    'readonly',
    store => store.get(key)
  );

const getAllCache = async () =>
  txRequest(
    CACHE_STORE,
    'readonly',
    store => store.getAll()
  ) || [];

const addQueue = async item => {
  const record = {
    ...item,
    createdAt: item.createdAt || now(),
    retryCount: item.retryCount || 0
  };

  const id = await txRequest(
    QUEUE_STORE,
    'readwrite',
    store => store.add(record)
  );

  return id;
};

const updateQueue = async item =>
  txRequest(
    QUEUE_STORE,
    'readwrite',
    store => store.put(item)
  );

const deleteQueue = async id =>
  txRequest(
    QUEUE_STORE,
    'readwrite',
    store => store.delete(id)
  );

const getAllQueue = async () => {
  const rows = await txRequest(
    QUEUE_STORE,
    'readonly',
    store => store.getAll()
  );

  return (rows || []).sort(
    (a, b) =>
      Number(a.createdAt || 0) -
      Number(b.createdAt || 0)
  );
};

const setMeta = async (key, value) =>
  txRequest(
    META_STORE,
    'readwrite',
    store => store.put({ key, value })
  );

const getMeta = async key => {
  const row = await txRequest(
    META_STORE,
    'readonly',
    store => store.get(key)
  );

  return row?.value;
};

const deleteMeta = async key =>
  txRequest(
    META_STORE,
    'readwrite',
    store => store.delete(key)
  );

export const getOfflineMeta = getMeta;
export const setOfflineMeta = setMeta;

export const getOfflineQueue = getAllQueue;

export const getOfflineQueueCount = async () =>
  (await getAllQueue()).length;

export const removeOfflineQueueItem = deleteQueue;
export const updateOfflineQueueItem = updateQueue;

export const queueOfflineRequest = async request => {
  const id = await addQueue({
    kind: request?.kind || 'supabase-generic',
    type: request?.type || null,
    payload: request?.payload || null,
    url: request?.url || null,
    method: request?.method || null,
    headers: request?.headers || null,
    body: request?.body ?? null,
    createdAt: request?.createdAt || now()
  });

  return id;
};

export const getOfflineCache = async key => {
  const row = await getCache(key);
  return row?.value ?? null;
};

export const setOfflineCache = async (key, value) =>
  putCache(
    key,
    {
      value,
      updatedAt: now()
    }
  );

const timeoutFetch = async (
  fetchImpl,
  input,
  init = {},
  timeout = NETWORK_TIMEOUT_MS
) => {
  const controller =
    typeof AbortController !== 'undefined'
      ? new AbortController()
      : null;

  const timer = controller
    ? setTimeout(
        () => controller.abort(),
        timeout
      )
    : null;

  try {
    const nextInit = controller
      ? {
          ...init,
          signal: controller.signal
        }
      : init;

    return await fetchImpl(
      input,
      nextInit
    );
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const cloneHeaders = headers => {
  const out = {};

  try {
    new Headers(headers).forEach(
      (value, key) => {
        // Authorization and apikey are needed for replay.
        // They are not stored in UI state.
        out[key] = value;
      }
    );
  } catch (_) {}

  return out;
};

const requestKey = request => {
  try {
    return new URL(
      request.url,
      typeof window !== 'undefined'
        ? window.location.href
        : undefined
    ).toString();
  } catch (_) {
    return String(
      request.url || request
    );
  }
};

const makeJsonResponse = (
  value,
  status = 200,
  headers = {}
) => {
  const body = JSON.stringify(
    value == null ? null : value
  );

  return new Response(
    body,
    {
      status,
      headers: {
        'content-type': 'application/json',
        ...headers
      }
    }
  );
};

const parseJsonSafe = async response => {
  try {
    const text =
      await response.clone().text();

    return text
      ? JSON.parse(text)
      : null;
  } catch (_) {
    return null;
  }
};

const isSupabaseRestRequest = url => {
  try {
    const u = new URL(
      url,
      window.location.href
    );

    return (
      u.pathname.includes('/rest/v1/') ||
      u.pathname.includes('/rpc/')
    );
  } catch (_) {
    return false;
  }
};

const tableFromUrl = url => {
  try {
    const u = new URL(
      url,
      window.location.href
    );

    const rest =
      u.pathname.split('/rest/v1/')[1];

    if (rest) {
      return rest.split('/')[0];
    }

    return null;
  } catch (_) {
    return null;
  }
};

const parseBody = body => {
  if (body == null) return null;

  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (_) {
      return body;
    }
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  return body;
};

const rowsFrom = value =>
  Array.isArray(value)
    ? value
    : (
        value &&
        typeof value === 'object'
          ? [value]
          : []
      );

const getEqFilters = url => {
  const filters = [];

  try {
    const u = new URL(
      url,
      window.location.href
    );

    for (
      const [key, value]
      of u.searchParams.entries()
    ) {
      if (value.startsWith('eq.')) {
        filters.push([
          key,
          decodeURIComponent(
            value.slice(3)
          )
        ]);
      }
    }
  } catch (_) {}

  return filters;
};

const matchesFilters = (
  row,
  filters
) =>
  filters.every(
    ([key, value]) =>
      String(row?.[key]) ===
      String(value)
  );

const updateCachedTable = async (
  table,
  mutator
) => {
  if (!table) return;

  const caches =
    await getAllCache();

  await Promise.all(
    caches
      .filter(
        row => row.table === table
      )
      .map(async cached => {
        const next = mutator(
          Array.isArray(cached.value)
            ? cached.value
            : rowsFrom(cached.value),
          cached.url
        );

        if (next !== undefined) {
          await putCache(
            cached.key,
            {
              value: next,
              updatedAt: now(),
              url: cached.url,
              table
            }
          );
        }
      })
  );
};

const applyLocalRestMutation = async ({
  url,
  method,
  body
}) => {
  const table =
    tableFromUrl(url);

  if (!table) return;

  const rows =
    rowsFrom(parseBody(body));

  const filters =
    getEqFilters(url);

  const upper =
    String(method || '')
      .toUpperCase();

  if (upper === 'POST') {
    await updateCachedTable(
      table,
      current => {
        const next = [
          ...current
        ];

        rows.forEach(row => {
          const item = {
            ...(row || {})
          };

          if (item.id == null) {
            item.id =
              -Date.now() -
              Math.floor(
                Math.random() * 10000
              );
          }

          next.push(item);
        });

        return next;
      }
    );
  } else if (upper === 'PATCH') {
    await updateCachedTable(
      table,
      current =>
        current.map(row =>
          matchesFilters(
            row,
            filters
          )
            ? {
                ...row,
                ...(rows[0] || {})
              }
            : row
        )
    );
  } else if (upper === 'DELETE') {
    await updateCachedTable(
      table,
      current =>
        current.filter(
          row =>
            !matchesFilters(
              row,
              filters
            )
        )
    );
  }
};

const responseForOfflineWrite = (
  url,
  method,
  body
) => {
  const table =
    tableFromUrl(url);

  const payload =
    rowsFrom(parseBody(body));

  if (
    String(method).toUpperCase() ===
      'POST' &&
    payload.length
  ) {
    return makeJsonResponse(
      payload,
      201
    );
  }

  return makeJsonResponse(
    [],
    200
  );
};

const shouldQueueMutation = (
  request,
  url
) => {
  const method =
    String(request.method || 'GET')
      .toUpperCase();

  if (
    method === 'GET' ||
    method === 'HEAD' ||
    method === 'OPTIONS'
  ) {
    return false;
  }

  return isSupabaseRestRequest(
    url
  );
};

const queueGenericMutation = async ({
  request,
  url,
  body
}) => {
  await applyLocalRestMutation({
    url,
    method: request.method,
    body
  });

  const id =
    await queueOfflineRequest({
      kind: 'supabase-generic',
      url,
      method: request.method,
      headers: cloneHeaders(
        request.headers
      ),
      body
    });

  return id;
};

const fetchCachedGet = async (
  request,
  url
) => {
  const key =
    requestKey(request);

  const cached =
    await getCache(key);

  if (cached) {
    return makeJsonResponse(
      cached.value,
      cached.status || 200,
      cached.headers || {}
    );
  }

  return null;
};

const wrappedFetchImpl = async (
  input,
  init = {}
) => {
  // Preserve headers supplied through fetch init,
  // including Supabase apikey and Authorization.
  const request =
    new Request(
      input,
      init
    );

  const url =
    request.url;

  const method =
    String(request.method || 'GET')
      .toUpperCase();

  const supabaseRequest =
    isSupabaseRestRequest(
      url
    );

  if (!supabaseRequest) {
    return originalFetch(
      input,
      init
    );
  }

  const body =
    method === 'GET' ||
    method === 'HEAD'
      ? null
      : await request
          .clone()
          .text();

  // ------------------------------------------
  // GET / HEAD
  // ------------------------------------------
  if (
    method === 'GET' ||
    method === 'HEAD'
  ) {
    try {
      const response =
        await timeoutFetch(
          originalFetch,
          request
        );

      if (
        response &&
        response.ok
      ) {
        const value =
          await parseJsonSafe(
            response
          );

        const table =
          tableFromUrl(url);

        await putCache(
          requestKey(request),
          {
            value,
            status:
              response.status,
            headers: {
              'content-type':
                response.headers.get(
                  'content-type'
                ) ||
                'application/json'
            },
            url:
              requestKey(request),
            table,
            updatedAt: now()
          }
        );
      }

      return response;
    } catch (error) {
      const cached =
        await fetchCachedGet(
          request,
          url
        );

      if (cached) {
        return cached;
      }

      // Keep the UI alive when there is no
      // cached response available offline.
      return makeJsonResponse(
        [],
        200
      );
    }
  }

  // ------------------------------------------
  // OFFLINE MUTATION
  // ------------------------------------------
  if (
    shouldQueueMutation(
      request,
      url
    ) &&
    isBrowserOffline()
  ) {
    await queueGenericMutation({
      request,
      url,
      body
    });

    return responseForOfflineWrite(
      url,
      method,
      body
    );
  }

  // ------------------------------------------
  // ONLINE REQUEST / FALLBACK QUEUE
  // ------------------------------------------
  try {
    const response =
      await timeoutFetch(
        originalFetch,
        request
      );

    return response;
  } catch (error) {
    if (
      shouldQueueMutation(
        request,
        url
      ) &&
      isLikelyNetworkError(
        error
      )
    ) {
      await queueGenericMutation({
        request,
        url,
        body
      });

      return responseForOfflineWrite(
        url,
        method,
        body
      );
    }

    throw error;
  }
};

export const installOfflineSupabaseFetch =
  supabase => {
    if (installed) {
      return wrappedFetch;
    }

    if (
      typeof window === 'undefined' ||
      typeof fetch === 'undefined'
    ) {
      return null;
    }

    originalFetch =
      window.fetch.bind(window);

    wrappedFetch =
      wrappedFetchImpl;

    window.fetch =
      wrappedFetch;

    installed = true;

    // IMPORTANT:
    // Do NOT replace supabase.rest.fetch here.
    //
    // Supabase JS wraps its transport with fetchWithAuth,
    // which injects the publishable apikey and Authorization
    // headers.
    //
    // Replacing supabase.rest.fetch directly bypasses that
    // authentication layer and causes:
    //
    // 401 - No API key found in request.
    //
    // The global fetch wrapper above is enough for the
    // offline transport while preserving Supabase auth.

    return wrappedFetch;
  };

export const syncOfflineSupabaseQueue =
  async processCustomOfflineQueue => {
    if (syncPromise) {
      return syncPromise;
    }

    syncPromise =
      (async () => {
        if (isBrowserOffline()) {
          return;
        }

        const queue =
          await getAllQueue();

        for (const item of queue) {
          if (isBrowserOffline()) {
            break;
          }

          let ok = false;

          try {
            if (
              item.kind ===
              'valo-custom'
            ) {
              ok =
                await Promise.race([
                  Promise.resolve(
                    processCustomOfflineQueue
                      ? processCustomOfflineQueue(
                          item
                        )
                      : false
                  ),
                  new Promise(
                    resolve =>
                      setTimeout(
                        () =>
                          resolve(
                            false
                          ),
                        NETWORK_TIMEOUT_MS
                      )
                  )
                ]);
            } else {
              ok =
                await replayGenericItem(
                  item
                );
            }
          } catch (error) {
            ok = false;

            if (
              !isLikelyNetworkError(
                error
              )
            ) {
              console.warn(
                'VALO offline queue item failed:',
                error
              );
            }
          }

          if (ok) {
            await deleteQueue(
              item.id
            );
          } else {
            item.retryCount =
              Number(
                item.retryCount || 0
              ) + 1;

            item.lastErrorAt =
              now();

            await updateQueue(
              item
            );

            // Stop at first failure so
            // ordering is preserved.
            break;
          }
        }
      })().finally(() => {
        syncPromise = null;
      });

    return syncPromise;
  };

const rewriteMappedId =
  async item => {
    if (!item?.url) {
      return item;
    }

    let url = item.url;

    const mappings =
      (await getAllCache())
        .length
        ? null
        : null;

    // Mapping records are discovered by
    // scanning meta keys is not available
    // via getAll.
    return {
      ...item,
      url
    };
  };

const replayGenericItem =
  async item => {
    if (
      !item?.url ||
      !item?.method
    ) {
      return false;
    }

    let url =
      item.url;

    // Resolve a local negative ID
    // in simple PostgREST eq filters.
    try {
      const u =
        new URL(url);

      for (
        const [
          key,
          value
        ] of [
          ...u.searchParams.entries()
        ]
      ) {
        const numeric =
          Number(
            value.startsWith('eq.')
              ? value.slice(3)
              : 'NaN'
          );

        if (
          Number.isFinite(
            numeric
          ) &&
          numeric < 0
        ) {
          const table =
            tableFromUrl(url);

          const mapped =
            await getMeta(
              `row-map:${table}:${numeric}`
            );

          if (mapped != null) {
            u.searchParams.set(
              key,
              `eq.${mapped}`
            );
          }
        }
      }

      url =
        u.toString();
    } catch (_) {}

    const headers =
      new Headers(
        item.headers || {}
      );

    headers.delete(
      'content-length'
    );

    try {
      const response =
        await timeoutFetch(
          originalFetch,
          url,
          {
            method:
              item.method,
            headers,
            body:
              item.body
          }
        );

      if (!response.ok) {
        if (
          response.status >= 500 ||
          response.status === 429
        ) {
          return false;
        }

        console.warn(
          'VALO offline mutation rejected by server:',
          response.status,
          url
        );

        return false;
      }

      // If this was an insert and the
      // server returned the representation,
      // remember the generated ID.
      if (
        String(
          item.method
        ).toUpperCase() ===
        'POST'
      ) {
        const serverRows =
          rowsFrom(
            await parseJsonSafe(
              response
            )
          );

        const localRows =
          rowsFrom(
            parseBody(
              item.body
            )
          );

        if (
          serverRows[0]?.id != null &&
          localRows[0]?.id != null &&
          Number(
            localRows[0].id
          ) < 0
        ) {
          const table =
            tableFromUrl(url);

          await setMeta(
            `row-map:${table}:${localRows[0].id}`,
            serverRows[0].id
          );
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  };

// Kept for compatibility with existing VALO imports.
export const getOfflineCacheKey =
  requestKey;