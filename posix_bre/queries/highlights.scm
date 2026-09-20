[
  (ordinary_character)
  (collating_element_single)
  (collating_element_multi)
  (meta_character)
] @string.regexp

(quoted_character) @string.escape

(backreference) @string.escape

[
  (class_name)
  "."
] @character.special

(duplication_count) @number

[
  "\\("
  "\\)"
  "\\{"
  "\\}"
  "["
  "]"
  "[."
  ".]"
  "[="
  "=]"
  "[:"
  ":]"
] @punctuation.bracket

"," @punctuation.delimiter

[
  "\\|"
  "^"
  "$"
  "*"
  "\\+"
  "\\?"
  "-"
] @operator

(range_expression
  "-" @string.regexp)

(bracket_list
  "-" @string.regexp)
