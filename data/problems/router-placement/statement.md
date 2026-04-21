# Router Placement

You are given the positions of `n` houses on a straight road and must install exactly `c` Wi-Fi routers.

Place the routers in houses so that the **minimum distance between any two installed routers** is as large as possible.

Your task is to compute that maximum possible minimum distance.

## Input

- The first line contains two integers `n` and `c`
  (`2 <= c <= n <= 200000`).
- The second line contains `n` distinct integers `x1, x2, ..., xn`
  (`0 <= xi <= 10^9`) representing house positions.

## Output

- Print one integer: the largest value `d` such that the routers can be placed with every pair of consecutive installed routers at distance at least `d`.

## Example

Input

```text
5 3
1 2 8 4 9
```

Output

```text
3
```

## Explanation

An optimal placement is at positions `1`, `4`, and `8` (or `1`, `4`, and `9`).
The minimum distance is `3`, and no larger value is possible.
