// Line-level diff behind Variant B's conflict compare (#15). A conflict means
// GitHub's copy moved under the writer; before they choose "keep mine" or "use
// theirs" they need to SEE what differs. This marks, per side, which lines to
// shade — via a longest-common-subsequence walk, so a line that only moved or
// repeats isn't mis-flagged the way a raw set difference would. Whole-file text,
// so front matter and body compare the same way. No git vocabulary reaches here.
export interface DiffLine {
  text: string;
  /** Not part of the common subsequence — i.e. this line differs from the other version. */
  changed: boolean;
}

export interface LineDiff {
  mine: DiffLine[];
  theirs: DiffLine[];
}

export function diffLines(mineText: string, theirsText: string): LineDiff {
  const a = mineText.split('\n');
  const b = theirsText.split('\n');
  const m = a.length;
  const n = b.length;

  // dp[i][j] = length of the LCS of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  // Walk the table to mark which indices participate in the common subsequence.
  const aKept = new Array<boolean>(m).fill(false);
  const bKept = new Array<boolean>(n).fill(false);
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      aKept[i] = bKept[j] = true;
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }

  return {
    mine: a.map((text, idx) => ({ text, changed: !aKept[idx] })),
    theirs: b.map((text, idx) => ({ text, changed: !bKept[idx] })),
  };
}
