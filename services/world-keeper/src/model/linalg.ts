/** Small dense symmetric matrices (n ≤ 12): eigen-decomposition, the nearest correlation
 * matrix, and a minimum-residual factor fit. Row-major arrays of arrays. */
export type Matrix = number[][];

/** Eigenvalues (descending) and unit eigenvectors (columns of `vectors`) of a symmetric
 * matrix, by cyclic Jacobi rotations. */
export function symmetricEigen(input: Matrix) {
  const n = input.length;
  const a = input.map((row) => [...row]);
  const v: Matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p]![q]! ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1),
          s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!,
            akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!,
            aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!,
            vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[j]![j]! - a[i]![i]!);
  return {
    values: order.map((i) => a[i]![i]!),
    vectors: v.map((row) => order.map((i) => row[i]!)),
  };
}

/** The nearest correlation matrix by alternating projections (Higham 2002): positive
 * semidefinite (eigenvalues at least `floor`) with a unit diagonal. */
export function nearestCorrelation(input: Matrix, floor = 1e-6): Matrix {
  const n = input.length;
  let y = input.map((row) => [...row]);
  let correction: Matrix = y.map((row) => row.map(() => 0));
  for (let iter = 0; iter < 100; iter++) {
    const r = y.map((row, i) => row.map((value, j) => value - correction[i]![j]!));
    const { values, vectors } = symmetricEigen(r);
    const x: Matrix = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        let sum = 0;
        for (let k = 0; k < n; k++)
          sum += vectors[i]![k]! * Math.max(floor, values[k]!) * vectors[j]![k]!;
        return sum;
      }),
    );
    correction = x.map((row, i) => row.map((value, j) => value - r[i]![j]!));
    const next = x.map((row, i) => row.map((value, j) => (i === j ? 1 : value)));
    let change = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) change = Math.max(change, Math.abs(next[i]![j]! - y[i]![j]!));
    y = next;
    if (change < 1e-10) break;
  }
  return y;
}

/** Loadings B (n × m) with BBᵀ off the diagonal as close as minimum residuals allow to the
 * correlation matrix R, each row's Σβ² at most `maxCommonality` (iterated principal axes),
 * and the largest error left on any pair. */
export function factorFit(r: Matrix, m: number, maxCommonality = 0.95) {
  const n = r.length;
  const factors = Math.max(1, Math.min(m, n));
  let h = r.map((row, i) =>
    Math.min(maxCommonality, Math.max(0.01, ...row.filter((_, j) => j !== i).map(Math.abs))),
  );
  let loadings: Matrix = [];
  for (let iter = 0; iter < 200; iter++) {
    const reduced = r.map((row, i) => row.map((value, j) => (i === j ? h[i]! : value)));
    const { values, vectors } = symmetricEigen(reduced);
    loadings = Array.from({ length: n }, (_, i) =>
      Array.from(
        { length: factors },
        (_, k) => vectors[i]![k]! * Math.sqrt(Math.max(0, values[k]!)),
      ),
    );
    const next = loadings.map((row) =>
      Math.min(
        maxCommonality,
        row.reduce((a, b) => a + b * b, 0),
      ),
    );
    // Rows over the bound are scaled back to it.
    loadings = loadings.map((row) => {
      const sum = row.reduce((a, b) => a + b * b, 0);
      return sum > maxCommonality ? row.map((b) => b * Math.sqrt(maxCommonality / sum)) : row;
    });
    const change = Math.max(...next.map((v, i) => Math.abs(v - h[i]!)));
    h = next;
    if (change < 1e-10) break;
  }
  let misfit = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      let implied = 0;
      for (let k = 0; k < factors; k++) implied += loadings[i]![k]! * loadings[j]![k]!;
      misfit = Math.max(misfit, Math.abs(implied - r[i]![j]!));
    }
  return { loadings, misfit };
}

/** The lower Cholesky factor of a positive definite matrix. */
export function cholesky(a: Matrix): Matrix {
  const n = a.length;
  const l: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let sum = a[i]![j]!;
      for (let k = 0; k < j; k++) sum -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        if (sum <= 0) throw new Error("Not positive definite");
        l[i]![i] = Math.sqrt(sum);
      } else l[i]![j] = sum / l[j]![j]!;
    }
  return l;
}
