# Testing Architecture

Internal reference for how `idb-repo` tests IndexedDB code outside a browser.

---

## Problem

IndexedDB is a browser-only API. The production code in `src/lib.ts` (`IndexedDbKV`) uses raw `indexedDB.open()`, transactions, cursors, etc. We need a way to exercise this code in CI under `bun test` without a real browser tab.

## Solution: WebContainer

`src/web-container.ts` wraps a headless Playwright WebKit instance. Tests call into the real browser IndexedDB through `page.evaluate()`, getting genuine spec-compliant behavior rather than a polyfill.

```
bun test src/web-container.test.ts
```

---

## High-level flow

```mermaid
sequenceDiagram
    participant Test as bun:test
    participant WC as WebContainer
    participant PW as Playwright WebKit
    participant Page as WebKit Page

    Test->>WC: WebContainer.create({ headless: true })
    WC->>PW: webkit.launch()
    PW-->>WC: Browser handle
    WC->>PW: browser.newContext()
    PW-->>WC: BrowserContext
    WC->>WC: context.route("https://webcontainer.local/**")
    WC->>PW: context.newPage()
    PW-->>WC: Page handle
    WC->>Page: page.addInitScript(helpers)
    WC->>Page: page.goto(origin)
    Note over Page: addInitScript fires during navigation<br/>helpers (reqToPromise, txDone, openDB)<br/>are now on window
    WC->>Page: page.evaluate(IDB probe)
    Page-->>WC: true
    WC-->>Test: WebContainer { ready: true }

    Test->>WC: indexedDB.set("kv", "hello", { x: 1 })
    WC->>Page: page.evaluate(open DB + put)
    Page-->>WC: void
    Test->>WC: indexedDB.get("kv", "hello")
    WC->>Page: page.evaluate(open DB + get)
    Page-->>WC: { x: 1 }

    Test->>WC: close()
    WC->>PW: browser.close() (raced vs 5 s timeout)
    PW-->>WC: void
```

---

## Component map

```mermaid
graph TD
    subgraph "Test runner (Bun)"
        T["bun:test<br/>web-container.test.ts"]
    end

    subgraph "WebContainer (src/web-container.ts)"
        WC["WebContainer class"]
        Facade["indexedDB facade<br/>.get() .set() .del()"]
    end

    subgraph "Playwright WebKit"
        B["Browser process"]
        Ctx["BrowserContext<br/>+ route interception"]
        P["Page (https://webcontainer.local)"]
    end

    subgraph "In-page globals"
        H["reqToPromise()<br/>txDone()<br/>openDB()"]
        IDB["IndexedDB"]
    end

    T --> WC
    WC --> Facade
    Facade -->|"page.evaluate()"| P
    WC --> B
    B --> Ctx
    Ctx --> P
    P --> H
    H --> IDB

    style IDB fill:#f5d67b,stroke:#c9a227
    style P fill:#d4edfc,stroke:#5ba3d9
```

---

## The origin problem and its fix

IndexedDB requires a **secure context** (an origin that is not opaque). The earlier implementation used `page.setContent()` which keeps the page at `about:blank` — origin `"null"`.

```mermaid
graph LR
    subgraph "Before (broken)"
        A1["page.setContent(html)"] --> B1["origin: 'null'"]
        B1 --> C1["indexedDB.open() throws<br/>SecurityError"]
    end

    subgraph "After (fixed)"
        A2["context.route('https://webcontainer.local/**')"] --> B2["page.goto(origin)"]
        B2 --> C2["origin: 'https://webcontainer.local'"]
        C2 --> D2["indexedDB.open() succeeds"]
    end

    style C1 fill:#f8d7da,stroke:#dc3545
    style D2 fill:#d4edda,stroke:#28a745
```

The fix uses Playwright's **route interception** to fulfill requests to `https://webcontainer.local` with a minimal HTML shell. The browser sees a real HTTPS origin, so the security context is valid.

### Why not other approaches?

| Approach                         | Problem                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `page.setContent()`              | Stays at `about:blank` — opaque origin                   |
| `data:text/html,...`             | Data URLs also have opaque origins                       |
| `file:///...`                    | `file://` origins are opaque in WebKit                   |
| Spin up an HTTP server           | Unnecessary complexity; port management, startup latency |
| **`context.route()` + `goto()`** | Clean, no real network, proper HTTPS origin              |

---

## Init script injection lifecycle

`addInitScript` vs `evaluate` have different timing. Getting this wrong causes the helpers to be missing when the KV facade runs.

```mermaid
stateDiagram-v2
    [*] --> ContextCreated: browser.newContext()
    ContextCreated --> RouteRegistered: context.route(origin)
    RouteRegistered --> PageCreated: context.newPage()
    PageCreated --> InitScriptRegistered: page.addInitScript(helpers)
    InitScriptRegistered --> PageNavigated: page.goto(origin)

    state PageNavigated {
        [*] --> RouteIntercepted: Playwright intercepts request
        RouteIntercepted --> HTMLFulfilled: route.fulfill({ body: html })
        HTMLFulfilled --> InitScriptFires: addInitScript runs before page scripts
        InitScriptFires --> HelpersOnWindow: reqToPromise, txDone, openDB on window
        HelpersOnWindow --> [*]
    }

    PageNavigated --> IDBProbe: page.evaluate(probe)
    IDBProbe --> Ready: ready = true
    Ready --> [*]
```

Key ordering constraint: `addInitScript` must be called **before** `page.goto()`. The script fires during navigation, making helpers available for all subsequent `page.evaluate()` calls. The previous code called `addInitScript` _after_ `setContent`, so it only applied to future navigations that never happened — requiring a fragile fallback `evaluate()` block.

---

## Process lifecycle and cleanup

A dangling WebKit process blocks CI runners and leaks memory locally.

```mermaid
flowchart TD
    A["beforeAll: WebContainer.create()"] --> B["webkit.launch() spawns process"]
    B --> C{"Tests run"}
    C -->|"all pass"| D["afterAll: container.close()"]
    C -->|"test throws"| D
    D --> E["browser.close()"]
    E --> F{"Resolves within 5 s?"}
    F -->|yes| G["Process exits cleanly"]
    F -->|no| H["Timeout resolves Promise.race"]
    H --> I["ready = false<br/>(process orphaned but<br/>test runner unblocked)"]
    G --> J["ready = false"]

    style H fill:#fff3cd,stroke:#ffc107
    style G fill:#d4edda,stroke:#28a745
```

### Safeguards

1. **`beforeAll` / `afterAll`** — Container is created once, shared across all `it()` blocks, and closed in `afterAll` regardless of test outcomes.
2. **Timeout race in `close()`** — `Promise.race([browser.close(), timeout(5s)])` prevents a hung WebKit from blocking the test runner indefinitely.
3. **Swallowed errors** — `close()` catches all exceptions so teardown never throws into the test framework.

---

## Data flow through the KV facade

Each facade method (`get`, `set`, `del`) serializes arguments, crosses the Bun-to-WebKit boundary via `page.evaluate()`, runs a full IDB transaction inside the page, and returns the result.

```mermaid
flowchart LR
    subgraph "Bun process"
        Call["facade.set('kv', 'hello', {x:1})"]
        Ser["Serialize args to JSON"]
    end

    subgraph "WebKit page (https://webcontainer.local)"
        Eval["page.evaluate()"]
        Open["openDB('webcontainer-db', 1, ['kv'])"]
        TX["tx = db.transaction('kv', 'readwrite')"]
        Put["tx.objectStore('kv').put(value, key)"]
        Done["await txDone(tx)"]
        Close["db.close()"]
    end

    Call --> Ser --> Eval --> Open --> TX --> Put --> Done --> Close
    Close -->|"void"| Call

    style Call fill:#e8daef,stroke:#8e44ad
    style Eval fill:#d4edfc,stroke:#5ba3d9
```

---

## Running tests

```bash
# All tests
bun test

# Just the WebContainer integration tests
bun test src/web-container.test.ts
```
