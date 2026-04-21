# Bookstore Balance

The manager of a bookstore records how many books were sold in each hour of the day.

She wants to split the day into **two consecutive parts**:

- the first part contains hours `1..i`
- the second part contains hours `i+1..n`

for some `1 <= i < n`.

The goal is to make the total number of books sold in the two parts as balanced as possible.

Given the hourly sales array, compute the **minimum absolute difference** between the sum of the first part and the sum of the second part.

## Input

- The first line contains an integer `n` (`2 <= n <= 200000`) — the number of hours.
- The second line contains `n` integers `a1, a2, ..., an` (`0 <= ai <= 10^9`) — books sold in each hour.

## Output

- Print one integer: the minimum possible absolute difference between the left sum and the right sum after one split.

## Example

Input

```text
5
3 1 2 4 3
```

Output

```text
1
```

## Explanation

If we split after the third hour:

- left sum = `3 + 1 + 2 = 6`
- right sum = `4 + 3 = 7`

The absolute difference is `1`, which is the minimum possible.
