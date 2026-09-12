[
  (literal_character)
  (class_character)
] @string.regexp

[
  (wildcard)
  (character_class_escape)
] @character.special

[
  (literal_escape)
  (control_escape)
  (backspace_escape)
  (hexadecimal_digits)
  (octal_digits)
  (unicode_character_name)
  "\\"
  "\\x"
  "\\u"
  "\\U"
  "\\N"
] @string.escape

(group_name) @label

(decimal_digits) @number

(flag_set) @keyword.modifier

[
  (verbose_comment)
  "#"
  "comment_content"
] @comment

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
  "<"
] @punctuation.bracket

[
  ","
  ":"
] @punctuation.delimiter

"?P" @punctuation.special

[
  (start_anchor)
  (end_anchor)
  (anchor_escape)
  (word_boundary_escape)
  "|"
  "^"
  "-"
  "*"
  "+"
  "="
  "!"
  "<="
  "<!"
] @operator

(named_capturing_group
  ">" @punctuation.bracket)

(atomic_group
  ">" @operator)

(quantifier
  "?" @operator)

(non_capturing_group
  "?" @punctuation.special)

(positive_lookahead_assertion
  "?" @punctuation.special)

(negative_lookahead_assertion
  "?" @punctuation.special)

(positive_lookbehind_assertion
  "?" @punctuation.special)

(negative_lookbehind_assertion
  "?" @punctuation.special)

(atomic_group
  "?" @punctuation.special)

(global_flags
  "?" @punctuation.special)

(scoped_flags_group
  "?" @punctuation.special)

(conditional_group
  "?" @punctuation.special)

(comment_group
  "?" @punctuation.special)

(conditional_group
  condition: (group_id) @label)

(numeric_backreference
  group: (group_id) @string.escape)
