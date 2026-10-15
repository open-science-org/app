# web

The OSO app front end goes here (Abinash). The suggested stack from [Architecture](https://github.com/open-science-org/OSO/blob/master/docs/ui/architecture.md) is TypeScript, React and Vite, with Cytoscape.js or D3 for graphs. Confirm it and record the choice in `docs/decisions.md`.

**Talking to the API**

- Run the API from the repository root with `npm start` (http://localhost:8787). It sends CORS headers, so a Vite dev server on another port can call it directly.
- Import the generated types from `../contract/types.ts`, for example with [openapi-fetch](https://openapi-ts.dev/openapi-fetch/):

  ```ts
  import createClient from 'openapi-fetch';
  import type { paths } from '../../contract/types';

  const api = createClient<paths>({ baseUrl: 'http://localhost:8787' });
  const { data } = await api.GET('/v1/ideas', { params: { query: { q: 'lora' } } });
  ```

- On load, read the community setup (`GET /v1/communities/peft/setup`) and drive screens, labels and theme from it.
- `api/dev.html` is a plain reference for how each endpoint is used.
