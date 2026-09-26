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
  (comment_content)
  (verbose_comment)
  "#"
] @comment

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
  "<"
  ">"
] @punctuation.bracket

[
  ","
  ":"
] @punctuation.delimiter

[
  "?"
  "?P"
] @punctuation.special

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

(atomic_group
  ">" @operator)

(quantifier
  "?" @operator)

(conditional_group
  condition: (group_id) @label)

(numeric_backreference
  group: (group_id) @string.escape)
