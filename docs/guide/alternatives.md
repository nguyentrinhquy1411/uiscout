# How it compares

Walking an app to build a map of it and judge each step is not a new idea. What differs between tools is how the map is built, who decides what to click, and where the results live. Checked in October 2026; tell us if something here is out of date.

## At a glance

| | uiscout | Session replay (Meticulous) | AI test writers (Shortest, Octomind) | Browser agents (browser-use, Stagehand) | Crawljax |
| --- | --- | --- | --- | --- | --- |
| Finds what to test by | Clicking every safe control | Recording real sessions | A model, from your description or the app | A model, from your instruction | Firing events on every clickable |
| Needs a model or API key | No | Hosted service | Yes | Yes | No |
| Same input, same result | Yes | Yes (backend replayed) | Execution yes, authoring no | No | Yes |
| Map of the app in git, diffed per PR | Yes | No | No | No | Graph per run, no PR flow |
| Defects with no test written | Yes: errors, failed requests, dead controls, layout, a11y | Visual changes on recorded flows | Only in the flows written | When asked | Through plugins |
| Runs where | Your machine or CI | Their cloud | Your CI (Shortest), their cloud (Octomind) | Your machine or cloud | Your machine (Java, Selenium) |
| License | Source on GitHub | Commercial | MIT (Shortest), commercial (Octomind) | MIT | Apache-2.0 |

## The tools

### Crawljax

The research tool closest to uiscout: it crawls an Ajax app by firing events, builds a state-flow graph of DOM states and transitions, and checks invariants through plugins. Apache-2.0, Java on Selenium; the last release on Maven Central is from June 2023 and the repository's last push from September 2023. ZAP's Ajax Spider uses it for security scanning.

uiscout keeps the idea (a graph from a real walk) and adds what a team needs today: Playwright and modern single-page apps, sign-in and personas, a baseline in git, a report per pull request, and repros that export as Playwright tests.

### Meticulous

The closest in workflow. A recorder script in your local, staging or preview environments captures sessions; Meticulous turns them into tests, replays them on every pull request with recorded backend responses, and shows what changed. A hosted, commercial service.

The difference is where coverage comes from. Meticulous covers what people did while recording; uiscout covers every control it can reach, including the ones nobody has used yet, and needs no script in the app. They also catch different things: Meticulous compares screens, uiscout judges each step (an exception, a 500, a control that can't be clicked).

### AI test writers: Shortest, Octomind

[Shortest](https://github.com/antiwork/shortest) (MIT) runs tests written in plain English, with Claude driving Playwright; it needs an Anthropic API key. Octomind generated Playwright tests with an agent that explored the app, and kept them up to date; some 2026 sources report it has shut down. We couldn't confirm that, but octomind.dev did not resolve when we checked.

They answer "does this flow still work"; uiscout answers "what in the app breaks". uiscout needs no description and no model, and the same run gives the same graph.

### Browser agents: browser-use, Stagehand

[browser-use](https://github.com/browser-use/browser-use) and [Stagehand](https://github.com/browserbase/stagehand) (both MIT) let a model drive a browser. They can explore an app and report what they see, but each run takes its own path and costs tokens, and there is no baseline to compare one run with the next. uiscout's [MCP server](12-mcp.md) goes the other way: the agent reads a graph that was observed, and its guesses stay proposals until the runner sees them happen.

### Narrower tools

| Tool | Does | Compared with uiscout |
| --- | --- | --- |
| [Unlighthouse](https://github.com/harlan-zw/unlighthouse) (MIT) | Lighthouse on every page of a site | Loads pages, doesn't click; scores rather than defects |
| [Gremlins.js](https://github.com/marmelab/gremlins.js) (MIT, last push 2023) | Random clicks and typing to stress a page | Like `uiscout fuzz`, without a graph, baseline or repro |
| [DroidBot](https://github.com/honeynet/droidbot) (MIT) and other model-based GUI testers | Explore an Android app into a state model | The same idea, for mobile apps |
| [uigraph](https://github.com/kanetran29/uigraph) (MIT) | A navigation graph from static analysis, verified at runtime; MCP | Reads code, so it needs an adapter per router (none for TanStack Router) and has no oracles. [Our measurement](../comparison.md) |
| Playwright tests | The paths someone wrote | uiscout finds bugs without them, and [`export`](02-check.md#from-a-finding-to-a-test-uiscout-export) writes one per bug |

## When to pick something else

- You want to know whether a few key journeys still work, written as specs: Playwright, or an AI test writer.
- You want pixel changes reviewed on every pull request: a visual testing service such as Meticulous, Chromatic or Percy.
- You have no running app in CI and can't record responses: uiscout needs one ([Network modes](06-network.md) cover the backend).

They combine well: uiscout on every pull request for what breaks, a handful of written tests for the journeys that matter most.
