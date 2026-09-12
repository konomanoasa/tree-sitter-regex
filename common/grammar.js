export function alternation(first, following = first) {
  return choice(
    first,
    seq(optional(first), repeat1(seq("|", optional(following)))),
  );
}

export function classRange(start, end) {
  return seq(field("start", start), "-", field("end", end));
}
