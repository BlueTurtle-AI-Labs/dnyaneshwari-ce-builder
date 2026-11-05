/* Word-level diff (LCS) between two blocks, used to show similarity / dissimilarity. */
(function (D) {
  'use strict';

  // "|" verse separators are kept for display but ignored when comparing.
  function tokenize(s) {
    return String(s).replace(/\|/g, ' | ').split(/\s+/).filter(Boolean)
      .map((t) => ({ t, k: t === '|' || /^\|+$/.test(t) ? '' : t, hit: false }));
  }

  D.wordDiff = function (a, b) {
    const A = tokenize(a), B = tokenize(b);
    const ca = A.filter((x) => x.k), cb = B.filter((x) => x.k);
    const n = ca.length, m = cb.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = ca[i].k === cb[j].k ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (ca[i].k === cb[j].k) { ca[i].hit = cb[j].hit = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    const cls = (x, miss) => (!x.k ? 'sep' : x.hit ? 'same' : miss);
    return {
      a: A.map((x) => ({ t: x.t, c: cls(x, 'del') })),
      b: B.map((x) => ({ t: x.t, c: cls(x, 'add') })),
      sim: n + m ? (2 * dp[0][0]) / (n + m) : 1,
      common: dp[0][0], na: n, nb: m,
    };
  };
})(window.DCE);
