// Exact predictions for the simple model: one chain of results, N identical agents, success chance
// p per attempt at every step, budget X attempts in total (sim/README.md, "The simple model").

/** Binomial(n, p) probabilities P(K = k) for k = 0..n, computed in log space. */
function binomialPmf(n: number, p: number): number[] {
  const out: number[] = [];
  let logC = 0;
  for (let k = 0; k <= n; k++) {
    if (k > 0) logC += Math.log(n - k + 1) - Math.log(k);
    out.push(Math.exp(logC + k * Math.log(p) + (n - k) * Math.log1p(-p)));
  }
  return out;
}

/** Shared progress: every attempt works on the current step, so depth ~ Binomial(X, p). */
export function sharedDepth(X: number, p: number) {
  return { mean: X * p, sd: Math.sqrt(X * p * (1 - p)) };
}

/**
 * Hidden progress: each agent climbs alone with X/N attempts, so its depth ~ Binomial(X/N, p), and the
 * community's deepest result is the maximum over N agents: E[max] = Σ_k (1 − F(k)^N).
 */
export function hiddenDepth(X: number, p: number, N: number) {
  const n = Math.floor(X / N);
  const pmf = binomialPmf(n, p);
  let F = 0;
  let mean = 0;
  let second = 0;
  for (let k = 0; k <= n; k++) {
    const before = F ** N;
    F += pmf[k];
    const atMost = Math.min(1, F) ** N;
    const pMax = atMost - before;
    mean += k * pMax;
    second += k * k * pMax;
  }
  return { mean, sd: Math.sqrt(Math.max(0, second - mean * mean)), single: n * p };
}
