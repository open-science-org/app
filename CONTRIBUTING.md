# Contributing

- **Branches and pull requests.** Work on short-lived branches and open a pull request the same day; reviews are same-day too. Link the issue from the project board.
- **Contract first.** Any change to the API changes `contract/openapi.yaml` in the same pull request; run `npm run types`. Every operation needs a contract test in `api/api.test.ts`.
- **Rules live in the API.** The front end never computes weights, value flows, balances or statuses; if a number depends on an OIP, the API returns it.
- **Ledger changes follow the OIPs.** A change to ledger behaviour cites the OIP section it implements; if the OIP is silent or wrong, propose an OIP change in [open-science-org/OIPs](https://github.com/open-science-org/OIPs) first.
- **TypeScript without a build step.** Use only erasable syntax (no `enum`, no parameter properties, no `namespace`); `npm run check` enforces it.
- **Secrets** go in environment variables, never in the repository. Development keys in `api/demo.ts` are public by design.
- **Decisions** go in `docs/decisions.md`: what, why, who, date.
