# Meeting Room Schedule

You manage one meeting room and receive `n` meeting requests.

Each request has a start time and an end time.
Only one meeting can use the room at any moment.

Choose a subset of meetings so that:

- no two chosen meetings overlap
- the number of chosen meetings is as large as possible

Meetings that end exactly when another one starts **do not overlap** and may both be chosen.

## Input

- The first line contains an integer `n` (`1 <= n <= 200000`).
- Each of the next `n` lines contains two integers `start` and `end`
  (`0 <= start < end <= 10^9`).

## Output

- Print one integer: the maximum number of meetings that can be scheduled.

## Example

Input

```text
5
1 4
2 3
3 5
0 7
5 7
```

Output

```text
3
```

## Explanation

One optimal selection is:

- `2 3`
- `3 5`
- `5 7`

So the answer is `3`.
