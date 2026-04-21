# Delivery Network

A courier company has `n` depots connected by two-way roads.

Every road connects two depots and takes exactly one move to travel.
You must send one package from depot `s` to depot `t`.

Find the **minimum number of roads** the package must travel.
If `t` cannot be reached from `s`, print `-1`.

## Input

- The first line contains four integers `n`, `m`, `s`, and `t`
  (`1 <= n <= 200000`, `0 <= m <= 200000`, `1 <= s, t <= n`).
- Each of the next `m` lines contains two integers `u` and `v`, describing an undirected road between depots `u` and `v`.

## Output

- Print the minimum number of roads from `s` to `t`, or `-1` if no route exists.

## Example

Input

```text
5 5 1 5
1 2
2 3
3 5
1 4
4 5
```

Output

```text
2
```

## Explanation

One shortest route is `1 -> 4 -> 5`, which uses two roads.
